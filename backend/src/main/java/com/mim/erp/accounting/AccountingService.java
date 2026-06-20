package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Double-entry posting engine. Every business event posts ONE balanced journal
 * entry through post(...). Debits must equal credits or it refuses to save.
 */
@Service
public class AccountingService {

    private final AccountRepository accounts;
    private final JournalEntryRepository journals;
    private final DocNumberService docNo;
    private final JdbcTemplate jdbc;

    public AccountingService(AccountRepository accounts, JournalEntryRepository journals,
                             DocNumberService docNo, JdbcTemplate jdbc) {
        this.accounts = accounts; this.journals = journals;
        this.docNo = docNo; this.jdbc = jdbc;
    }

    /** A single debit or credit leg, addressed by account code. */
    public record Leg(String accountCode, BigDecimal debit, BigDecimal credit) {
        public static Leg debit(String code, BigDecimal amt)  { return new Leg(code, amt, BigDecimal.ZERO); }
        public static Leg credit(String code, BigDecimal amt) { return new Leg(code, BigDecimal.ZERO, amt); }
    }

    @Transactional
    public JournalEntry post(LocalDate date, String narration, String sourceType,
                             UUID sourceId, List<Leg> legs) {
        BigDecimal dr = legs.stream().map(Leg::debit).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal cr = legs.stream().map(Leg::credit).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (dr.compareTo(cr) != 0)
            throw new ApiException("Unbalanced journal entry: Dr " + dr + " != Cr " + cr);
        if (dr.signum() == 0)
            throw new ApiException("Journal entry has zero value");

        JournalEntry je = new JournalEntry();
        je.setEntryNo(docNo.next("JE"));
        je.setEntryDate(date);
        je.setNarration(narration);
        je.setSourceType(sourceType);
        je.setSourceId(sourceId);

        for (Leg leg : legs) {
            Account acct = accounts.findByCode(leg.accountCode())
                .orElseThrow(() -> new ApiException("Unknown account code: " + leg.accountCode()));
            JournalLine line = new JournalLine();
            line.setJournal(je);
            line.setAccountId(acct.getId());
            line.setDebit(leg.debit());
            line.setCredit(leg.credit());
            je.getLines().add(line);
        }
        return journals.save(je);
    }

    /** A manual journal leg addressed by ledger id (from the COA picker). */
    public record ManualLeg(UUID accountId, BigDecimal debit, BigDecimal credit) {}

    /** Post a manual journal voucher (accountant adjustments, accruals, etc.). */
    @Transactional
    public JournalEntry postManual(LocalDate date, String narration, List<ManualLeg> legs) {
        List<Leg> resolved = new java.util.ArrayList<>();
        for (ManualLeg l : legs) {
            Account a = accounts.findById(l.accountId())
                .orElseThrow(() -> new ApiException("Unknown ledger in journal line"));
            resolved.add(new Leg(a.getCode(),
                l.debit()  == null ? BigDecimal.ZERO : l.debit(),
                l.credit() == null ? BigDecimal.ZERO : l.credit()));
        }
        return post(date, narration, "JOURNAL", null, resolved);
    }

    /** Journal register / day book: recent entries with their lines. */
    public List<Map<String,Object>> journalRegister(int limit) {
        List<Map<String,Object>> flat = jdbc.queryForList("""
            select je.id, je.entry_no, je.entry_date, je.narration, je.source_type,
                   a.code, a.name, jl.debit, jl.credit
            from journal_entry je
            join journal_line jl on jl.journal_id = je.id
            join account a on a.id = jl.account_id
            where je.id in (select id from journal_entry order by entry_date desc, entry_no desc limit ?)
            order by je.entry_date desc, je.entry_no desc, a.code
        """, limit);

        java.util.LinkedHashMap<Object, Map<String,Object>> byEntry = new java.util.LinkedHashMap<>();
        for (Map<String,Object> r : flat) {
            Object id = r.get("id");
            Map<String,Object> e = byEntry.computeIfAbsent(id, k -> {
                Map<String,Object> m = new java.util.LinkedHashMap<>();
                m.put("entryNo", r.get("entry_no"));
                m.put("entryDate", r.get("entry_date"));
                m.put("narration", r.get("narration"));
                m.put("sourceType", r.get("source_type"));
                m.put("lines", new java.util.ArrayList<Map<String,Object>>());
                return m;
            });
            @SuppressWarnings("unchecked")
            List<Map<String,Object>> lines = (List<Map<String,Object>>) e.get("lines");
            Map<String,Object> ln = new java.util.LinkedHashMap<>();
            ln.put("code", r.get("code")); ln.put("name", r.get("name"));
            ln.put("debit", r.get("debit")); ln.put("credit", r.get("credit"));
            lines.add(ln);
        }
        return new java.util.ArrayList<>(byEntry.values());
    }

    /** Trial balance: net debit/credit per account. */
    public List<Map<String,Object>> trialBalance() {
        return jdbc.queryForList("""
            select a.code, a.name, a.type,
                   coalesce(sum(jl.debit),0)  as total_debit,
                   coalesce(sum(jl.credit),0) as total_credit
            from account a
            left join journal_line jl on jl.account_id = a.id
            group by a.id, a.code, a.name, a.type
            order by a.code
        """);
    }
}
