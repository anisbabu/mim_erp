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

    /** Line items of one order — the orders list has no other way to see them (SalesOrder.lines is @JsonIgnore). */
    @GetMapping("/orders/{soId}/lines")
    public java.util.List<SalesDtos.SoLineView> orderLines(@PathVariable UUID soId) {
        return service.orderLines(soId);
    }

    /** Fulfil part or all of an order's backordered lines now that stock exists. */
    @PostMapping("/orders/{soId}/fulfill")
    public SalesOrder fulfill(@PathVariable UUID soId, @RequestBody SalesDtos.FulfillRequest req) {
        return service.fulfillOrder(soId, req);
    }

    /** Every pickup (delivery challan) issued under an order — for the pickup-history view. */
    @GetMapping("/orders/{soId}/pickups")
    public java.util.List<SalesDtos.PickupView> orderPickups(@PathVariable UUID soId) {
        return service.orderPickups(soId);
    }

    /** Open (un-consolidated) challans — for the DC_FIRST day-end screen. */
    @GetMapping("/challans/open")
    public java.util.List<DeliveryChallan> openChallans() { return service.openChallans(); }

    /** All lines from open challans for one customer — for the consolidation review form. */
    @GetMapping("/challans/open/lines")
    public java.util.List<SalesDtos.ChallanLineView> openChallanLines(@RequestParam UUID customerId) {
        return service.openChallanLines(customerId);
    }

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

    /** Warehouse dispatch token — one page per warehouse DC. */
    @GetMapping(value = "/orders/{soId}/warehouse-token", produces = "application/pdf")
    public ResponseEntity<byte[]> warehouseToken(@PathVariable UUID soId) {
        byte[] pdf = service.generateWarehouseTokenPdf(soId);
        return ResponseEntity.ok()
            .header("Content-Disposition", "attachment; filename=\"dispatch-token-" + soId + ".pdf\"")
            .body(pdf);
    }

    /** Delivery challan PDF for all challans under a sales order. */
    @GetMapping(value = "/orders/{soId}/challan", produces = "application/pdf")
    public ResponseEntity<byte[]> orderChallan(@PathVariable UUID soId) {
        byte[] pdf = service.generateOrderChallanPdf(soId);
        return ResponseEntity.ok()
            .header("Content-Disposition", "attachment; filename=\"challan-" + soId + ".pdf\"")
            .body(pdf);
    }

    /** Download a delivery challan as PDF. */
    @GetMapping(value = "/challans/{dcId}/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> challanPdf(@PathVariable UUID dcId) {
        byte[] pdf = service.generateChallanPdf(dcId);
        String filename = "challan-" + dcId + ".pdf";
        return ResponseEntity.ok()
            .header("Content-Disposition", "attachment; filename=\"" + filename + "\"")
            .body(pdf);
    }
}
