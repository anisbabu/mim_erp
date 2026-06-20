package com.mim.erp.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

@Service
public class JwtService {

    private final SecretKey key;
    private final long expiryMinutes;

    public JwtService(@Value("${mim.jwt.secret}") String secret,
                      @Value("${mim.jwt.expiry-minutes}") long expiryMinutes) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.expiryMinutes = expiryMinutes;
    }

    public String issue(AppUser user) {
        Instant now = Instant.now();
        return Jwts.builder()
            .subject(user.getUsername())
            .claim("uid", user.getId().toString())
            .claim("role", user.getRole())
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plusSeconds(expiryMinutes * 60)))
            .signWith(key)
            .compact();
    }

    /** Parse + verify a token into a principal, or null if invalid/expired. */
    public AuthPrincipal parse(String token) {
        try {
            Claims c = Jwts.parser().verifyWith(key).build()
                .parseSignedClaims(token).getPayload();
            return new AuthPrincipal(
                UUID.fromString(c.get("uid", String.class)),
                c.getSubject(),
                c.get("role", String.class));
        } catch (Exception e) {
            return null;
        }
    }
}
