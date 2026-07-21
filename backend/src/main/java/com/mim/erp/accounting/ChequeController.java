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

    @GetMapping
    public List<Cheque> list() { return cheques.list(); }

    @PostMapping
    public Cheque record(@RequestBody ChequeRequest r) {
        return cheques.record(r.customerId(), r.amount(), r.chequeNo(), r.bankName(), r.maturityDate(), r.note());
    }

    @PostMapping("/{id}/clear")
    public Cheque clear(@PathVariable UUID id) { return cheques.markCleared(id); }

    @PostMapping("/{id}/bounce")
    public Cheque bounce(@PathVariable UUID id) { return cheques.markBounced(id); }
}
