package com.mim.erp.accounting;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/accounting")
public class CashController {

    private final CashService cash;
    private final ApprovalService approvals;

    public CashController(CashService cash, ApprovalService approvals) { this.cash = cash; this.approvals = approvals; }

    /** Receipt (IN) / payment (OUT) voucher. {@code allocations} empty = settle the oldest bills first. */
    public record PaymentRequest(String direction, String partyType, UUID partyId, LocalDate date,
                                 BigDecimal amount, BigDecimal discount, String method, String cashAccount,
                                 String note, String reference, String bankAccountNo, String bankBranch,
                                 List<BillService.Alloc> allocations, BigDecimal ait, BigDecimal vds) {}
    public record PettyCashRequest(UUID shopId, BigDecimal amount,
                                   UUID expenseAccountId, String description) {}

    @GetMapping("/payments")
    public List<Map<String, Object>> payments(@RequestParam String direction,
                                              @RequestParam(defaultValue = "200") int limit) {
        return cash.list(direction, limit);
    }

    @PostMapping("/payments")
    /** Posts the voucher, or (payment above the approval limit) queues it and returns {pending, requestNo}. */
    public Object payment(@RequestBody PaymentRequest r) {
        var req = new CashService.VoucherRequest(r.direction(), r.partyType(), r.partyId(), r.date(),
            r.amount(), r.discount(), r.method(), r.cashAccount(), r.bankAccountNo(), r.bankBranch(),
            r.reference(), r.note(), r.allocations(), r.ait(), r.vds());
        if ("OUT".equals(r.direction()) && approvals.needsApproval(r.amount())) return approvals.submitPayment(req);
        return cash.voucher(req);
    }

    /** Printable receipt / payment voucher (5.5 x 8.5 in slip); {@code lang=bn} prints Bangla. */
    @GetMapping(value = "/payments/{id}/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> voucherPdf(@PathVariable UUID id, @RequestParam(defaultValue = "en") String lang) {
        boolean bn = "bn".equalsIgnoreCase(lang);
        return ResponseEntity.ok()
            .header("Content-Disposition", "inline; filename=\"voucher-" + id + (bn ? "-bn" : "") + ".pdf\"")
            .body(cash.voucherPdf(id, bn));
    }

    @PostMapping("/petty-cash")
    public PettyCashVoucher pettyCash(@RequestBody PettyCashRequest r) {
        return cash.pettyCash(r.shopId(), r.amount(), r.expenseAccountId(), r.description());
    }
}
