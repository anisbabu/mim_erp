package com.mim.erp.accounting;

import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/accounting/cheques")
public class ChequeController {

    private final ChequeService cheques;

    public ChequeController(ChequeService cheques) { this.cheques = cheques; }

    public record ChequeRequest(UUID customerId, BigDecimal amount, String chequeNo,
                                String bankName, LocalDate maturityDate, String note) {}
    public record DateRequest(LocalDate newMaturityDate, String requestedBy, String note) {}
    public record StepRequest(String requestedBy, String note) {}

    @GetMapping
    public List<Cheque> list() { return cheques.list(); }

    @PostMapping
    public Cheque record(@RequestBody ChequeRequest r) {
        return cheques.record(r.customerId(), r.amount(), r.chequeNo(), r.bankName(), r.maturityDate(), r.note());
    }

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
    public Cheque post(@PathVariable UUID id, @RequestBody StepRequest r) { return cheques.post(id, r.note()); }

    @PostMapping("/{id}/bounce")
    public Cheque bounce(@PathVariable UUID id, @RequestBody StepRequest r) { return cheques.markBounced(id, r.note()); }

    @GetMapping("/{id}/history")
    public List<ChequeEvent> history(@PathVariable UUID id) { return cheques.history(id); }
}
