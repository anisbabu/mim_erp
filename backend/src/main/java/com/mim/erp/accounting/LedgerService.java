package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import com.mim.erp.master.Customer;
import com.mim.erp.master.CustomerRepository;
import com.mim.erp.master.Supplier;
import com.mim.erp.master.SupplierRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Chart-of-accounts service: groups, ledgers, and the per-party subsidiary
 * ledgers (one ledger per supplier under Sundry Creditors, one per customer
 * under Sundry Debtors) that give every party its own running balance.
 */
@Service
public class LedgerService {

    private final AccountRepository accounts;
    private final AccountGroupRepository groups;
    private final SupplierRepository suppliers;
    private final CustomerRepository customers;
    private final FinancialYearRepository years;
    private final JdbcTemplate jdbc;

    public LedgerService(AccountRepository accounts, AccountGroupRepository groups,
                         SupplierRepository suppliers, CustomerRepository customers,
                         FinancialYearRepository years, JdbcTemplate jdbc) {
        this.accounts = accounts; this.groups = groups; this.suppliers = suppliers;
        this.customers = customers; this.years = years; this.jdbc = jdbc;
    }

    // ---- subsidiary (party) ledgers ----
    @Transactional
    public Account supplierLedger(UUID supplierId) {
        return accounts.findByPartyTypeAndPartyId("SUPPLIER", supplierId).orElseGet(() -> {
            Supplier s = suppliers.findById(supplierId).orElseThrow(() -> new ApiException("Supplier not found"));
            AccountGroup g = groups.findByCode("SC").orElseThrow(() -> new ApiException("Sundry Creditors group missing"));
            Account a = new Account();
            a.setCode("SC-" + s.getCode());
            a.setName(s.getName());
            a.setNameBn(s.getNameBn());
            a.setType("LIABILITY");
            a.setGroupId(g.getId());
            a.setPartyType("SUPPLIER");
            a.setPartyId(supplierId);
            return accounts.save(a);
        });
    }

    @Transactional
    public Account customerLedger(UUID customerId) {
        return accounts.findByPartyTypeAndPartyId("CUSTOMER", customerId).orElseGet(() -> {
            Customer c = customers.findById(customerId).orElseThrow(() -> new ApiException("Customer not found"));
            AccountGroup g = groups.findByCode("SD").orElseThrow(() -> new ApiException("Sundry Debtors group missing"));
            Account a = new Account();
            a.setCode("SD-" + c.getCode());
            a.setName(c.getName());
            a.setNameBn(c.getNameBn());
            a.setType("ASSET");
            a.setGroupId(g.getId());
            a.setPartyType("CUSTOMER");
            a.setPartyId(customerId);
            return accounts.save(a);
        });
    }

    /** A customer's current receivable: opening of the current year + this year's movement (Dr − Cr). */
    public java.math.BigDecimal customerBalance(UUID customerId) {
        Account a = accounts.findByPartyTypeAndPartyId("CUSTOMER", customerId).orElse(null);
        if (a == null) return java.math.BigDecimal.ZERO;
        FinancialYear fy = years.findByIsCurrentTrue().orElse(null);
        String fyId = fy == null ? null : fy.getId().toString();
        String start = fy == null ? "1900-01-01" : fy.getStartDate().toString();
        String end = fy == null ? "2999-12-31" : fy.getEndDate().toString();
        return jdbc.queryForObject("""
            select coalesce((select debit - credit from opening_balance
                             where account_id = ? and financial_year_id = ?::uuid), 0)
                 + coalesce((select sum(jl.debit - jl.credit)
                             from journal_line jl join journal_entry je on je.id = jl.journal_id
                             where jl.account_id = ? and je.entry_date between ?::date and ?::date), 0)
        """, java.math.BigDecimal.class, a.getId(), fyId, a.getId(), start, end);
    }

    // ---- COA reads ----
    public List<AccountGroup> listGroups() { return groups.findAll(); }

    /** Ledgers with opening + period movement + closing for the current financial year. */
    public List<Map<String,Object>> listLedgersWithBalance() {
        FinancialYear fy = years.findByIsCurrentTrue().orElse(null);
        String fyId = fy == null ? null : fy.getId().toString();
        String start = fy == null ? "1900-01-01" : fy.getStartDate().toString();
        String end = fy == null ? "2999-12-31" : fy.getEndDate().toString();
        return jdbc.queryForList("""
            select a.id, a.code, a.name, a.name_bn, a.type, a.group_id, a.party_type, a.is_system, a.default_deposit,
                   coalesce(ob.debit,0) as opening_debit, coalesce(ob.credit,0) as opening_credit,
                   coalesce(mv.debit,0) as period_debit, coalesce(mv.credit,0) as period_credit,
                   (coalesce(ob.debit,0) - coalesce(ob.credit,0)
                    + coalesce(mv.debit,0) - coalesce(mv.credit,0)) as closing
            from account a
            left join opening_balance ob on ob.account_id = a.id and ob.financial_year_id = ?::uuid
            left join (
              select jl.account_id, sum(jl.debit) debit, sum(jl.credit) credit
              from journal_line jl join journal_entry je on je.id = jl.journal_id
              where je.entry_date between ?::date and ?::date
              group by jl.account_id
            ) mv on mv.account_id = a.id
            order by a.code
        """, fyId, start, end);
    }

    // ---- COA writes ----
    @Transactional
    public AccountGroup createGroup(AccountGroup g) {
        if (g.getCode() == null || g.getName() == null) throw new ApiException("Group code and name are required");
        g.setId(null); g.setSystem(false);
        return groups.save(g);
    }

    @Transactional
    public Account createLedger(Account a) {
        if (a.getCode() == null || a.getName() == null) throw new ApiException("Ledger code and name are required");
        if (a.getGroupId() == null) throw new ApiException("Pick an account head (group) for the ledger");
        AccountGroup g = groups.findById(a.getGroupId()).orElseThrow(() -> new ApiException("Group not found"));
        a.setId(null); a.setSystem(false);
        a.setType(g.getNature());   // ledger nature follows its group
        boolean makeDefault = a.isDefaultDeposit();
        a.setDefaultDeposit(false);
        a = accounts.save(a);
        applyDefaultDeposit(a, makeDefault);
        return a;
    }

    /**
     * Only one bank ledger is the default a cheque is deposited to. Setting it here
     * clears the previous one; it is refused outside the Bank Accounts head.
     */
    private void applyDefaultDeposit(Account a, boolean makeDefault) {
        if (!makeDefault) { a.setDefaultDeposit(false); return; }
        UUID bankHead = groups.findByCode("A-BK").map(AccountGroup::getId).orElse(null);
        if (bankHead == null || !bankHead.equals(a.getGroupId()))
            throw new ApiException("Only a ledger under Bank Accounts can be the default for cheques");
        if (!a.isActive()) throw new ApiException("An inactive ledger can't be the default for cheques");
        jdbc.update("update account set default_deposit = false where default_deposit and id <> ?", a.getId());
        a.setDefaultDeposit(true);
        accounts.save(a);
    }

    @Transactional
    public Account updateLedger(UUID id, Account in) {
        Account a = accounts.findById(id).orElseThrow(() -> new ApiException("Ledger not found"));
        a.setName(in.getName()); a.setNameBn(in.getNameBn());
        if (in.getGroupId() != null) {
            AccountGroup g = groups.findById(in.getGroupId()).orElseThrow(() -> new ApiException("Group not found"));
            a.setGroupId(g.getId()); a.setType(g.getNature());
        }
        a.setActive(in.isActive());
        a = accounts.save(a);
        applyDefaultDeposit(a, in.isDefaultDeposit());
        return a;
    }

    @Transactional
    public void deleteLedger(UUID id) {
        Account a = accounts.findById(id).orElseThrow(() -> new ApiException("Ledger not found"));
        if (a.isSystem()) throw new ApiException("System ledgers can't be deleted — deactivate instead");
        try { accounts.deleteById(id); }
        catch (DataIntegrityViolationException ex) {
            throw new ApiException("Ledger has postings and can't be deleted — deactivate instead");
        }
    }
}
