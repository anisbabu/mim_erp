package com.mim.erp.accounting;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Financial statements derived from journal_line, grouped by account type.
 * Normal balances: ASSET/EXPENSE are debit-positive; LIABILITY/EQUITY/INCOME are credit-positive.
 */
@Service
public class ReportService {

    private final JdbcTemplate jdbc;

    public ReportService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /** Net balance per account (debit - credit), with type, for downstream statements. */
    private List<Map<String,Object>> balances() {
        return jdbc.queryForList("""
            select a.code, a.name, a.type,
                   coalesce(sum(jl.debit),0) - coalesce(sum(jl.credit),0) as net
            from account a
            left join journal_line jl on jl.account_id = a.id
            group by a.id, a.code, a.name, a.type
            order by a.code
        """);
    }

    /** Profit & Loss: income (credit-positive) minus expenses (debit-positive). */
    public Map<String,Object> profitAndLoss() {
        List<Map<String,Object>> income = jdbc.queryForList("""
            select a.code, a.name, coalesce(sum(jl.credit - jl.debit),0) as amount
            from account a left join journal_line jl on jl.account_id = a.id
            where a.type = 'INCOME'
            group by a.id, a.code, a.name order by a.code
        """);
        List<Map<String,Object>> expense = jdbc.queryForList("""
            select a.code, a.name, coalesce(sum(jl.debit - jl.credit),0) as amount
            from account a left join journal_line jl on jl.account_id = a.id
            where a.type = 'EXPENSE'
            group by a.id, a.code, a.name order by a.code
        """);
        BigDecimal totalIncome  = sum(income);
        BigDecimal totalExpense = sum(expense);
        Map<String,Object> out = new LinkedHashMap<>();
        out.put("income", income);
        out.put("expense", expense);
        out.put("totalIncome", totalIncome);
        out.put("totalExpense", totalExpense);
        out.put("netProfit", totalIncome.subtract(totalExpense));
        return out;
    }

    /** Balance sheet: assets vs liabilities + equity (incl. retained earnings = net profit). */
    public Map<String,Object> balanceSheet() {
        List<Map<String,Object>> assets = jdbc.queryForList("""
            select a.code, a.name, coalesce(sum(jl.debit - jl.credit),0) as amount
            from account a left join journal_line jl on jl.account_id = a.id
            where a.type = 'ASSET'
            group by a.id, a.code, a.name order by a.code
        """);
        List<Map<String,Object>> liabilities = jdbc.queryForList("""
            select a.code, a.name, coalesce(sum(jl.credit - jl.debit),0) as amount
            from account a left join journal_line jl on jl.account_id = a.id
            where a.type = 'LIABILITY'
            group by a.id, a.code, a.name order by a.code
        """);
        List<Map<String,Object>> equity = jdbc.queryForList("""
            select a.code, a.name, coalesce(sum(jl.credit - jl.debit),0) as amount
            from account a left join journal_line jl on jl.account_id = a.id
            where a.type = 'EQUITY'
            group by a.id, a.code, a.name order by a.code
        """);
        BigDecimal totalAssets = sum(assets);
        BigDecimal netProfit = (BigDecimal) profitAndLoss().get("netProfit");
        BigDecimal totalEquity = sum(equity).add(netProfit);     // retained earnings folded in
        BigDecimal totalLiabEquity = sum(liabilities).add(totalEquity);

        Map<String,Object> out = new LinkedHashMap<>();
        out.put("assets", assets);
        out.put("liabilities", liabilities);
        out.put("equity", equity);
        out.put("retainedEarnings", netProfit);
        out.put("totalAssets", totalAssets);
        out.put("totalLiabilitiesAndEquity", totalLiabEquity);
        out.put("balanced", totalAssets.compareTo(totalLiabEquity) == 0);
        return out;
    }

    private BigDecimal sum(List<Map<String,Object>> rows) {
        return rows.stream()
            .map(r -> (BigDecimal) r.get("amount"))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
