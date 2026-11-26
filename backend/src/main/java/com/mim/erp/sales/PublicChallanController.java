package com.mim.erp.sales;

import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocLinkSigner;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * Warehouse gate-pass QR scan — opened by the gate guard's own phone, no login session, so this must
 * stay outside normal JWT auth (permitAll in SecurityConfig, same reasoning as PublicDocController).
 * The signed token is the only access control. First open marks the challan's goods as collected;
 * any later open just reports that, so the same token/photo can't be used to collect goods twice.
 */
@RestController
@RequestMapping("/public/dc")
public class PublicChallanController {
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm");

    private final DocLinkSigner signer;
    private final SalesService service;

    public PublicChallanController(DocLinkSigner signer, SalesService service) {
        this.signer = signer;
        this.service = service;
    }

    @GetMapping(value = "/{token}", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> view(@PathVariable String token) {
        DocLinkSigner.Payload p = verify(token);
        return ResponseEntity.ok(page(token, service.collectStatus(p.id())));
    }

    @PostMapping(value = "/{token}/collect", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> collect(@PathVariable String token) {
        DocLinkSigner.Payload p = verify(token);
        return ResponseEntity.ok(page(token, service.markCollected(p.id())));
    }

    private DocLinkSigner.Payload verify(String token) {
        DocLinkSigner.Payload p = signer.verify(token);
        if (!"DC_VERIFY".equals(p.kind())) throw new ApiException("Invalid link");
        return p;
    }

    private String page(String token, OffsetDateTime collectedAt) {
        boolean taken = collectedAt != null;
        String status = taken ? "ALREADY TAKEN" : "NOT YET TAKEN";
        String color = taken ? "#c01c28" : "#1a7f37";
        String detail = taken
            ? "Collected at " + collectedAt.atZoneSameInstant(ZoneId.systemDefault()).format(FMT)
            : "This token has not been used yet.";
        String action = taken ? "" :
            "<form method=\"post\" action=\"/public/dc/" + token + "/collect\">" +
            "<button style=\"margin-top:24px;padding:14px 28px;font-size:18px;font-weight:700;color:#fff;" +
            "background:#1a7f37;border:none;border-radius:8px;\">Confirm pickup</button></form>";
        return "<!doctype html><html><head><meta charset=\"utf-8\">" +
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
            "<title>Gate pass check</title></head>" +
            "<body style=\"font-family:system-ui,sans-serif;text-align:center;padding:40px 20px;background:#f4f6f9;\">" +
            "<div style=\"font-size:28px;font-weight:800;color:" + color + ";\">" + status + "</div>" +
            "<div style=\"margin-top:12px;font-size:16px;color:#374151;\">" + detail + "</div>" +
            action +
            "</body></html>";
    }
}
