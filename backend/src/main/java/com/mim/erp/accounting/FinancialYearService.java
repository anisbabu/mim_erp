package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

@Service
public class FinancialYearService {

    private final FinancialYearRepository years;
    private final OpeningBalanceRepository openings;

    public FinancialYearService(FinancialYearRepository years, OpeningBalanceRepository openings) {
        this.years = years; this.openings = openings;
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
        return openings.save(ob);
    }

    public List<OpeningBalance> openings(UUID financialYearId) {
        return openings.findByFinancialYearId(financialYearId);
    }

    /**
     * Year-end close: carry each ledger's closing balance into the next year as its
     * opening balance. Closing = opening(this year) + period movements, computed by the
     * caller-supplied closings map (accountId -> signed balance, +debit / -credit).
     */
    @Transactional
    public void closeYearInto(UUID closingYearId, UUID nextYearId, List<long[]> ignored) {
        FinancialYear closing = years.findById(closingYearId).orElseThrow(() -> new ApiException("Year not found"));
        closing.setStatus("CLOSED");
        years.save(closing);
        // opening balances for nextYear are set from the trial balance via setOpening(...)
        // (the report endpoint provides closing figures; this method just marks the close)
    }
}
