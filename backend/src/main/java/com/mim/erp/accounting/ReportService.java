package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Financial statements and ledgers, scoped to a financial year.
 * Balance = opening balance of the year + posted movement in the year.
 * Normal balances: ASSET/EXPENSE are debit-positive; LIABILITY/EQUITY/INCOME are credit-positive.
 * The year-end closing entry (source YEAR_CLOSE) is left out of the P&L so a closed year still
 * shows its profit, but it is part of the trial balance and balance sheet.
 */
@Service
public class ReportService {

    private final JdbcTemplate jdbc;
    private final FinancialYearRepository years;

    public ReportService(JdbcTemplate jdbc, FinancialYearRepository years) {
        this.jdbc = jdbc; this.years = years;
    }

    /** The financial year a report covers (null id = current year; no years at all = everything). */
    public record Period(String yearId, String name, String status, LocalDate start, LocalDate end) {}

    public Period period(UUID yearId) {
        FinancialYear fy = yearId != null
            ? years.findById(yearId).orElseThrow(() -> new ApiException("Financial year not found"))
            : years.findByIsCurrentTrue().orElse(null);
        if (fy == null) return new Period(null, "All", "OPEN", LocalDate.of(1900, 1, 1), LocalDate.of(2999, 12, 31));
        return new Period(fy.getId().toString(), fy.getName(), fy.getStatus(), fy.getStartDate(), fy.getEndDate());
    }

    /** The financial year immediately before the given one, or null. */
    public UUID previousYearId(UUID yearId) {
        Period p = period(yearId);
        return years.findAll().stream()
            .filter(y -> y.getEndDate().equals(p.start().minusDays(1)))
            .map(FinancialYear::getId).findFirst().orElse(null);
    }

    static BigDecimal bd(Object o) { return o == null ? BigDecimal.ZERO : (BigDecimal) o; }

    /** Per ledger: opening (Dr, Cr) and period debit / credit for the year, with group info. */
    public List<Map<String, Object>> accountRows(Period p, boolean excludeClose, String... types) {
        String typeList = "'" + String.join("','", types) + "'";
        String skipClose = excludeClose ? " and je.source_type is distinct from 'YEAR_CLOSE' " : " ";
        return jdbc.queryForList(
            "select a.id, a.code, a.name, a.name_bn, a.type, g.code as group_code, g.name as group_name, g.name_bn as group_name_bn, "
          + "       coalesce(ob.debit,0) as opening_debit, coalesce(ob.credit,0) as opening_credit, "
          + "       coalesce(mv.debit,0) as period_debit, coalesce(mv.credit,0) as period_credit "
          + "from account a "
          + "left join account_group g on g.id = a.group_id "
          + "left join opening_balance ob on ob.account_id = a.id and ob.financial_year_id = ?::uuid "
          + "left join ( select jl.account_id, sum(jl.debit) debit, sum(jl.credit) credit "
          + "            from journal_line jl join journal_entry je on je.id = jl.journal_id "
          + "            where je.entry_date between ?::date and ?::date" + skipClose
          + "            group by jl.account_id ) mv on mv.account_id = a.id "
          + "where a.type in (" + typeList + ") order by a.code",
            p.yearId(), p.start().toString(), p.end().toString());
    }

    static BigDecimal net(Map<String, Object> r) {
        return bd(r.get("opening_debit")).subtract(bd(r.get("opening_credit")))
            .add(bd(r.get("period_debit"))).subtract(bd(r.get("period_credit")));
    }

    private static Map<String, Object> head(Period p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("yearId", p.yearId()); m.put("yearName", p.name()); m.put("yearStatus", p.status());
        m.put("from", p.start().toString()); m.put("to", p.end().toString());
        return m;
    }

    // ------------------------------------------------------------------ trial balance
    public Map<String, Object> trialBalance(UUID yearId) {
        Period p = period(yearId);
        List<Map<String, Object>> rows = new ArrayList<>();
        BigDecimal od = BigDecimal.ZERO, oc = BigDecimal.ZERO, pd = BigDecimal.ZERO, pc = BigDecimal.ZERO,
                   cd = BigDecimal.ZERO, cc = BigDecimal.ZERO;
        for (Map<String, Object> r : accountRows(p, false, "ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE")) {
            BigDecimal n = net(r);
            Map<String, Object> o = new LinkedHashMap<>(r);
            BigDecimal closeDr = n.signum() > 0 ? n : BigDecimal.ZERO;
            BigDecimal closeCr = n.signum() < 0 ? n.negate() : BigDecimal.ZERO;
            o.put("closing_debit", closeDr); o.put("closing_credit", closeCr);
            rows.add(o);
            od = od.add(bd(r.get("opening_debit"))); oc = oc.add(bd(r.get("opening_credit")));
            pd = pd.add(bd(r.get("period_debit"))); pc = pc.add(bd(r.get("period_credit")));
            cd = cd.add(closeDr); cc = cc.add(closeCr);
        }
        Map<String, Object> out = head(p);
        out.put("rows", rows);
        out.put("openingDebit", od); out.put("openingCredit", oc);
        out.put("periodDebit", pd); out.put("periodCredit", pc);
        out.put("closingDebit", cd); out.put("closingCredit", cc);
        out.put("balanced", cd.compareTo(cc) == 0);
        return out;
    }

    // ------------------------------------------------------------------ profit & loss (simple)
    public Map<String, Object> profitAndLoss(UUID yearId) {
        Period p = period(yearId);
        List<Map<String, Object>> income = new ArrayList<>(), expense = new ArrayList<>();
        BigDecimal ti = BigDecimal.ZERO, te = BigDecimal.ZERO;
        for (Map<String, Object> r : accountRows(p, true, "INCOME", "EXPENSE")) {
            boolean inc = "INCOME".equals(r.get("type"));
            BigDecimal amt = inc ? bd(r.get("period_credit")).subtract(bd(r.get("period_debit")))
                                 : bd(r.get("period_debit")).subtract(bd(r.get("period_credit")));
            if (amt.signum() == 0) continue;
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("code", r.get("code")); o.put("name", r.get("name")); o.put("nameBn", r.get("name_bn"));
            o.put("groupCode", r.get("group_code")); o.put("groupName", r.get("group_name"));
            o.put("amount", amt);
            if (inc) { income.add(o); ti = ti.add(amt); } else { expense.add(o); te = te.add(amt); }
        }
        Map<String, Object> out = head(p);
        out.put("income", income); out.put("expense", expense);
        out.put("totalIncome", ti); out.put("totalExpense", te);
        out.put("netProfit", ti.subtract(te));
        return out;
    }

    // ------------------------------------------------------------------ balance sheet (simple)
    public Map<String, Object> balanceSheet(UUID yearId) {
        Period p = period(yearId);
        List<Map<String, Object>> assets = new ArrayList<>(), liabilities = new ArrayList<>(), equity = new ArrayList<>();
        BigDecimal ta = BigDecimal.ZERO, tl = BigDecimal.ZERO, te = BigDecimal.ZERO, plNet = BigDecimal.ZERO;
        for (Map<String, Object> r : accountRows(p, false, "ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE")) {
            BigDecimal n = net(r);
            String type = (String) r.get("type");
            if ("INCOME".equals(type) || "EXPENSE".equals(type)) { plNet = plNet.add(n); continue; }
            if (n.signum() == 0) continue;
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("code", r.get("code")); o.put("name", r.get("name")); o.put("nameBn", r.get("name_bn"));
            o.put("groupCode", r.get("group_code")); o.put("groupName", r.get("group_name"));
            o.put("amount", "ASSET".equals(type) ? n : n.negate());
            switch (type) {
                case "ASSET" -> { assets.add(o); ta = ta.add(n); }
                case "LIABILITY" -> { liabilities.add(o); tl = tl.add(n.negate()); }
                default -> { equity.add(o); te = te.add(n.negate()); }
            }
        }
        // profit of the year not yet closed into Retained Earnings (zero once the year is closed)
        BigDecimal profit = plNet.negate();
        BigDecimal totalEquity = te.add(profit);
        BigDecimal totalLE = tl.add(totalEquity);
        Map<String, Object> out = head(p);
        out.put("assets", assets); out.put("liabilities", liabilities); out.put("equity", equity);
        out.put("retainedEarnings", profit);
        out.put("totalAssets", ta); out.put("totalLiabilities", tl); out.put("totalEquity", totalEquity);
        out.put("totalLiabilitiesAndEquity", totalLE);
        out.put("balanced", ta.compareTo(totalLE) == 0);
        return out;
    }

    // ------------------------------------------------------------------ general ledger
    public Map<String, Object> ledger(UUID accountId, LocalDate from, LocalDate to) {
        Map<String, Object> acct = jdbc.queryForList(
            "select id, code, name, name_bn, type from account where id = ?", accountId)
            .stream().findFirst().orElseThrow(() -> new ApiException("Ledger not found"));
        if (to.isBefore(from)) throw new ApiException("'To' date is before 'From' date");

        // opening = year opening + movement from the year's start up to the day before 'from'
        FinancialYear fy = years.findAll().stream()
            .filter(y -> !from.isBefore(y.getStartDate()) && !from.isAfter(y.getEndDate())).findFirst().orElse(null);
        BigDecimal opening = BigDecimal.ZERO;
        LocalDate base = LocalDate.of(1900, 1, 1);
        if (fy != null) {
            base = fy.getStartDate();
            opening = bd(jdbc.queryForObject(
                "select coalesce(sum(debit - credit),0) from opening_balance where account_id = ? and financial_year_id = ?",
                BigDecimal.class, accountId, fy.getId()));
        }
        opening = opening.add(bd(jdbc.queryForObject(
            "select coalesce(sum(jl.debit - jl.credit),0) from journal_line jl join journal_entry je on je.id = jl.journal_id "
          + "where jl.account_id = ? and je.entry_date >= ?::date and je.entry_date < ?::date",
            BigDecimal.class, accountId, base.toString(), from.toString())));

        List<Map<String, Object>> raw = jdbc.queryForList(
            "select je.entry_date, je.entry_no, je.narration, je.source_type, jl.ref_no, jl.debit, jl.credit "
          + "from journal_line jl join journal_entry je on je.id = jl.journal_id "
          + "where jl.account_id = ? and je.entry_date between ?::date and ?::date "
          + "order by je.entry_date, je.created_at, je.entry_no",
            accountId, from.toString(), to.toString());
        List<Map<String, Object>> rows = new ArrayList<>();
        BigDecimal run = opening, td = BigDecimal.ZERO, tc = BigDecimal.ZERO;
        for (Map<String, Object> r : raw) {
            BigDecimal d = bd(r.get("debit")), c = bd(r.get("credit"));
            run = run.add(d).subtract(c); td = td.add(d); tc = tc.add(c);
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("date", String.valueOf(r.get("entry_date")));
            o.put("entryNo", r.get("entry_no")); o.put("narration", r.get("narration"));
            o.put("sourceType", r.get("source_type")); o.put("refNo", r.get("ref_no"));
            o.put("debit", d); o.put("credit", c); o.put("balance", run);
            rows.add(o);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("account", acct);
        out.put("from", from.toString()); out.put("to", to.toString());
        out.put("openingBalance", opening);
        out.put("rows", rows);
        out.put("totalDebit", td); out.put("totalCredit", tc);
        out.put("closingBalance", run);
        return out;
    }

    // ------------------------------------------------------------------ party aging
    /**
     * Receivable (CUSTOMER) / payable (SUPPLIER) aging as of a date, bill-wise: each bill's amount still
     * open on that date (settlements dated after it don't count), bucketed by days past its due date:
     * 0-30, 31-60, 61-90, 90+. Unallocated receipts / payments / credit notes are "unapplied" (advance);
     * total = open bills - unapplied = the party ledger balance.
     */
    public Map<String, Object> aging(String partyType, LocalDate asOf) {
        boolean cust = !"SUPPLIER".equalsIgnoreCase(partyType);
        String pt = cust ? "CUSTOMER" : "SUPPLIER";
        List<Map<String, Object>> items = jdbc.queryForList("""
            select i.account_id, i.kind, i.due_date,
                   i.amount - coalesce((select sum(x.amount) from bill_allocation x
                                        join party_item o on o.id = case when x.bill_id = i.id then x.credit_id else x.bill_id end
                                        where (x.bill_id = i.id or x.credit_id = i.id) and o.doc_date <= ?::date), 0) as open_amount
            from party_item i
            where i.party_type = ? and i.doc_date <= ?::date
        """, asOf.toString(), pt, asOf.toString());
        Map<UUID, BigDecimal[]> byAccount = new LinkedHashMap<>();   // current, 31-60, 61-90, 90+, unapplied
        for (Map<String, Object> it : items) {
            BigDecimal open = bd(it.get("open_amount"));
            if (open.signum() <= 0) continue;
            BigDecimal[] b = byAccount.computeIfAbsent((UUID) it.get("account_id"),
                k -> new BigDecimal[]{BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO});
            if ("CREDIT".equals(it.get("kind"))) { b[4] = b[4].add(open); continue; }
            long late = Math.max(0, ChronoUnit.DAYS.between(((java.sql.Date) it.get("due_date")).toLocalDate(), asOf));
            int k = late <= 30 ? 0 : late <= 60 ? 1 : late <= 90 ? 2 : 3;
            b[k] = b[k].add(open);
        }

        List<Map<String, Object>> rows = new ArrayList<>();
        BigDecimal[] tot = {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO};
        BigDecimal totBalance = BigDecimal.ZERO;
        for (Map<String, Object> party : jdbc.queryForList(
                "select id, code, name, name_bn from account where party_type = ? order by code", pt)) {
            UUID id = (UUID) party.get("id");
            BigDecimal[] b = byAccount.get(id);
            if (b == null) continue;
            BigDecimal bal = b[0].add(b[1]).add(b[2]).add(b[3]).subtract(b[4]);
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("accountId", id); o.put("code", party.get("code"));
            o.put("name", party.get("name")); o.put("nameBn", party.get("name_bn"));
            o.put("current", b[0]); o.put("d31_60", b[1]); o.put("d61_90", b[2]); o.put("over90", b[3]);
            o.put("unapplied", b[4]); o.put("total", bal);
            rows.add(o);
            for (int i = 0; i < 5; i++) tot[i] = tot[i].add(b[i]);
            totBalance = totBalance.add(bal);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("partyType", pt); out.put("asOf", asOf.toString());
        out.put("rows", rows);
        out.put("totals", Map.of("current", tot[0], "d31_60", tot[1], "d61_90", tot[2], "over90", tot[3],
            "unapplied", tot[4], "total", totBalance));
        return out;
    }

    /** Book balance of one ledger (debit-positive) on a date: year opening + movement from the year start. */
    public BigDecimal balanceAsOf(UUID accountId, LocalDate asOf) {
        FinancialYear fy = years.findAll().stream()
            .filter(y -> !asOf.isBefore(y.getStartDate()) && !asOf.isAfter(y.getEndDate())).findFirst().orElse(null);
        LocalDate base = fy == null ? LocalDate.of(1900, 1, 1) : fy.getStartDate();
        BigDecimal opening = fy == null ? BigDecimal.ZERO : bd(jdbc.queryForObject(
            "select coalesce(sum(debit - credit),0) from opening_balance where account_id = ? and financial_year_id = ?",
            BigDecimal.class, accountId, fy.getId()));
        return opening.add(bd(jdbc.queryForObject(
            "select coalesce(sum(jl.debit - jl.credit),0) from journal_line jl join journal_entry je on je.id = jl.journal_id "
          + "where jl.account_id = ? and je.entry_date between ?::date and ?::date",
            BigDecimal.class, accountId, base.toString(), asOf.toString())));
    }
}
