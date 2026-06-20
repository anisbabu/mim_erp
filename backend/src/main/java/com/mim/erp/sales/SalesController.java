package com.mim.erp.sales;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/sales")
public class SalesController {

    private final SalesService service;

    public SalesController(SalesService service) { this.service = service; }

    /** Workflow 1 (SO_FIRST): create order, system splits into per-warehouse challans. */
    @PostMapping("/orders")
    public SalesDtos.OrderResult createOrder(@RequestBody SalesDtos.CreateOrderRequest req) {
        return service.createOrder(req);
    }

    /** Workflow 2 (DC_FIRST): issue a single-warehouse challan now. */
    @PostMapping("/challans")
    public DeliveryChallan issueChallan(@RequestBody SalesDtos.IssueChallanRequest req) {
        return service.issueChallan(req);
    }

    /** Workflow 2: day-end consolidation of a customer's challans into one invoice. */
    @PostMapping("/consolidate")
    public SalesDtos.OrderResult consolidate(@RequestBody SalesDtos.ConsolidateRequest req) {
        return service.consolidate(req);
    }

    @GetMapping("/orders")
    public java.util.List<SalesOrder> orders() { return service.allOrders(); }

    /** Open (un-consolidated) challans — for the DC_FIRST day-end screen. */
    @GetMapping("/challans/open")
    public java.util.List<DeliveryChallan> openChallans() { return service.openChallans(); }

    /** All challans — for the list/search page. */
    @GetMapping("/challans")
    public java.util.List<DeliveryChallan> allChallans() { return service.allChallans(); }

    /** Download a sales invoice as PDF. */
    @GetMapping(value = "/orders/{soId}/invoice", produces = "application/pdf")
    public ResponseEntity<byte[]> invoice(@PathVariable UUID soId) {
        byte[] pdf = service.generateInvoicePdf(soId);
        String filename = "invoice-" + soId + ".pdf";
        return ResponseEntity.ok()
            .header("Content-Disposition", "attachment; filename=\"" + filename + "\"")
            .body(pdf);
    }
}
