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

    /** Reverse a posted entry. Body: {reason, date?}. The original is kept; a swapped entry is posted. */
    @PostMapping("/{id}/reverse")
    public Map<String,Object> reverse(@PathVariable UUID id, @RequestBody Map<String,Object> body) {
        Object d = body.get("date");
        JournalEntry rev = accounting.reverse(id, String.valueOf(body.getOrDefault("reason", "")),
            d == null || d.toString().isBlank() ? null : LocalDate.parse(d.toString()));
        return Map.of("entryNo", rev.getEntryNo(), "id", rev.getId());
    }

    /** Journal register / day book. */
    @GetMapping
    public List<Map<String,Object>> register(@RequestParam(defaultValue = "100") int limit,
                                             @RequestParam(required = false) String from,
                                             @RequestParam(required = false) String to) {
        return accounting.journalRegister(limit,
            from == null || from.isBlank() ? null : LocalDate.parse(from),
            to == null || to.isBlank() ? null : LocalDate.parse(to));
    }
}
