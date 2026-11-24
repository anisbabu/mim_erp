package com.mim.erp.sales;

import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocLinkSigner;
import com.mim.erp.common.PdfKit;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Fetched by Meta's WhatsApp Cloud API when a document-template message is sent (see
 * {@link WhatsAppShareService}) — no login session, so this must stay outside normal JWT auth
 * (permitAll in SecurityConfig). The signed, short-lived token is the only access control.
 */
@RestController
@RequestMapping("/public/wa")
public class PublicDocController {
    private final DocLinkSigner signer;
    private final SalesService service;

    public PublicDocController(DocLinkSigner signer, SalesService service) {
        this.signer = signer;
        this.service = service;
    }

    @GetMapping(value = "/{token}", produces = "application/pdf")
    public ResponseEntity<byte[]> doc(@PathVariable String token) {
        DocLinkSigner.Payload p = signer.verify(token);
        boolean bn = PdfKit.isBn(p.lang());
        List<UUID> dcIds = p.dcIds().isEmpty() ? null : p.dcIds();
        byte[] pdf = switch (p.kind()) {
            case "SO_TOKEN" -> service.generateWarehouseTokenPdf(p.id(), bn, dcIds);
            case "SO_CHALLAN" -> service.generateOrderChallanPdf(p.id(), bn, dcIds);
            case "SO_INVOICE" -> service.generateInvoicePdf(p.id(), bn);
            case "DC_CHALLAN" -> service.generateChallanPdf(p.id(), bn);
            default -> throw new ApiException("Invalid link");
        };
        return ResponseEntity.ok().header("Content-Disposition", "inline; filename=\"document.pdf\"").body(pdf);
    }
}
