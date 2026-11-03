package com.mim.erp.accounting;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Reports, IFRS statements, controls, bank reconciliation, tax summary and the fixed asset register. */
@RestController
@RequestMapping("/api/accounting")
public class ReportController {

    private final ReportService reports;
    private final StatementService statements;
    private final ControlService controls;
    private final FixedAssetService assets;

    public ReportController(ReportService reports, StatementService statements, ControlService controls, FixedAssetService assets) {
        this.reports = reports; this.statements = statements; this.controls = controls; this.assets = assets;
    }

    private static UUID id(String s) { return s == null || s.isBlank() ? null : UUID.fromString(s); }
    private static LocalDate date(String s, LocalDate fallback) { return s == null || s.isBlank() ? fallback : LocalDate.parse(s); }

    // ---- year-scoped statements
    @GetMapping("/trial-balance")  public Map<String, Object> trialBalance(@RequestParam(required = false) String yearId) { return reports.trialBalance(id(yearId)); }
    @GetMapping("/profit-loss")    public Map<String, Object> profitAndLoss(@RequestParam(required = false) String yearId) { return reports.profitAndLoss(id(yearId)); }
    @GetMapping("/balance-sheet")  public Map<String, Object> balanceSheet(@RequestParam(required = false) String yearId) { return reports.balanceSheet(id(yearId)); }

    @GetMapping("/statements/financial-position") public Map<String, Object> position(@RequestParam(required = false) String yearId) { return statements.financialPosition(id(yearId)); }
    @GetMapping("/statements/profit-or-loss")     public Map<String, Object> pnl(@RequestParam(required = false) String yearId) { return statements.profitOrLoss(id(yearId)); }
    @GetMapping("/statements/changes-in-equity")  public Map<String, Object> equity(@RequestParam(required = false) String yearId) { return statements.changesInEquity(id(yearId)); }
    @GetMapping("/statements/cash-flows")         public Map<String, Object> cash(@RequestParam(required = false) String yearId) { return statements.cashFlows(id(yearId)); }

    // ---- PDF versions (same data as the screen; lang = en | bn)
    @GetMapping(value = "/statements/{kind}/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> statementPdf(@PathVariable String kind, @RequestParam(required = false) String yearId,
                                               @RequestParam(defaultValue = "en") String lang) {
        boolean bn = "bn".equalsIgnoreCase(lang);
        UUID y = id(yearId);
        byte[] pdf = switch (kind) {
            case "financial-position" -> StatementPdf.statement(statements.financialPosition(y), bn, true);
            case "profit-or-loss" -> StatementPdf.statement(statements.profitOrLoss(y), bn, false);
            case "cash-flows" -> StatementPdf.statement(statements.cashFlows(y), bn, false);
            case "changes-in-equity" -> StatementPdf.equity(statements.changesInEquity(y), bn);
            default -> throw new com.mim.erp.common.ApiException("Unknown statement: " + kind);
        };
        return pdfResponse(pdf, kind + (bn ? "-bn" : ""));
    }

    @GetMapping(value = "/trial-balance/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> trialBalancePdf(@RequestParam(required = false) String yearId,
                                                  @RequestParam(defaultValue = "en") String lang) {
        boolean bn = "bn".equalsIgnoreCase(lang);
        return pdfResponse(StatementPdf.trialBalance(reports.trialBalance(id(yearId)), bn), "trial-balance" + (bn ? "-bn" : ""));
    }

    private static ResponseEntity<byte[]> pdfResponse(byte[] pdf, String name) {
        return ResponseEntity.ok().header("Content-Disposition", "inline; filename=\"" + name + ".pdf\"").body(pdf);
    }

    // ---- ledgers
    @GetMapping("/reports/ledger")
    public Map<String, Object> ledger(@RequestParam String accountId, @RequestParam(required = false) String from,
                                      @RequestParam(required = false) String to) {
        ReportService.Period p = reports.period(null);
        return reports.ledger(UUID.fromString(accountId), date(from, p.start()), date(to, LocalDate.now().isBefore(p.end()) ? LocalDate.now() : p.end()));
    }

    @GetMapping("/reports/aging")
    public Map<String, Object> aging(@RequestParam(defaultValue = "CUSTOMER") String type, @RequestParam(required = false) String asOf) {
        return reports.aging(type, date(asOf, LocalDate.now()));
    }

    @GetMapping(value = "/reports/ledger/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> ledgerPdf(@RequestParam String accountId, @RequestParam(required = false) String from,
                                            @RequestParam(required = false) String to, @RequestParam(defaultValue = "en") String lang) {
        boolean bn = com.mim.erp.common.PdfKit.isBn(lang);
        return pdfResponse(StatementPdf.ledger(ledger(accountId, from, to), bn), "general-ledger" + (bn ? "-bn" : ""));
    }

    @GetMapping(value = "/reports/aging/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> agingPdf(@RequestParam(defaultValue = "CUSTOMER") String type, @RequestParam(required = false) String asOf,
                                           @RequestParam(defaultValue = "en") String lang) {
        boolean bn = com.mim.erp.common.PdfKit.isBn(lang);
        return pdfResponse(StatementPdf.aging(aging(type, asOf), bn), "aging-" + type.toLowerCase() + (bn ? "-bn" : ""));
    }

    @GetMapping(value = "/reports/tax/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> taxPdf(@RequestParam(required = false) String from, @RequestParam(required = false) String to,
                                         @RequestParam(defaultValue = "en") String lang) {
        boolean bn = com.mim.erp.common.PdfKit.isBn(lang);
        return pdfResponse(StatementPdf.tax(tax(from, to), bn), "vat-ait" + (bn ? "-bn" : ""));
    }

    @GetMapping(value = "/reports/checks/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> checksPdf(@RequestParam(defaultValue = "en") String lang) {
        boolean bn = com.mim.erp.common.PdfKit.isBn(lang);
        return pdfResponse(StatementPdf.checks(controls.checks(), bn), "control-checks" + (bn ? "-bn" : ""));
    }

    // ---- controls
    @GetMapping("/reports/checks") public Map<String, Object> checks() { return controls.checks(); }

    @GetMapping("/reports/tax")
    public Map<String, Object> tax(@RequestParam(required = false) String from, @RequestParam(required = false) String to) {
        ReportService.Period p = reports.period(null);
        return controls.taxSummary(date(from, p.start()), date(to, LocalDate.now()));
    }

    // ---- bank reconciliation
    @GetMapping("/bank-recon/accounts") public List<Map<String, Object>> bankAccounts() { return controls.bankAccounts(); }

    @GetMapping("/bank-recon/{accountId}/open")
    public Map<String, Object> bankOpen(@PathVariable UUID accountId, @RequestParam(required = false) String upTo) {
        return controls.bankOpenItems(accountId, date(upTo, LocalDate.now()));
    }

    @GetMapping("/bank-recon/{accountId}/history") public List<Map<String, Object>> bankHistory(@PathVariable UUID accountId) { return controls.bankHistory(accountId); }

    @PostMapping("/bank-recon/{accountId}")
    @SuppressWarnings("unchecked")
    public Map<String, Object> bankReconcile(@PathVariable UUID accountId, @RequestBody Map<String, Object> body) {
        List<String> ids = (List<String>) body.getOrDefault("lineIds", List.of());
        return controls.bankReconcile(accountId, LocalDate.parse(body.get("statementDate").toString()),
            new BigDecimal(body.get("statementBalance").toString()),
            ids.stream().map(UUID::fromString).toList(),
            body.get("note") == null ? null : body.get("note").toString());
    }

    // ---- fixed assets
    @GetMapping("/fixed-assets") public List<Map<String, Object>> assetRegister() { return assets.register(); }
    @PostMapping("/fixed-assets") public Map<String, Object> assetCreate(@RequestBody Map<String, Object> body) { return assets.create(body); }

    @PostMapping("/fixed-assets/depreciate")
    public Map<String, Object> depreciate(@RequestBody Map<String, Object> body) { return assets.depreciate(String.valueOf(body.get("period"))); }

    @PostMapping("/fixed-assets/{id}/dispose")
    public Map<String, Object> dispose(@PathVariable UUID id, @RequestBody Map<String, Object> body) {
        Object dep = body.get("depositAccountId");
        return assets.dispose(id, LocalDate.parse(body.get("date").toString()),
            body.get("proceeds") == null || body.get("proceeds").toString().isBlank() ? BigDecimal.ZERO : new BigDecimal(body.get("proceeds").toString()),
            dep == null || dep.toString().isBlank() ? null : UUID.fromString(dep.toString()));
    }
}
