package com.mim.erp.sales;

import com.mim.erp.common.PdfKit;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/sales/returns")
public class SalesReturnController {

    private final SalesReturnService service;

    public SalesReturnController(SalesReturnService service) { this.service = service; }

    @GetMapping
    public List<Map<String, Object>> list() { return service.list(); }

    /** Delivered lines of an order and how much of each can still come back. */
    @GetMapping("/returnable/{soId}")
    public Map<String, Object> returnable(@PathVariable UUID soId) { return service.returnable(soId); }

    @PostMapping
    public Map<String, Object> create(@RequestBody SalesReturnService.CreateRequest req) { return service.create(req); }

    @GetMapping(value = "/{id}/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> pdf(@PathVariable UUID id, @RequestParam(defaultValue = "en") String lang) {
        boolean bn = PdfKit.isBn(lang);
        return ResponseEntity.ok()
            .header("Content-Disposition", "inline; filename=\"credit-note" + (bn ? "-bn" : "") + ".pdf\"")
            .body(service.creditNotePdf(id, bn));
    }
}
