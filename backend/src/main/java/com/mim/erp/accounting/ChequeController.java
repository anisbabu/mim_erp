package com.mim.erp.accounting;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/accounting/cheques")
public class ChequeController {

    private final ChequeService cheques;
    private final ChequeReminderService reminders;

    public ChequeController(ChequeService cheques, ChequeReminderService reminders) {
        this.cheques = cheques;
        this.reminders = reminders;
    }

    public record ChequeRequest(UUID customerId, BigDecimal amount, String chequeNo,
                                String bankName, String branchName, LocalDate maturityDate, String note) {}
    public record DateRequest(LocalDate newMaturityDate, String requestedBy, String note) {}
    public record StepRequest(String requestedBy, String note) {}
    public record PostRequest(String depositAccount, String note) {}
    public record BounceRequest(String reason, String note) {}
    public record ReminderSettingsRequest(boolean enabled, String lang) {}

    @GetMapping
    public List<Cheque> list() { return cheques.list(); }

    @GetMapping("/bank-accounts")
    public List<Account> bankAccounts() { return cheques.bankAccounts(); }

    @GetMapping("/customer-balance/{customerId}")
    public Map<String, BigDecimal> customerBalance(@PathVariable UUID customerId) {
        return Map.of("balance", cheques.customerBalance(customerId));
    }

    @GetMapping(value = "/{id}/receipt", produces = "application/pdf")
    public ResponseEntity<byte[]> receipt(@PathVariable UUID id, @RequestParam(defaultValue = "en") String lang) {
        return ResponseEntity.ok()
            .header("Content-Disposition", "inline; filename=\"cheque-receipt-" + id + ("bn".equalsIgnoreCase(lang) ? "-bn" : "") + ".pdf\"")
            .body(cheques.receiptPdf(id, "bn".equalsIgnoreCase(lang)));
    }

    @PostMapping
    public Cheque record(@RequestBody ChequeRequest r) {
        return cheques.record(r.customerId(), r.amount(), r.chequeNo(), r.bankName(), r.branchName(), r.maturityDate(), r.note());
    }

    @PutMapping("/{id}")
    public Cheque edit(@PathVariable UUID id, @RequestBody ChequeRequest r) {
        return cheques.edit(id, r.customerId(), r.amount(), r.chequeNo(), r.bankName(), r.branchName(), r.maturityDate(), r.note());
    }

    @PostMapping("/{id}/cancel")
    public Cheque cancel(@PathVariable UUID id, @RequestBody StepRequest r) { return cheques.cancel(id, r.note()); }

    @PostMapping("/{id}/date")
    public Cheque changeDate(@PathVariable UUID id, @RequestBody DateRequest r) {
        return cheques.changeDate(id, r.newMaturityDate(), r.requestedBy(), r.note());
    }

    @PostMapping("/{id}/hold")
    public Cheque hold(@PathVariable UUID id, @RequestBody StepRequest r) { return cheques.hold(id, r.requestedBy(), r.note()); }

    @PostMapping("/{id}/resume")
    public Cheque resume(@PathVariable UUID id, @RequestBody StepRequest r) { return cheques.resume(id, r.note()); }

    @PostMapping("/{id}/cash")
    public Cheque cash(@PathVariable UUID id, @RequestBody StepRequest r) { return cheques.markCashed(id, r.note()); }

    @PostMapping("/{id}/post")
    public Cheque post(@PathVariable UUID id, @RequestBody PostRequest r) { return cheques.post(id, r.depositAccount(), r.note()); }

    @PostMapping("/{id}/bounce")
    public Cheque bounce(@PathVariable UUID id, @RequestBody BounceRequest r) { return cheques.markBounced(id, r.reason(), r.note()); }

    @PostMapping("/{id}/resubmit")
    public Cheque resubmit(@PathVariable UUID id, @RequestBody DateRequest r) {
        return cheques.resubmit(id, r.newMaturityDate(), r.note());
    }

    @GetMapping("/reminder-settings")
    public ChequeReminderService.Settings reminderSettings() { return reminders.getSettings(); }

    @PutMapping("/reminder-settings")
    public ChequeReminderService.Settings saveReminderSettings(@RequestBody ReminderSettingsRequest r) {
        return reminders.saveSettings(r.enabled(), r.lang());
    }

    @PostMapping("/{id}/remind")
    public Cheque remind(@PathVariable UUID id) { return reminders.remind(id); }

    @GetMapping("/{id}/history")
    public List<ChequeEvent> history(@PathVariable UUID id) { return cheques.history(id); }
}
