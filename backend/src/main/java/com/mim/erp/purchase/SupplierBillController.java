package com.mim.erp.purchase;

import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Supplier bills (accounts payable) - under Accounting; GETs and posts follow the /api/accounting/** roles. */
@RestController
@RequestMapping("/api/accounting/supplier-bills")
public class SupplierBillController {

    private final SupplierBillService bills;

    public SupplierBillController(SupplierBillService bills) { this.bills = bills; }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) UUID supplierId) { return bills.list(supplierId); }

    /** Goods receipts not billed yet. */
    @GetMapping("/unbilled")
    public List<Map<String, Object>> unbilled(@RequestParam(required = false) UUID supplierId) { return bills.unbilled(supplierId); }

    @PostMapping
    public Map<String, Object> create(@RequestBody SupplierBillService.CreateRequest req) { return bills.create(req); }

    @PostMapping("/{id}/cancel")
    public Map<String, Object> cancel(@PathVariable UUID id, @RequestBody SupplierBillService.CancelRequest req) {
        return bills.cancel(id, req);
    }
}
