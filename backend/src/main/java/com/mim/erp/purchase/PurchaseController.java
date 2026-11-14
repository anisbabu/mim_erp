package com.mim.erp.purchase;

import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/purchase")
public class PurchaseController {

    private final PurchaseService service;
    private final PurchaseReturnService returns;

    public PurchaseController(PurchaseService service, PurchaseReturnService returns) {
        this.service = service; this.returns = returns;
    }

    /** Goods receipts with their supplier bill details (optionally one supplier). */
    @GetMapping("/receipts")
    public List<java.util.Map<String, Object>> grnList(@RequestParam(required = false) UUID supplierId) {
        return returns.receipts(supplierId);
    }

    /** Key or correct the supplier's bill no., bill date and due date on a receipt. */
    @PutMapping("/receipts/{grnId}/bill")
    public java.util.Map<String, Object> updateBill(@PathVariable UUID grnId, @RequestBody PurchaseDtos.BillDetails b) {
        GoodsReceipt g = service.updateBill(grnId, b);
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        m.put("id", g.getId()); m.put("billNo", g.getBillNo()); m.put("billDate", g.getBillDate()); m.put("dueDate", g.getDueDate());
        return m;
    }

    @GetMapping("/returns")
    public List<java.util.Map<String, Object>> purchaseReturns() { return returns.list(); }

    @GetMapping("/returns/returnable/{grnId}")
    public java.util.Map<String, Object> returnable(@PathVariable UUID grnId) { return returns.returnable(grnId); }

    @PostMapping("/returns")
    public java.util.Map<String, Object> createReturn(@RequestBody PurchaseReturnService.CreateRequest req) {
        return returns.create(req);
    }

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
