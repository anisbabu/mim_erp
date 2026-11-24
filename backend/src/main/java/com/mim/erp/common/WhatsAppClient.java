package com.mim.erp.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/** Sends WhatsApp template messages through the Meta WhatsApp Business Cloud API. */
@Component
public class WhatsAppClient {
    private final String token;
    private final String phoneId;
    private final String apiVersion;
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public WhatsAppClient(@Value("${mim.whatsapp.token:}") String token,
                          @Value("${mim.whatsapp.phone-id:}") String phoneId,
                          @Value("${mim.whatsapp.api-version:v21.0}") String apiVersion) {
        this.token = token;
        this.phoneId = phoneId;
        this.apiVersion = apiVersion;
    }

    public boolean configured() { return !token.isBlank() && !phoneId.isBlank(); }

    /** Bangladesh mobile → international digits (8801XXXXXXXXX), or null if it is not a valid number. */
    public static String normalizeMobile(String raw) {
        if (raw == null) return null;
        String d = raw.replaceAll("\\D", "");
        if (d.startsWith("00")) d = d.substring(2);
        if (d.startsWith("880") && d.length() == 13) return d;
        if (d.startsWith("0") && d.length() == 11) return "88" + d;
        if (d.startsWith("1") && d.length() == 10) return "880" + d;
        return null;
    }

    /** Sends an approved template with positional body parameters. Throws ApiException on failure. */
    public void sendTemplate(String to, String template, String langCode, List<String> params) {
        if (template == null || template.isBlank()) throw new ApiException("WhatsApp template name is not set");
        var parameters = params.stream().map(p -> Map.of("type", "text", "text", p)).toList();
        postMessage(Map.of(
            "messaging_product", "whatsapp",
            "to", to,
            "type", "template",
            "template", Map.of(
                "name", template,
                "language", Map.of("code", langCode),
                "components", List.of(Map.of("type", "body", "parameters", parameters)))));
    }

    /**
     * Sends an approved template whose header is a dynamic Document, so one click delivers the PDF
     * itself into the chat (not just a link). {@code documentUrl} must be a public URL WhatsApp's
     * servers can fetch without a login session — see {@link DocLinkSigner}.
     */
    public void sendDocumentTemplate(String to, String template, String langCode, String documentUrl, String filename, List<String> bodyParams) {
        if (template == null || template.isBlank()) throw new ApiException("WhatsApp template name is not set");
        var bodyParameters = bodyParams.stream().map(p -> Map.of("type", "text", "text", p)).toList();
        var headerParameter = Map.of("type", "document", "document", Map.of("link", documentUrl, "filename", filename));
        postMessage(Map.of(
            "messaging_product", "whatsapp",
            "to", to,
            "type", "template",
            "template", Map.of(
                "name", template,
                "language", Map.of("code", langCode),
                "components", List.of(
                    Map.of("type", "header", "parameters", List.of(headerParameter)),
                    Map.of("type", "body", "parameters", bodyParameters)))));
    }

    private void postMessage(Map<String, Object> body) {
        if (!configured()) throw new ApiException("WhatsApp is not configured");
        try {
            var req = HttpRequest.newBuilder(URI.create(
                    "https://graph.facebook.com/" + apiVersion + "/" + phoneId + "/messages"))
                .timeout(Duration.ofSeconds(20))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                .build();
            var res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                String msg = res.body();
                try { msg = json.readTree(res.body()).path("error").path("message").asText(msg); } catch (Exception ignored) { }
                throw new ApiException("WhatsApp " + res.statusCode() + ": " + msg);
            }
        } catch (ApiException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException("WhatsApp send interrupted");
        } catch (Exception e) {
            throw new ApiException("WhatsApp send failed: " + e.getMessage());
        }
    }
}
