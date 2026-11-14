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

    /**
     * A customer's receivable just before and just after the entries posted for one sale, so a printed
     * slip keeps showing the balance as it stood then. Returns {before, after}; both equal the
     * current balance when the sale posted nothing.
     */
    public java.math.BigDecimal[] customerBalanceAround(UUID customerId, UUID soId, java.time.LocalDate orderDate) {
        Account a = accounts.findByPartyTypeAndPartyId("CUSTOMER", customerId).orElse(null);
        java.math.BigDecimal zero = java.math.BigDecimal.ZERO;
        if (a == null) return new java.math.BigDecimal[]{zero, zero};
        FinancialYear fy = (orderDate == null ? java.util.Optional.<FinancialYear>empty()
                : years.findFirstByStartDateLessThanEqualAndEndDateGreaterThanEqual(orderDate, orderDate))
            .or(years::findByIsCurrentTrue).orElse(null);
        String fyId = fy == null ? null : fy.getId().toString();
        String start = fy == null ? "1900-01-01" : fy.getStartDate().toString();
        String end = fy == null ? "2999-12-31" : fy.getEndDate().toString();

        Map<String, Object> posted = jdbc.queryForMap(
            "select min(created_at) as first_at, max(created_at) as last_at from journal_entry "
          + "where source_id = ? and source_type in ('SALES_DELIVERY','SALES_INVOICE')", soId);
        Object first = posted.get("first_at"), last = posted.get("last_at");

        String sql = """
            select coalesce((select debit - credit from opening_balance
                             where account_id = ? and financial_year_id = ?::uuid), 0)
                 + coalesce((select sum(jl.debit - jl.credit)
                             from journal_line jl join journal_entry je on je.id = jl.journal_id
                             where jl.account_id = ? and je.entry_date between ?::date and ?::date
        """;
        if (first == null)
            first = last = java.sql.Timestamp.from(java.time.Instant.now().plusSeconds(1));
        java.math.BigDecimal before = jdbc.queryForObject(sql + " and je.created_at < ?), 0)",
            java.math.BigDecimal.class, a.getId(), fyId, a.getId(), start, end, first);
        java.math.BigDecimal after = jdbc.queryForObject(sql + " and je.created_at <= ?), 0)",
            java.math.BigDecimal.class, a.getId(), fyId, a.getId(), start, end, last);
        return new java.math.BigDecimal[]{before, after};
    }

    /**
     * Sales value already booked (Sales 4000, Sales Discount 4010, Transport 4400 and Output VAT 2100, net) by journals of one
     * source type for the given documents. Lets later postings top up only what is missing, so orders
     * booked under the old "revenue at order" rule are never booked twice.
     */
    public java.math.BigDecimal revenueBooked(String sourceType, java.util.Collection<UUID> sourceIds) {
        return booked("'4000','4010','4400','2100'", sourceType, sourceIds);
    }

    /** Output VAT (2100, net) already booked for the given documents. */
    public java.math.BigDecimal vatBooked(String sourceType, java.util.Collection<UUID> sourceIds) {
        return booked("'2100'", sourceType, sourceIds);
    }

    /** Trade discount (Sales Discount 4010, a debit) already booked for the given documents. */
    public java.math.BigDecimal discountBooked(String sourceType, java.util.Collection<UUID> sourceIds) {
        return booked("'4010'", sourceType, sourceIds).negate();
    }

    private java.math.BigDecimal booked(String codes, String sourceType, java.util.Collection<UUID> sourceIds) {
        if (sourceIds == null || sourceIds.isEmpty()) return java.math.BigDecimal.ZERO;
        String marks = String.join(",", java.util.Collections.nCopies(sourceIds.size(), "?"));
        List<Object> args = new java.util.ArrayList<>();
        args.add(sourceType);
        args.addAll(sourceIds);
        return jdbc.queryForObject(
            "select coalesce(sum(jl.credit - jl.debit), 0) from journal_line jl "
          + "join journal_entry je on je.id = jl.journal_id join account a on a.id = jl.account_id "
          + "where a.code in (" + codes + ") and je.source_type = ? and je.source_id in (" + marks + ")",
            java.math.BigDecimal.class, args.toArray());
    }

    /**
     * Value of a customer's open credit orders not yet delivered (so not yet in the ledger):
     * order total + transport minus the revenue already booked for each order.
     */
    public java.math.BigDecimal undeliveredCreditOrders(UUID customerId) {
        return jdbc.queryForObject("""
            select coalesce(sum(greatest(o.total - coalesce(b.booked, 0), 0)), 0)
            from (select so.id,
                         coalesce(so.transport_and_lifting, 0)
                       + coalesce((select sum(round(sl.qty * sl.unit_price, 2) - coalesce(sl.discount_amt, 0))
                                   from so_line sl where sl.so_id = so.id), 0) as total
                  from sales_order so
                  where so.customer_id = ? and so.payment_mode = 'CREDIT' and so.workflow = 'SO_FIRST'
                    and so.status in ('PENDING', 'PARTIALLY_DELIVERED')) o
            left join (select je.source_id, sum(jl.credit - jl.debit) as booked
                       from journal_line jl join journal_entry je on je.id = jl.journal_id
                       join account a on a.id = jl.account_id
                       where a.code in ('4000', '4010', '4400', '2100') and je.source_type = 'SALES_DELIVERY'
                       group by je.source_id) b on b.source_id = o.id
        """, java.math.BigDecimal.class, customerId);
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
                   a.description, a.active,
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
        if (g.getCode() == null || g.getCode().isBlank() || g.getName() == null || g.getName().isBlank())
            throw new ApiException("Group code and name are required");
        g.setCode(g.getCode().trim()); g.setName(g.getName().trim());
        if (groups.findByCode(g.getCode()).isPresent() || accounts.findByCode(g.getCode()).isPresent())
            throw new ApiException("Code " + g.getCode() + " is already used");
        if (g.getParentId() != null) {   // a sub-group always takes its parent's nature
            AccountGroup p = groups.findById(g.getParentId()).orElseThrow(() -> new ApiException("Parent group not found"));
            g.setNature(p.getNature());
        } else if (g.getNature() == null) {
            throw new ApiException("Pick a nature for a top-level group");
        }
        g.setId(null); g.setSystem(false); g.setActive(true);
        return groups.save(g);
    }

    @Transactional
    public AccountGroup updateGroup(UUID id, AccountGroup in) {
        AccountGroup g = groups.findById(id).orElseThrow(() -> new ApiException("Group not found"));
        if (in.getName() == null || in.getName().isBlank()) throw new ApiException("Group name is required");
        g.setName(in.getName().trim());
        if (in.getNameBn() != null && !in.getNameBn().isBlank()) g.setNameBn(in.getNameBn().trim());
        g.setDescription(in.getDescription());
        if (!g.isSystem()) {   // system groups keep their place in the tree
            if (in.getParentId() != null && in.getParentId().equals(id)) throw new ApiException("A group can't be its own parent");
            if (in.getParentId() != null && isDescendant(in.getParentId(), id)) throw new ApiException("A group can't move under its own sub-group");
            g.setParentId(in.getParentId());
            if (in.getParentId() != null) {
                AccountGroup p = groups.findById(in.getParentId()).orElseThrow(() -> new ApiException("Parent group not found"));
                if (!p.getNature().equals(g.getNature())) throw new ApiException("Parent group is " + p.getNature() + ", this group is " + g.getNature());
            }
            g.setActive(in.isActive());
        }
        return groups.save(g);
    }

    /** True when {@code candidate} sits somewhere below {@code ancestorId}. */
    private boolean isDescendant(UUID candidate, UUID ancestorId) {
        UUID cur = candidate;
        for (int i = 0; cur != null && i < 50; i++) {
            if (cur.equals(ancestorId)) return true;
            cur = groups.findById(cur).map(AccountGroup::getParentId).orElse(null);
        }
        return false;
    }

    @Transactional
    public void deleteGroup(UUID id) {
        AccountGroup g = groups.findById(id).orElseThrow(() -> new ApiException("Group not found"));
        if (g.isSystem()) throw new ApiException("System groups can't be deleted");
        if (groups.existsByParentId(id)) throw new ApiException("Group has sub-groups — move or delete them first");
        if (accounts.existsByGroupId(id)) throw new ApiException("Group has ledgers — move or delete them first");
        groups.deleteById(id);
    }

    /** Suggested next ledger code in a group: highest numeric code there + 1, else the group code + "01". */
    public Map<String, String> nextCode(UUID groupId) {
        AccountGroup g = groups.findById(groupId).orElseThrow(() -> new ApiException("Group not found"));
        Long max = jdbc.queryForObject(
            "select max(code::bigint) from account where group_id = ? and code ~ '^[0-9]{1,15}$'", Long.class, groupId);
        String code = max != null ? String.valueOf(max + 1) : g.getCode() + "01";
        for (int i = 0; i < 1000 && accounts.findByCode(code).isPresent(); i++) {
            try { code = String.valueOf(Long.parseLong(code) + 1); } catch (NumberFormatException e) { code = code + "1"; }
        }
        return Map.of("code", code);
    }

    @Transactional
    public Account createLedger(Account a) {
        if (a.getCode() == null || a.getName() == null) throw new ApiException("Ledger code and name are required");
        if (a.getGroupId() == null) throw new ApiException("Pick an account head (group) for the ledger");
        AccountGroup g = groups.findById(a.getGroupId()).orElseThrow(() -> new ApiException("Group not found"));
        a.setCode(a.getCode().trim()); a.setName(a.getName().trim());
        if (accounts.findByCode(a.getCode()).isPresent() || groups.findByCode(a.getCode()).isPresent())
            throw new ApiException("Code " + a.getCode() + " is already used");
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
        a.setName(in.getName());
        a.setDescription(in.getDescription());
        // a blank Bangla name on edit means "not touched" — keep the stored one
        if (in.getNameBn() != null && !in.getNameBn().isBlank()) a.setNameBn(in.getNameBn().trim());
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
