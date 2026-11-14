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

    public ControlsController(ContraService contra, ApprovalService approvals) {
        this.contra = contra; this.approvals = approvals;
    }

    public record DecisionRequest(String note) {}
    public record LimitRequest(BigDecimal limit) {}

    // ---- contra
    @GetMapping("/contra/ledgers")
    public List<Map<String, Object>> moneyLedgers() { return contra.moneyLedgers(); }

    @GetMapping("/contra")
    public List<Map<String, Object>> contraList(@RequestParam(defaultValue = "200") int limit) { return contra.list(limit); }

    /** Posts the contra, or (above the approval limit) queues it and returns {pending, requestNo}. */
    @PostMapping("/contra")
    public Map<String, Object> contra(@RequestBody ContraService.ContraRequest r) {
        if (approvals.needsApproval(r.amount())) return approvals.submitContra(r);
        return contra.post(r, null, null);
    }

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
