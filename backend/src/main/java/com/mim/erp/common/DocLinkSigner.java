package com.mim.erp.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

/**
 * Signs short-lived, single-purpose links so an outside server (Meta's WhatsApp Cloud API) can fetch a
 * generated PDF without a login session. No state is stored — the token carries everything needed to
 * regenerate the document, HMAC-signed so it can't be altered or reused past its expiry.
 */
@Component
public class DocLinkSigner {
    private final byte[] key;

    public DocLinkSigner(@Value("${mim.whatsapp.link-secret}") String secret) {
        this.key = secret.getBytes(StandardCharsets.UTF_8);
    }

    public record Payload(String kind, UUID id, List<UUID> dcIds, String lang) {}

    public String sign(String kind, UUID id, List<UUID> dcIds, String lang, Duration ttl) {
        long exp = Instant.now().plus(ttl).getEpochSecond();
        String dcPart = dcIds == null || dcIds.isEmpty() ? "-" : String.join(",", dcIds.stream().map(UUID::toString).toList());
        String payload = kind + "|" + id + "|" + dcPart + "|" + lang + "|" + exp;
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
        return encoded + "." + hmac(encoded);
    }

    public Payload verify(String token) {
        int dot = token.lastIndexOf('.');
        if (dot < 0) throw new ApiException("Invalid link");
        String encoded = token.substring(0, dot);
        String sig = token.substring(dot + 1);
        if (!MessageDigest.isEqual(sig.getBytes(StandardCharsets.UTF_8), hmac(encoded).getBytes(StandardCharsets.UTF_8)))
            throw new ApiException("Invalid link");
        String payload = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8);
        String[] parts = payload.split("\\|", 5);
        if (parts.length != 5) throw new ApiException("Invalid link");
        if (Instant.now().getEpochSecond() > Long.parseLong(parts[4])) throw new ApiException("This link has expired");
        List<UUID> dcIds = "-".equals(parts[2]) ? List.of() : Arrays.stream(parts[2].split(",")).map(UUID::fromString).toList();
        return new Payload(parts[0], UUID.fromString(parts[1]), dcIds, parts[3]);
    }

    private String hmac(String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
