package com.mim.erp.accounting;

import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/accounting/journal")
public class JournalController {

    private final AccountingService accounting;
    public JournalController(AccountingService accounting) { this.accounting = accounting; }

    /** Post a manual journal voucher. Body: {entryDate, narration, lines:[{accountId,debit,credit}]} */
    @PostMapping
    public Map<String,Object> post(@RequestBody Map<String,Object> body) {
        LocalDate date = LocalDate.parse(body.getOrDefault("entryDate", LocalDate.now().toString()).toString());
        String narration = String.valueOf(body.getOrDefault("narration", ""));
        @SuppressWarnings("unchecked")
        List<Map<String,Object>> rawLines = (List<Map<String,Object>>) body.get("lines");
        List<AccountingService.ManualLeg> legs = rawLines.stream().map(l ->
            new AccountingService.ManualLeg(
                UUID.fromString(l.get("accountId").toString()),
                new BigDecimal(l.getOrDefault("debit", "0").toString()),
                new BigDecimal(l.getOrDefault("credit", "0").toString())
            )).toList();
        JournalEntry je = accounting.postManual(date, narration, legs);
        return Map.of("entryNo", je.getEntryNo(), "id", je.getId());
    }

    /** Journal register / day book. */
    @GetMapping
    public List<Map<String,Object>> register(@RequestParam(defaultValue = "50") int limit) {
        return accounting.journalRegister(limit);
    }
}
