package com.mim.erp.accounting;

import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/accounting")
public class AccountingController {

    private final AccountingService accounting;
    private final ReportService reports;
    private final AccountRepository accounts;

    public AccountingController(AccountingService accounting, ReportService reports,
                                AccountRepository accounts) {
        this.accounting = accounting; this.reports = reports; this.accounts = accounts;
    }

    @GetMapping("/accounts")       public List<Account> accounts() { return accounts.findAll(); }
}
