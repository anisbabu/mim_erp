package com.mim.erp.accounting;

import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/accounting/financial-year")
public class FinancialYearController {

    private final FinancialYearService years;
    public FinancialYearController(FinancialYearService years) { this.years = years; }

    @GetMapping
    public List<FinancialYear> list() { return years.list(); }

    @GetMapping("/current")
    public FinancialYear current() { return years.current(); }

    @PostMapping
    public FinancialYear create(@RequestBody FinancialYear in) { return years.create(in); }

    @PostMapping("/{id}/set-current")
    public void setCurrent(@PathVariable UUID id) { years.setCurrent(id); }

    @GetMapping("/{id}/openings")
    public List<OpeningBalance> openings(@PathVariable UUID id) { return years.openings(id); }

    @PostMapping("/{id}/openings")
    public OpeningBalance setOpening(@PathVariable UUID id, @RequestBody Map<String,Object> body) {
        UUID accountId = UUID.fromString(body.get("accountId").toString());
        BigDecimal debit  = new BigDecimal(body.getOrDefault("debit", "0").toString());
        BigDecimal credit = new BigDecimal(body.getOrDefault("credit", "0").toString());
        return years.setOpening(id, accountId, debit, credit);
    }
}
