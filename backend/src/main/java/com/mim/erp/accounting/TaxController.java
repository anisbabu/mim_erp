package com.mim.erp.accounting;

import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;

/** VAT switch and default rate. Reading is open to accounting roles; changing needs ACCOUNTANT or ADMIN. */
@RestController
@RequestMapping("/api/accounting/tax-settings")
public class TaxController {

    public record SettingsRequest(boolean enabled, BigDecimal defaultRate) {}

    private final VatService vat;

    public TaxController(VatService vat) { this.vat = vat; }

    @GetMapping
    public VatService.Settings get() { return vat.settings(); }

    @PutMapping
    public VatService.Settings save(@RequestBody SettingsRequest r) { return vat.save(r.enabled(), r.defaultRate()); }
}
