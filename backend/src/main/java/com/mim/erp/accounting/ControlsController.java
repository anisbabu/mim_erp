package com.mim.erp.accounting;

import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Contra vouchers and the voucher approval queue. Roles are set in SecurityConfig. */
@RestController
@RequestMapping("/api/accounting")
public class ControlsController {

    private final ContraService contra;
    private final ApprovalService approvals;
    private final ReclassService reclass;

    public ControlsController(ContraService contra, ApprovalService approvals, ReclassService reclass) {
        this.contra = contra; this.approvals = approvals; this.reclass = reclass;
    }

    public record DecisionRequest(String note) {}
    public record LimitRequest(BigDecimal limit) {}

    // ---- contra
    @GetMapping("/contra/ledgers")
    public List<Map<String, Object>> moneyLedgers() { return contra.moneyLedgers(); }

    @GetMapping("/contra")
    public List<Map<String, Object>> contraList(@RequestParam(defaultValue = "200") int limit) { return contra.list(limit); }

    @GetMapping(value = "/contra/{id}/pdf", produces = "application/pdf")
    public org.springframework.http.ResponseEntity<byte[]> contraPdf(@PathVariable UUID id, @RequestParam(defaultValue = "en") String lang) {
        boolean bn = "bn".equalsIgnoreCase(lang);
        return org.springframework.http.ResponseEntity.ok()
            .header("Content-Disposition", "inline; filename=\"contra-" + id + (bn ? "-bn" : "") + ".pdf\"")
            .body(contra.pdf(id, bn));
    }

    /** Posts the contra, or (above the approval limit) queues it and returns {pending, requestNo}. */
    @PostMapping("/contra")
    public Map<String, Object> contra(@RequestBody ContraService.ContraRequest r) {
        if (approvals.needsApproval(r.amount())) return approvals.submitContra(r);
        return contra.post(r, null, null);
    }

    /** Admin, one-off: split transport and discount out of Sales for orders booked before 4010 / 4400 existed. */
    @PostMapping("/reclassify-sales")
    public Map<String, Object> reclassifySales() { return reclass.reclassifySales(); }

    // ---- approvals
    @GetMapping("/approvals")
    public List<Map<String, Object>> approvals(@RequestParam(defaultValue = "PENDING") String status) { return approvals.list(status); }

    @GetMapping("/approvals/count")
    public Map<String, Object> pendingCount() { return Map.of("pending", approvals.pendingCount()); }

    @PostMapping("/approvals/{id}/approve")
    public Map<String, Object> approve(@PathVariable UUID id, @RequestBody(required = false) DecisionRequest r) {
        return approvals.approve(id, r == null ? null : r.note());
    }

    @PostMapping("/approvals/{id}/reject")
    public Map<String, Object> reject(@PathVariable UUID id, @RequestBody DecisionRequest r) {
        return approvals.reject(id, r.note());
    }

    @GetMapping("/approval-settings")
    public Map<String, Object> settings() { return approvals.settings(); }

    @PutMapping("/approval-settings")
    public Map<String, Object> saveSettings(@RequestBody LimitRequest r) { return approvals.saveLimit(r.limit()); }
}
