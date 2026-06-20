package com.mim.erp.purchase;

import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/purchase")
public class PurchaseController {

    private final PurchaseService service;

    public PurchaseController(PurchaseService service) { this.service = service; }

    @PostMapping("/orders")
    public PurchaseOrder createPo(@RequestBody PurchaseDtos.CreatePoRequest req) {
        return service.createPo(req);
    }

    @GetMapping("/orders/open")
    public List<PurchaseOrder> openOrders() { return service.openOrders(); }

    @GetMapping("/orders")
    public List<PurchaseOrder> allOrders() { return service.allOrders(); }

    /** Full details for the PO details page. */
    @GetMapping("/orders/{poId}")
    public PurchaseDtos.PoDetails details(@PathVariable UUID poId) {
        return service.viewDetails(poId);
    }

    /** Side-by-side view for the receive screen. */
    @GetMapping("/orders/{poId}/receive-view")
    public PurchaseDtos.PoView receiveView(@PathVariable UUID poId) {
        return service.view(poId);
    }

    @GetMapping("/orders/{poId}/receipts")
    public java.util.List<PurchaseDtos.ReceiptView> receipts(@PathVariable UUID poId) {
        return service.receiptHistory(poId);
    }

    /** Receive goods against the PO into one warehouse. */
    @PostMapping("/orders/{poId}/receive")
    public GoodsReceipt receive(@PathVariable UUID poId,
                                @RequestBody PurchaseDtos.ReceiveRequest req) {
        return service.receive(poId, req);
    }
}
