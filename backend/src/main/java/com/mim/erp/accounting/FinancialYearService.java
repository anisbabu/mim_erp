package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class FinancialYearService {

    private final FinancialYearRepository years;
    private final OpeningBalanceRepository openings;

    private final AccountingService accounting;
    private final JdbcTemplate jdbc;
    private final BillService bills;

    public FinancialYearService(FinancialYearRepository years, OpeningBalanceRepository openings,
                                AccountingService accounting, JdbcTemplate jdbc, BillService bills) {
        this.years = years; this.openings = openings; this.accounting = accounting; this.jdbc = jdbc; this.bills = bills;
    }

    public List<FinancialYear> list() { return years.findAllByOrderByStartDateDesc(); }

    public FinancialYear current() {
        return years.findByIsCurrentTrue().orElseThrow(() -> new ApiException("No current financial year set"));
    }

    @Transactional
    public FinancialYear create(FinancialYear in) {
        if (in.getName() == null || in.getStartDate() == null || in.getEndDate() == null)
            throw new ApiException("Year name, start and end dates are required");
        if (!in.getEndDate().isAfter(in.getStartDate()))
            throw new ApiException("End date must be after start date");
        in.setId(null);
        in.setStatus("OPEN");
        boolean makeCurrent = in.isCurrent();
        in.setCurrent(false);
        FinancialYear saved = years.save(in);
        if (makeCurrent) setCurrent(saved.getId());
        return saved;
    }

    @Transactional
    public void setCurrent(UUID id) {
        FinancialYear fy = years.findById(id).orElseThrow(() -> new ApiException("Financial year not found"));
        years.findAll().forEach(y -> { if (y.isCurrent()) { y.setCurrent(false); years.save(y); } });
        fy.setCurrent(true);
        years.save(fy);
    }

    @Transactional
    public OpeningBalance setOpening(UUID financialYearId, UUID accountId, BigDecimal debit, BigDecimal credit) {
        if (debit != null && credit != null && debit.signum() > 0 && credit.signum() > 0)
            throw new ApiException("An opening balance is either a debit or a credit, not both");
        OpeningBalance ob = openings.findByFinancialYearIdAndAccountId(financialYearId, accountId)
            .orElseGet(() -> { OpeningBalance n = new OpeningBalance();
                n.setFinancialYearId(financialYearId); n.setAccountId(accountId); return n; });
        ob.setDebit(debit == null ? BigDecimal.ZERO : debit);
        ob.setCredit(credit == null ? BigDecimal.ZERO : credit);
        OpeningBalance saved = openings.saveAndFlush(ob);
        bills.syncOpenings();   // bill-wise OPENING item for party ledgers
        return saved;
    }

    public List<OpeningBalance> openings(UUID financialYearId) {
        return openings.findByFinancialYearId(financialYearId);
    }

    /**
     * Year-end close:
     *  1. posts a closing entry on the last day that zeroes every income / expense ledger and
     *     moves the net profit (or loss) into Retained Earnings (3100);
     *  2. carries each asset / liability / equity closing balance into the next year as its opening;
     *  3. locks the year: nothing more can be posted into it.
     */
    @Transactional
    public FinancialYear close(UUID id) {
        FinancialYear fy = years.findById(id).orElseThrow(() -> new ApiException("Financial year not found"));
        if (!"OPEN".equals(fy.getStatus())) throw new ApiException("This financial year is already closed");
        if (years.existsByStartDateBeforeAndStatus(fy.getStartDate(), "OPEN"))
            throw new ApiException("Close the earlier financial year first");
        FinancialYear next = years.findByStartDate(fy.getEndDate().plusDays(1)).orElseThrow(() ->
            new ApiException("Create the next financial year first (it must start on " + fy.getEndDate().plusDays(1) + ")"));
        String from = fy.getStartDate().toString(), to = fy.getEndDate().toString();

        // 1. closing entry for income / expense
        List<Map<String, Object>> pl = jdbc.queryForList("""
            select a.code, sum(jl.debit) - sum(jl.credit) as net
            from account a
            join journal_line jl on jl.account_id = a.id
            join journal_entry je on je.id = jl.journal_id
            where a.type in ('INCOME','EXPENSE') and je.entry_date between ?::date and ?::date
            group by a.code
            having sum(jl.debit) - sum(jl.credit) <> 0
            order by a.code
        """, from, to);
        UUID entryId = null;
        if (!pl.isEmpty()) {
            List<AccountingService.Leg> legs = new ArrayList<>();
            BigDecimal total = BigDecimal.ZERO;
            for (Map<String, Object> r : pl) {
                BigDecimal net = (BigDecimal) r.get("net");
                String code = (String) r.get("code");
                legs.add(net.signum() > 0 ? AccountingService.Leg.credit(code, net)
                                          : AccountingService.Leg.debit(code, net.negate()));
                total = total.add(net);
            }
            // total > 0 => expenses exceeded income => loss: debit retained earnings
            if (total.signum() != 0)
                legs.add(total.signum() > 0 ? AccountingService.Leg.debit("3100", total)
                                            : AccountingService.Leg.credit("3100", total.negate()));
            JournalEntry je = accounting.post(fy.getEndDate(), "Year-end closing entry " + fy.getName(),
                "YEAR_CLOSE", fy.getId(), legs);
            entryId = je.getId();
        }

        // 2. carry balance-sheet closings into the next year
        jdbc.update("delete from opening_balance where financial_year_id = ?", next.getId());
        jdbc.update("""
            insert into opening_balance (id, financial_year_id, account_id, debit, credit)
            select gen_random_uuid(), ?, x.account_id,
                   greatest(x.net, 0), greatest(-x.net, 0)
            from (
              select a.id as account_id,
                     coalesce(ob.debit - ob.credit, 0) + coalesce(mv.net, 0) as net
              from account a
              left join opening_balance ob on ob.account_id = a.id and ob.financial_year_id = ?
              left join (
                select jl.account_id, sum(jl.debit - jl.credit) as net
                from journal_line jl join journal_entry je on je.id = jl.journal_id
                where je.entry_date between ?::date and ?::date
                group by jl.account_id
              ) mv on mv.account_id = a.id
              where a.type in ('ASSET','LIABILITY','EQUITY')
            ) x
            where x.net <> 0
        """, next.getId(), fy.getId(), from, to);

        // 3. lock
        fy.setStatus("CLOSED");
        fy.setClosedAt(OffsetDateTime.now());
        fy.setClosingEntryId(entryId);
        years.save(fy);
        if (fy.isCurrent()) setCurrent(next.getId());
        bills.syncOpenings();
        return fy;
    }

    /** Undo the latest close (admin): removes the closing entry and the carried-forward openings. */
    @Transactional
    public FinancialYear reopen(UUID id) {
        FinancialYear fy = years.findById(id).orElseThrow(() -> new ApiException("Financial year not found"));
        if (!"CLOSED".equals(fy.getStatus())) throw new ApiException("This financial year is not closed");
        if (years.existsByStartDateAfterAndStatus(fy.getStartDate(), "CLOSED"))
            throw new ApiException("Reopen the later closed year first");
        FinancialYear next = years.findByStartDate(fy.getEndDate().plusDays(1)).orElse(null);
        if (next != null) {
            Integer posted = jdbc.queryForObject(
                "select count(*) from journal_entry where entry_date between ?::date and ?::date",
                Integer.class, next.getStartDate().toString(), next.getEndDate().toString());
            if (posted != null && posted > 0)
                throw new ApiException("Next year already has postings — it can't be reset, so this year stays closed");
            jdbc.update("delete from opening_balance where financial_year_id = ?", next.getId());
        }
        if (fy.getClosingEntryId() != null) {
            // the one sanctioned deletion of a posted entry: undoing a year close
            jdbc.queryForObject("select set_config('mim.allow_journal_change', 'on', true)", String.class);
            jdbc.update("delete from journal_entry where id = ?", fy.getClosingEntryId());
            jdbc.queryForObject("select set_config('mim.allow_journal_change', 'off', true)", String.class);
        }
        fy.setStatus("OPEN");
        fy.setClosedAt(null);
        fy.setClosingEntryId(null);
        years.save(fy);
        bills.syncOpenings();
        return fy;
    }
}
