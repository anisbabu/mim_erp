package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.mim.erp.accounting.ReportService.bd;

/**
 * Internal controls: automated integrity checks, bank reconciliation and the VAT / AIT summary.
 */
@Service
public class ControlService {

    private final JdbcTemplate jdbc;
    private final ReportService reports;
    private final StatementService statements;

    public ControlService(JdbcTemplate jdbc, ReportService reports, StatementService statements) {
        this.jdbc = jdbc; this.reports = reports; this.statements = statements;
    }

    // ------------------------------------------------------------------ integrity checks
    private static Map<String, Object> check(String code, String title, String status, String detail, Map<String, Object> figures) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", code); m.put("title", title); m.put("status", status); m.put("detail", detail);
        m.put("figures", figures == null ? Map.of() : figures);
        return m;
    }

    private BigDecimal ledgerClosing(String code) {
        Map<String, Object> tb = reports.trialBalance(null);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) tb.get("rows");
        return rows.stream().filter(r -> code.equals(r.get("code")))
            .map(r -> bd(r.get("closing_debit")).subtract(bd(r.get("closing_credit"))))
            .findFirst().orElse(BigDecimal.ZERO);
    }

    public Map<String, Object> checks() {
        List<Map<String, Object>> out = new ArrayList<>();

        Integer unbalanced = jdbc.queryForObject(
            "select count(*) from (select journal_id from journal_line group by journal_id having sum(debit) <> sum(credit)) x",
            Integer.class);
        out.add(check("JOURNALS", "Every journal entry balances (debit = credit)",
            unbalanced == 0 ? "OK" : "FAIL",
            unbalanced == 0 ? "All posted entries are balanced." : unbalanced + " entries are out of balance.", null));

        Map<String, Object> tb = reports.trialBalance(null);
        boolean tbOk = Boolean.TRUE.equals(tb.get("balanced"));
        out.add(check("TRIAL_BALANCE", "Trial balance: total debits = total credits",
            tbOk ? "OK" : "FAIL", tbOk ? "Closing debits equal closing credits." : "Closing debits and credits differ.",
            Map.of("debit", tb.get("closingDebit"), "credit", tb.get("closingCredit"))));

        Map<String, Object> pos = statements.financialPosition(null);
        boolean bsOk = Boolean.TRUE.equals(pos.get("balanced"));
        out.add(check("BALANCE_SHEET", "Statement of financial position: assets = equity + liabilities",
            bsOk ? "OK" : "FAIL", bsOk ? "The statement balances." : "Difference " + pos.get("difference"),
            Map.of("difference", pos.get("difference"))));

        Map<String, Object> cf = statements.cashFlows(null);
        boolean cfOk = Boolean.TRUE.equals(cf.get("reconciles"));
        out.add(check("CASH_FLOW", "Cash flow statement agrees to the change in cash and bank ledgers",
            cfOk ? "OK" : "FAIL", cfOk ? "Operating + investing + financing = movement in cash." : "Difference " + cf.get("difference"),
            Map.of("difference", cf.get("difference"))));

        BigDecimal stock = bd(jdbc.queryForObject("select coalesce(sum(qty_remaining * unit_cost), 0) from stock_layer", BigDecimal.class))
            .setScale(2, java.math.RoundingMode.HALF_UP);
        BigDecimal invLedger = ledgerClosing("1200");
        BigDecimal invDiff = stock.subtract(invLedger);
        boolean invOk = invDiff.abs().compareTo(BigDecimal.ONE) < 0;
        out.add(check("INVENTORY", "Stock valuation (FIFO layers) agrees to the Inventory ledger (1200)",
            invOk ? "OK" : "FAIL",
            invOk ? "Stock valuation equals the inventory ledger." : "Stock valuation and the inventory ledger differ by " + invDiff.abs() + ".",
            Map.of("stockValuation", stock, "inventoryLedger", invLedger, "difference", invDiff)));

        BigDecimal arParty = partyTotal("CUSTOMER"), arCtl = ledgerClosing("1100");
        out.add(check("RECEIVABLES", "Receivables: customer ledgers and unallocated receivable (1100)",
            "INFO", "Total receivable = customer ledgers + the general receivable account.",
            Map.of("customerLedgers", arParty, "unallocated", arCtl, "total", arParty.add(arCtl))));
        BigDecimal apParty = partyTotal("SUPPLIER").negate(), apCtl = ledgerClosing("2000").negate();
        out.add(check("PAYABLES", "Payables: supplier ledgers and unallocated payable (2000)",
            "INFO", "Total payable = supplier ledgers + the general payable account.",
            Map.of("supplierLedgers", apParty, "unallocated", apCtl, "total", apParty.add(apCtl))));

        Integer uncleared = jdbc.queryForObject(
            "select count(*) from journal_line jl join account a on a.id = jl.account_id "
          + "join account_group g on g.id = a.group_id "
          + "where g.code = 'A-BK' and not exists (select 1 from bank_reconciled_line r where r.journal_line_id = jl.id)",
            Integer.class);
        out.add(check("BANK_RECON", "Bank reconciliation", "INFO",
            uncleared + " bank ledger lines are not yet reconciled with a bank statement.", Map.of("unreconciled", uncleared)));

        boolean ok = out.stream().noneMatch(c -> "FAIL".equals(c.get("status")));
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ok", ok); res.put("checks", out); res.put("asOf", LocalDate.now().toString());
        return res;
    }

    private BigDecimal partyTotal(String partyType) {
        Map<String, Object> tb = reports.trialBalance(null);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) tb.get("rows");
        List<String> codes = jdbc.queryForList("select code from account where party_type = ?", String.class, partyType);
        BigDecimal s = BigDecimal.ZERO;
        for (Map<String, Object> r : rows)
            if (codes.contains((String) r.get("code")))
                s = s.add(bd(r.get("closing_debit")).subtract(bd(r.get("closing_credit"))));
        return s;
    }

    // ------------------------------------------------------------------ bank reconciliation
    private static String currentUser() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a != null && a.getPrincipal() instanceof com.mim.erp.auth.AuthPrincipal p ? p.username() : null;
    }

    public List<Map<String, Object>> bankAccounts() {
        return jdbc.queryForList(
            "select a.id, a.code, a.name, a.name_bn, "
          + "  (select max(statement_date) from bank_reconciliation r where r.account_id = a.id) as last_reconciled, "
          + "  (select count(*) from journal_line jl where jl.account_id = a.id "
          + "     and not exists (select 1 from bank_reconciled_line l where l.journal_line_id = jl.id)) as uncleared "
          + "from account a join account_group g on g.id = a.group_id "
          + "where g.code = 'A-BK' and a.active order by a.code");
    }

    private void assertBank(UUID accountId) {
        Integer n = jdbc.queryForObject(
            "select count(*) from account a join account_group g on g.id = a.group_id where a.id = ? and g.code = 'A-BK'",
            Integer.class, accountId);
        if (n == null || n == 0) throw new ApiException("Pick a ledger under Bank Accounts");
    }

    /** Ledger lines not yet matched to a statement, up to a date, plus the book balance on that date. */
    public Map<String, Object> bankOpenItems(UUID accountId, LocalDate upTo) {
        assertBank(accountId);
        List<Map<String, Object>> lines = jdbc.queryForList(
            "select jl.id, je.entry_date, je.entry_no, je.narration, jl.debit, jl.credit "
          + "from journal_line jl join journal_entry je on je.id = jl.journal_id "
          + "where jl.account_id = ? and je.entry_date <= ?::date "
          + "  and not exists (select 1 from bank_reconciled_line r where r.journal_line_id = jl.id) "
          + "order by je.entry_date, je.created_at", accountId, upTo.toString());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("asOf", upTo.toString());
        m.put("bookBalance", reports.balanceAsOf(accountId, upTo));
        m.put("lines", lines);
        return m;
    }

    @Transactional
    public Map<String, Object> bankReconcile(UUID accountId, LocalDate statementDate, BigDecimal statementBalance,
                                             List<UUID> lineIds, String note) {
        assertBank(accountId);
        if (statementBalance == null) throw new ApiException("Enter the closing balance shown on the bank statement");
        List<UUID> ids = lineIds == null ? List.of() : lineIds;

        BigDecimal unclearedAll = bd(jdbc.queryForObject(
            "select coalesce(sum(jl.debit - jl.credit), 0) from journal_line jl join journal_entry je on je.id = jl.journal_id "
          + "where jl.account_id = ? and je.entry_date <= ?::date "
          + "  and not exists (select 1 from bank_reconciled_line r where r.journal_line_id = jl.id)",
            BigDecimal.class, accountId, statementDate.toString()));
        BigDecimal selected = BigDecimal.ZERO;
        for (UUID id : ids) {
            List<BigDecimal> v = jdbc.queryForList(
                "select jl.debit - jl.credit from journal_line jl join journal_entry je on je.id = jl.journal_id "
              + "where jl.id = ? and jl.account_id = ? and je.entry_date <= ?::date "
              + "  and not exists (select 1 from bank_reconciled_line r where r.journal_line_id = jl.id)",
                BigDecimal.class, id, accountId, statementDate.toString());
            if (v.isEmpty()) throw new ApiException("A selected line is not available for this statement (already cleared or dated after the statement)");
            selected = selected.add(v.get(0));
        }
        BigDecimal book = reports.balanceAsOf(accountId, statementDate);
        BigDecimal stillUncleared = unclearedAll.subtract(selected);
        BigDecimal expected = book.subtract(stillUncleared);          // what the bank should show
        BigDecimal diff = statementBalance.subtract(expected);
        if (diff.signum() != 0)
            throw new ApiException("Not reconciled: the statement balance differs from the cleared book balance by "
                + diff.abs().toPlainString() + ". Tick the lines that appear on the statement.");

        UUID recId = UUID.randomUUID();
        jdbc.update("insert into bank_reconciliation (id, account_id, statement_date, statement_balance, book_balance, note, created_by) "
                  + "values (?, ?, ?::date, ?, ?, ?, ?)",
            recId, accountId, statementDate.toString(), statementBalance, book, note, currentUser());
        for (UUID id : ids)
            jdbc.update("insert into bank_reconciled_line (journal_line_id, reconciliation_id) values (?, ?)", id, recId);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", recId); m.put("cleared", ids.size());
        return m;
    }

    public List<Map<String, Object>> bankHistory(UUID accountId) {
        return jdbc.queryForList(
            "select r.id, r.statement_date, r.statement_balance, r.book_balance, r.note, r.created_by, r.created_at, "
          + "       (select count(*) from bank_reconciled_line l where l.reconciliation_id = r.id) as lines "
          + "from bank_reconciliation r where r.account_id = ? order by r.statement_date desc, r.created_at desc limit 50",
            accountId);
    }

    // ------------------------------------------------------------------ VAT / AIT summary
    public Map<String, Object> taxSummary(LocalDate from, LocalDate to) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("from", from.toString()); out.put("to", to.toString());
        Map<String, Map<String, Object>> accts = new LinkedHashMap<>();
        for (String code : List.of("2100", "1450", "2120", "1460", "2110", "1470")) {
            UUID id = jdbc.queryForList("select id from account where code = ?", UUID.class, code)
                .stream().findFirst().orElse(null);
            if (id != null) accts.put(code, reports.ledger(id, from, to));
        }
        BigDecimal outVat = side(accts.get("2100"), false), inVat = side(accts.get("1450"), true);
        out.put("outputVat", outVat);                       // VAT charged to customers in the period
        out.put("inputVat", inVat);                         // VAT paid to suppliers in the period
        BigDecimal vdsCredit = side(accts.get("1470"), true);         // VAT customers deducted from what they paid us
        out.put("vdsCredit", vdsCredit);
        out.put("vdsWithheld", side(accts.get("2110"), false));     // VAT we deducted from suppliers, owed to NBR
        out.put("netVatPayable", outVat.subtract(inVat).subtract(vdsCredit));
        out.put("aitWithheld", side(accts.get("2120"), false));   // tax deducted at source from payees
        out.put("aitPaid", side(accts.get("1460"), true));        // advance tax suffered on our sales
        out.put("accounts", accts);
        return out;
    }

    /** Net movement of a ledger in the period: debit side (assets) or credit side (liabilities). */
    private static BigDecimal side(Map<String, Object> ledger, boolean debitSide) {
        if (ledger == null) return BigDecimal.ZERO;
        BigDecimal d = bd(ledger.get("totalDebit")), c = bd(ledger.get("totalCredit"));
        return debitSide ? d.subtract(c) : c.subtract(d);
    }
}
