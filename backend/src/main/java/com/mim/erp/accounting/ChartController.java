package com.mim.erp.accounting;

import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/accounting/coa")
public class ChartController {

    private final LedgerService ledgers;
    public ChartController(LedgerService ledgers) { this.ledgers = ledgers; }

    @GetMapping("/groups")
    public List<AccountGroup> groups() { return ledgers.listGroups(); }

    @GetMapping("/ledgers")
    public List<Map<String,Object>> ledgers() { return ledgers.listLedgersWithBalance(); }

    @PostMapping("/groups")
    public AccountGroup createGroup(@RequestBody AccountGroup g) { return ledgers.createGroup(g); }

    @PostMapping("/ledgers")
    public Account createLedger(@RequestBody Account a) { return ledgers.createLedger(a); }

    @PutMapping("/ledgers/{id}")
    public Account updateLedger(@PathVariable UUID id, @RequestBody Account a) { return ledgers.updateLedger(id, a); }

    @DeleteMapping("/ledgers/{id}")
    public void deleteLedger(@PathVariable UUID id) { ledgers.deleteLedger(id); }
}
