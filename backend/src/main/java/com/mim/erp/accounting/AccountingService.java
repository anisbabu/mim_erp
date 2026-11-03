package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.Year;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Double-entry posting engine. Every business event posts ONE balanced journal
 * entry through post(...). Debits must equal credits or it refuses to save.
 *
 * Controls enforced here (and again by database triggers, see V63):
 *  - period lock: nothing posts into a closed financial year;
 *  - gapless voucher numbers (counter row locked inside the posting transaction);
 *  - audit trail: who posted every entry;
 *  - posted entries are never edited or deleted, only reversed.
 */
@Service
public class AccountingService {

    private final AccountRepository accounts;
    private final JournalEntryRepository journals;
    private final JdbcTemplate jdbc;

    public AccountingService(AccountRepository accounts, JournalEntryRepository journals, JdbcTemplate jdbc) {
        this.accounts = accounts; this.journals = journals; this.jdbc = jdbc;
    }

    /** A single debit or credit leg, addressed by account code. */
    public record Leg(String accountCode, BigDecimal debit, BigDecimal credit) {
        public static Leg debit(String code, BigDecimal amt)  { return new Leg(code, amt, BigDecimal.ZERO); }
        public static Leg credit(String code, BigDecimal amt) { return new Leg(code, BigDecimal.ZERO, amt); }
    }

    /** Period lock: nothing can be posted into a closed financial year. */
    public void assertPeriodOpen(LocalDate date) {
        Integer closed = jdbc.queryForObject(
            "select count(*) from financial_year where status = 'CLOSED' and ?::date between start_date and end_date",
            Integer.class, date.toString());
        if (closed != null && closed > 0)
            throw new ApiException("The financial year containing " + date + " is closed - no new postings allowed");
    }

    private static String currentUser() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a != null && a.getPrincipal() instanceof com.mim.erp.auth.AuthPrincipal p ? p.username() : null;
    }

    /** Next gapless entry number. The counter row stays locked until the posting transaction ends. */
    private String nextEntryNo() {
        int yr = Year.now().getValue();
        Long n = jdbc.queryForObject(
            "insert into doc_counter (prefix, yr, last_no) values ('JE', ?, 1) "
          + "on conflict (prefix, yr) do update set last_no = doc_counter.last_no + 1 returning last_no",
            Long.class, yr);
        return "JE-%d-%06d".formatted(yr, n);
    }

    @Transactional
    public JournalEntry post(LocalDate date, String narration, String sourceType,
                             UUID sourceId, List<Leg> legs) {
        return postInternal(date, narration, sourceType, sourceId, legs, null);
    }

    private JournalEntry postInternal(LocalDate date, String narration, String sourceType,
                                      UUID sourceId, List<Leg> legs, UUID reversalOf) {
        assertPeriodOpen(date);
        BigDecimal dr = legs.stream().map(Leg::debit).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal cr = legs.stream().map(Leg::credit).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (dr.compareTo(cr) != 0)
            throw new ApiException("Unbalanced journal entry: Dr " + dr + " != Cr " + cr);
        if (dr.signum() == 0)
            throw new ApiException("Journal entry has zero value");

        JournalEntry je = new JournalEntry();
        je.setEntryNo(nextEntryNo());
        je.setEntryDate(date);
        je.setNarration(narration);
        je.setSourceType(sourceType);
        je.setSourceId(sourceId);
        je.setCreatedBy(currentUser());
        je.setReversalOf(reversalOf);

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
        return journals.saveAndFlush(je);
    }

    /** A manual journal leg addressed by ledger id (from the COA picker). */
    public record ManualLeg(UUID accountId, BigDecimal debit, BigDecimal credit) {}

    /** Post a manual journal voucher (accountant adjustments, accruals, etc.). */
    @Transactional
    public JournalEntry postManual(LocalDate date, String narration, List<ManualLeg> legs) {
        if (legs == null || legs.size() < 2) throw new ApiException("A journal needs at least two lines");
        List<Leg> resolved = new ArrayList<>();
        for (ManualLeg l : legs) {
            Account a = accounts.findById(l.accountId())
                .orElseThrow(() -> new ApiException("Unknown ledger in journal line"));
            resolved.add(new Leg(a.getCode(),
                l.debit()  == null ? BigDecimal.ZERO : l.debit(),
                l.credit() == null ? BigDecimal.ZERO : l.credit()));
        }
        return post(date, narration, "JOURNAL", null, resolved);
    }

    /**
     * Correct a posted entry the only allowed way: a new entry with every debit and credit
     * swapped, linked both ways to the original. The original stays in the books.
     */
    @Transactional
    public JournalEntry reverse(UUID id, String reason, LocalDate date) {
        JournalEntry orig = journals.findById(id).orElseThrow(() -> new ApiException("Journal entry not found"));
        if (orig.getReversedBy() != null) throw new ApiException(orig.getEntryNo() + " is already reversed");
        if (orig.getReversalOf() != null) throw new ApiException("A reversing entry can't itself be reversed - post a new entry");
        if ("YEAR_CLOSE".equals(orig.getSourceType())) throw new ApiException("Reopen the financial year instead of reversing its closing entry");
        if (reason == null || reason.isBlank()) throw new ApiException("A reason is required to reverse an entry");

        List<Leg> legs = new ArrayList<>();
        for (JournalLine l : orig.getLines()) {
            Account a = accounts.findById(l.getAccountId()).orElseThrow(() -> new ApiException("Unknown ledger"));
            legs.add(new Leg(a.getCode(), l.getCredit(), l.getDebit()));
        }
        LocalDate d = date == null ? LocalDate.now() : date;
        JournalEntry rev = postInternal(d, "Reversal of " + orig.getEntryNo() + " - " + reason.trim(),
            "REVERSAL", orig.getId(), legs, orig.getId());
        jdbc.update("update journal_entry set reversed_by = ? where id = ?", rev.getId(), orig.getId());
        return rev;
    }

    /** Journal register / day book: entries with their lines, optionally within a date range. */
    public List<Map<String, Object>> journalRegister(int limit, LocalDate from, LocalDate to) {
        LocalDate f = from == null ? LocalDate.of(1900, 1, 1) : from;
        LocalDate t = to == null ? LocalDate.of(2999, 12, 31) : to;
        List<Map<String, Object>> flat = jdbc.queryForList(
            "select je.id, je.entry_no, je.entry_date, je.narration, je.source_type, je.created_by, je.created_at, "
          + "       je.reversal_of, je.reversed_by, r1.entry_no as reversal_of_no, r2.entry_no as reversed_by_no, "
          + "       a.code, a.name, jl.debit, jl.credit "
          + "from journal_entry je "
          + "join journal_line jl on jl.journal_id = je.id "
          + "join account a on a.id = jl.account_id "
          + "left join journal_entry r1 on r1.id = je.reversal_of "
          + "left join journal_entry r2 on r2.id = je.reversed_by "
          + "where je.id in (select id from journal_entry where entry_date between ?::date and ?::date "
          + "                order by entry_date desc, entry_no desc limit ?) "
          + "order by je.entry_date desc, je.entry_no desc, jl.debit desc, a.code",
            f.toString(), t.toString(), limit);

        LinkedHashMap<Object, Map<String, Object>> byEntry = new LinkedHashMap<>();
        for (Map<String, Object> r : flat) {
            Map<String, Object> e = byEntry.computeIfAbsent(r.get("id"), k -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", r.get("id"));
                m.put("entryNo", r.get("entry_no"));
                m.put("entryDate", r.get("entry_date"));
                m.put("narration", r.get("narration"));
                m.put("sourceType", r.get("source_type"));
                m.put("createdBy", r.get("created_by"));
                m.put("createdAt", String.valueOf(r.get("created_at")));
                m.put("reversalOfNo", r.get("reversal_of_no"));
                m.put("reversedByNo", r.get("reversed_by_no"));
                m.put("lines", new ArrayList<Map<String, Object>>());
                return m;
            });
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> lines = (List<Map<String, Object>>) e.get("lines");
            Map<String, Object> ln = new LinkedHashMap<>();
            ln.put("code", r.get("code")); ln.put("name", r.get("name"));
            ln.put("debit", r.get("debit")); ln.put("credit", r.get("credit"));
            lines.add(ln);
        }
        return new ArrayList<>(byEntry.values());
    }
}
