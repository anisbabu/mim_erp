package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * Bill-wise party sub-ledger (Tally "bill-wise details" / Odoo reconciliation).
 *
 * Every journal line on a customer or supplier ledger becomes a {@code party_item}:
 *   BILL   - raises what the party owes / is owed: customer debit (invoice, bounced cheque),
 *            supplier credit (GRN);
 *   CREDIT - settles it: customer credit (receipt, credit note), supplier debit (payment).
 * Opening balances entered for a year (not carried forward by a year close) become OPENING items.
 *
 * A new item is matched oldest-first against the open items on the other side (by due date), unless
 * the caller then sets the allocation itself ({@link #allocate}). Whatever a credit does not settle is
 * an advance / on-account amount. Reversals and cheque bounces are matched against the entry they
 * undo, so the bills that entry paid open again.
 *
 * Invariant: party ledger balance = open bills - open credits.
 */
@Service
@Order(100)
public class BillService implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(BillService.class);

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public BillService(JdbcTemplate jdbc, TransactionTemplate tx) { this.jdbc = jdbc; this.tx = tx; }

    public record Alloc(UUID billId, BigDecimal amount) {}

    // ------------------------------------------------------------------ startup backfill
    /** First start after V72: build the items from the books already posted. */
    @Override
    public void run(ApplicationArguments args) {
        Integer items = jdbc.queryForObject("select count(*) from party_item", Integer.class);
        if (items != null && items > 0) return;
        Integer lines = jdbc.queryForObject(
            "select (select count(*) from journal_line where party_id is not null)"
          + " + (select count(*) from opening_balance ob join account a on a.id = ob.account_id where a.party_type is not null)",
            Integer.class);
        if (lines == null || lines == 0) return;
        int n = tx.execute(s -> rebuild());
        log.info("Bill-wise party items built from existing books: {}", n);
    }

    /**
     * Throw away every item and allocation and rebuild them from the books in date order, each settled
     * oldest-first, then put the hand-picked matches back. Returns the item count.
     */
    @Transactional
    public int rebuild() {
        // remember hand-picked matches by what the items come from (journal or opening + ledger), not their ids
        List<Map<String, Object>> manual = jdbc.queryForList("""
            select b.journal_id as bj, b.opening_id as bo, b.account_id as acc, c.journal_id as cj, c.opening_id as co, x.amount
            from bill_allocation x join party_item b on b.id = x.bill_id join party_item c on c.id = x.credit_id
            where x.manual order by x.created_at
        """);
        jdbc.update("delete from bill_allocation");
        jdbc.update("delete from party_item");
        syncOpenings();
        List<UUID> journals = jdbc.queryForList("""
            select je.id from journal_entry je
            where exists (select 1 from journal_line jl join account a on a.id = jl.account_id
                          where jl.journal_id = je.id and a.party_type is not null)
            order by je.entry_date, je.created_at, je.entry_no
        """, UUID.class);
        for (UUID j : journals) onPosted(j);
        restoreManual(manual);
        Integer n = jdbc.queryForObject("select count(*) from party_item", Integer.class);
        return n == null ? 0 : n;
    }

    /**
     * Re-apply hand-picked matches after a rebuild: the automatic matches of the items involved are undone,
     * the manual ones linked again (capped at what is open), and any credit freed on the way is settled
     * oldest-first once more.
     */
    private void restoreManual(List<Map<String, Object>> manual) {
        record Pair(UUID bill, UUID credit, BigDecimal amount) {}
        List<Pair> pairs = new ArrayList<>();
        for (Map<String, Object> m : manual) {
            UUID b = findItem((UUID) m.get("bj"), (UUID) m.get("bo"), (UUID) m.get("acc"), "BILL");
            UUID c = findItem((UUID) m.get("cj"), (UUID) m.get("co"), (UUID) m.get("acc"), "CREDIT");
            if (b != null && c != null) pairs.add(new Pair(b, c, bd(m.get("amount"))));
        }
        if (pairs.isEmpty()) return;
        Set<UUID> involved = new LinkedHashSet<>(), freed = new LinkedHashSet<>();
        for (Pair p : pairs) { involved.add(p.bill()); involved.add(p.credit()); }
        for (UUID id : involved) {
            jdbc.queryForList("select case when bill_id = ? then credit_id else bill_id end from bill_allocation where bill_id = ? or credit_id = ?",
                UUID.class, id, id, id).forEach(freed::add);
            release(id);
        }
        for (Pair p : pairs) {
            BigDecimal take = p.amount().min(open(p.bill())).min(open(p.credit()));
            if (take.signum() > 0) link(p.bill(), p.credit(), take, true);
        }
        freed.removeAll(involved);
        for (UUID id : freed) fifo(id);
    }

    private UUID findItem(UUID journalId, UUID openingId, UUID accountId, String kind) {
        List<UUID> r = journalId != null
            ? jdbc.queryForList("select id from party_item where journal_id = ? and account_id = ? and kind = ? order by amount desc limit 1",
                UUID.class, journalId, accountId, kind)
            : jdbc.queryForList("select id from party_item where opening_id = ? and account_id = ? and kind = ? limit 1",
                UUID.class, openingId, accountId, kind);
        return r.isEmpty() ? null : r.get(0);
    }

    // ------------------------------------------------------------------ posting hook
    /** Printed reference of the document behind a journal: SO no, GRN no, voucher no, credit note no. */
    public String docNoFor(String sourceType, UUID sourceId) {
        if (sourceType == null || sourceId == null) return null;
        if ("SALES_DELIVERY".equals(sourceType)) {   // an order (SO_FIRST) or a challan (DC_FIRST)
            List<String> r = jdbc.queryForList("""
                select coalesce((select so_no from sales_order where id = ?), (select dc_no from delivery_challan where id = ?))
            """, String.class, sourceId, sourceId);
            return r.isEmpty() ? null : r.get(0);
        }
        String sql = switch (sourceType) {
            case "SALES_INVOICE" -> "select so_no from sales_order where id = ?";
            case "GRN" -> "select coalesce(bill_no || ' / ' || grn_no, grn_no) from goods_receipt where id = ?";
            case "PURCHASE_RETURN" -> "select coalesce(debit_note_no, return_no) from purchase_return where id = ?";
            case "RECEIPT", "PAYMENT" -> "select coalesce(voucher_no, payment_no) from payment where id = ?";
            case "SALES_RETURN" -> "select coalesce(credit_note_no, return_no) from sales_return where id = ?";
            case "CHEQUE_BOUNCE" -> "select 'BOUNCE ' || cheque_no from cheque where id = ?";
            case "CHEQUE_CHARGE" -> "select 'BANK CHARGE ' || cheque_no from cheque where id = ?";
            default -> null;
        };
        if (sql == null) return null;
        List<String> r = jdbc.queryForList(sql, String.class, sourceId);
        return r.isEmpty() ? null : r.get(0);
    }

    /** Called by the posting engine after a journal is saved: one item per party-ledger line, then matched. */
    public void onPosted(UUID journalId) {
        Map<String, Object> je = jdbc.queryForMap(
            "select id, entry_no, entry_date, source_type, source_id, reversal_of from journal_entry where id = ?", journalId);
        List<Map<String, Object>> lines = jdbc.queryForList("""
            select jl.account_id, a.party_type, a.party_id, jl.debit, jl.credit, jl.ref_no,
                   coalesce(c.credit_days, s.credit_days) as credit_days
            from journal_line jl join account a on a.id = jl.account_id
            left join customer c on a.party_type = 'CUSTOMER' and c.id = a.party_id
            left join supplier s on a.party_type = 'SUPPLIER' and s.id = a.party_id
            where jl.journal_id = ? and a.party_type is not null
        """, journalId);
        if (lines.isEmpty()) return;

        LocalDate date = ((java.sql.Date) je.get("entry_date")).toLocalDate();
        String sourceType = (String) je.get("source_type");
        UUID sourceId = (UUID) je.get("source_id");
        String sourceDoc = docNoFor(sourceType, sourceId);   // lines posted before V71 carry no ref_no
        // a goods receipt carries the supplier's own due date
        LocalDate grnDue = "GRN".equals(sourceType) && sourceId != null
            ? jdbc.queryForList("select due_date from goods_receipt where id = ?", java.sql.Date.class, sourceId)
                .stream().filter(Objects::nonNull).map(java.sql.Date::toLocalDate).findFirst().orElse(null)
            : null;
        List<UUID> created = new ArrayList<>();
        for (Map<String, Object> l : lines) {
            String pt = (String) l.get("party_type");
            BigDecimal net = bd(l.get("debit")).subtract(bd(l.get("credit")));
            if (net.signum() == 0) continue;
            boolean debit = net.signum() > 0;
            String kind = ("CUSTOMER".equals(pt) == debit) ? "BILL" : "CREDIT";
            int days = "BILL".equals(kind) && l.get("credit_days") != null ? ((Number) l.get("credit_days")).intValue() : 0;
            String docNo = l.get("ref_no") != null ? (String) l.get("ref_no")
                : sourceDoc != null ? sourceDoc : (String) je.get("entry_no");
            LocalDate due = "BILL".equals(kind) && grnDue != null ? grnDue : date.plusDays(Math.max(0, days));
            created.add(insertItem(pt, (UUID) l.get("party_id"), (UUID) l.get("account_id"), kind, sourceType, sourceId,
                journalId, null, docNo, date, due, net.abs()));
        }

        UUID orig = linkedOriginal(je);
        // Settle the same order first: a credit note against its order's bills, a delivery against the
        // advance its cash order took, a cash invoice against its challans' bills.
        UUID order = sourceId == null ? null
            : "SALES_RETURN".equals(sourceType)
                ? jdbc.queryForList("select so_id from sales_return where id = ?", UUID.class, sourceId).stream().findFirst().orElse(null)
            : "SALES_DELIVERY".equals(sourceType) || "SALES_INVOICE".equals(sourceType) ? sourceId : null;
        Set<UUID> prefer = new HashSet<>();
        if (order != null) {
            prefer.add(order);
            prefer.addAll(jdbc.queryForList("select id from delivery_challan where so_id = ?", UUID.class, order));
        }
        if ("PURCHASE_RETURN".equals(sourceType) && sourceId != null)   // a debit note settles its own receipt first
            prefer.addAll(jdbc.queryForList("select grn_id from purchase_return where id = ?", UUID.class, sourceId));
        for (UUID item : created) {
            if (orig != null) matchOriginal(item, orig);
            if (!prefer.isEmpty()) matchSource(item, prefer);
            fifo(item);
        }
    }

    /** The supplier's bill no. / due date were keyed or corrected on a GRN: carry them onto its open bill. */
    public void retagGrn(UUID grnId) {
        jdbc.update("""
            update party_item pi set doc_no = ?, due_date = coalesce(g.due_date, pi.due_date)
            from goods_receipt g where g.id = ? and pi.source_type = 'GRN' and pi.source_id = g.id and pi.kind = 'BILL'
        """, docNoFor("GRN", grnId), grnId);
    }

    /** The entry this one undoes: a reversal's original, or the receipt of a bounced cheque. */
    private UUID linkedOriginal(Map<String, Object> je) {
        if (je.get("reversal_of") != null) return (UUID) je.get("reversal_of");
        if ("CHEQUE_BOUNCE".equals(je.get("source_type")) && je.get("source_id") != null) {
            List<UUID> r = jdbc.queryForList("""
                select e.id from cheque c join journal_entry e on e.source_type = 'RECEIPT' and e.source_id = c.payment_id
                where c.id = ? order by e.created_at desc limit 1
            """, UUID.class, je.get("source_id"));
            return r.isEmpty() ? null : r.get(0);
        }
        return null;
    }

    /** Undo the original's matching: free its items, then settle them against this one. */
    private void matchOriginal(UUID itemId, UUID origJournal) {
        Map<String, Object> it = item(itemId);
        String other = "BILL".equals(it.get("kind")) ? "CREDIT" : "BILL";
        List<UUID> origItems = jdbc.queryForList(
            "select id from party_item where journal_id = ? and account_id = ? and kind = ? order by created_at",
            UUID.class, origJournal, it.get("account_id"), other);
        for (UUID o : origItems) {
            release(o);
            BigDecimal take = open(itemId).min(open(o));
            if (take.signum() > 0) link(itemId, o, take);
        }
    }

    // ------------------------------------------------------------------ allocation
    /** Settle an item oldest-first (by due date) against the open items on the other side. */
    public void fifo(UUID itemId) {
        Map<String, Object> it = item(itemId);
        String other = "BILL".equals(it.get("kind")) ? "CREDIT" : "BILL";
        BigDecimal left = open(itemId);
        if (left.signum() <= 0) return;
        for (Map<String, Object> o : openItems((UUID) it.get("account_id"), other)) {
            if (left.signum() <= 0) break;
            UUID oid = (UUID) o.get("id");
            if (oid.equals(itemId)) continue;
            BigDecimal take = left.min(bd(o.get("open_amount")));
            if (take.signum() <= 0) continue;
            link(itemId, oid, take);
            left = left.subtract(take);
        }
    }

    /**
     * Replace the automatic matching of a journal's credit with the bills the user picked.
     * Whatever is left over stays on the party as an advance (on account).
     */
    @Transactional
    public void allocate(UUID journalId, List<Alloc> picks) {
        UUID credit = itemOf(journalId);
        if (credit == null) throw new ApiException("This voucher has no party line to allocate");
        Map<String, Object> c = item(credit);
        release(credit);
        BigDecimal left = bd(c.get("amount"));
        for (Alloc a : picks) {
            if (a.amount() == null || a.amount().signum() == 0) continue;
            if (a.amount().signum() < 0) throw new ApiException("Allocated amounts must be positive");
            Map<String, Object> b = jdbc.queryForList("select * from party_item where id = ?", a.billId())
                .stream().findFirst().orElseThrow(() -> new ApiException("Bill not found"));
            if (!b.get("account_id").equals(c.get("account_id")) || b.get("kind").equals(c.get("kind")))
                throw new ApiException("Bill " + b.get("doc_no") + " does not belong to this party");
            BigDecimal open = open(a.billId());
            if (a.amount().compareTo(open) > 0)
                throw new ApiException("Bill " + b.get("doc_no") + " has only " + open + " open");
            if (a.amount().compareTo(left) > 0)
                throw new ApiException("Allocations exceed the voucher amount " + c.get("amount"));
            link(credit, a.billId(), a.amount(), true);
            left = left.subtract(a.amount());
        }
    }

    /**
     * Match an open credit (advance, unapplied receipt / payment, credit note) against open bills of the same
     * party by hand. Adds to what is already matched; amounts are capped by what is open on both sides.
     */
    @Transactional
    public Map<String, Object> match(UUID creditId, List<Alloc> picks) {
        Map<String, Object> c = jdbc.queryForList("select * from party_item where id = ? for update", creditId)
            .stream().findFirst().orElseThrow(() -> new ApiException("Advance not found"));
        if (!"CREDIT".equals(c.get("kind"))) throw new ApiException("Pick an advance / credit to match from");
        if (picks == null || picks.isEmpty()) throw new ApiException("Enter an amount against at least one bill");
        BigDecimal left = open(creditId), total = BigDecimal.ZERO;
        for (Alloc a : picks) {
            if (a.amount() == null || a.amount().signum() == 0) continue;
            if (a.amount().signum() < 0) throw new ApiException("Matched amounts must be positive");
            Map<String, Object> b = jdbc.queryForList("select * from party_item where id = ? for update", a.billId())
                .stream().findFirst().orElseThrow(() -> new ApiException("Bill not found"));
            if (!b.get("account_id").equals(c.get("account_id")) || !"BILL".equals(b.get("kind")))
                throw new ApiException("Bill " + b.get("doc_no") + " does not belong to this party");
            BigDecimal open = open(a.billId());
            if (a.amount().compareTo(open) > 0)
                throw new ApiException("Bill " + b.get("doc_no") + " has only " + open + " open");
            if (a.amount().compareTo(left) > 0)
                throw new ApiException("Only " + open(creditId) + " of " + c.get("doc_no") + " is unmatched");
            link(creditId, a.billId(), a.amount(), true);
            left = left.subtract(a.amount());
            total = total.add(a.amount());
        }
        if (total.signum() == 0) throw new ApiException("Enter an amount against at least one bill");
        return Map.of("matched", total, "left", left);
    }

    /**
     * Undo every match of one item (bill or credit). Both sides become open again and stay open until
     * matched by hand or by the next voucher, so a wrong automatic match can be corrected.
     */
    @Transactional
    public Map<String, Object> unmatch(UUID itemId) {
        if (jdbc.queryForList("select id from party_item where id = ? for update", UUID.class, itemId).isEmpty())
            throw new ApiException("Item not found");
        int n = jdbc.update("delete from bill_allocation where bill_id = ? or credit_id = ?", itemId, itemId);
        return Map.of("released", n);
    }

    /** Settle an item against the open items of one source document (e.g. the order a return is against). */
    private void matchSource(UUID itemId, Set<UUID> sourceIds) {
        Map<String, Object> it = item(itemId);
        String other = "BILL".equals(it.get("kind")) ? "CREDIT" : "BILL";
        for (Map<String, Object> o : openItems((UUID) it.get("account_id"), other)) {
            if (!sourceIds.contains(o.get("source_id"))) continue;
            BigDecimal take = open(itemId).min(bd(o.get("open_amount")));
            if (take.signum() > 0) link(itemId, (UUID) o.get("id"), take);
        }
    }

    // ------------------------------------------------------------------ opening balances
    /**
     * Keep OPENING items in step with entered opening balances. Only openings typed in for a year count:
     * those a year close carried forward are already in the books as the earlier year's items.
     */
    @Transactional
    public void syncOpenings() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            select ob.id, ob.account_id, ob.debit - ob.credit as net, a.party_type, a.party_id, fy.start_date
            from opening_balance ob
            join account a on a.id = ob.account_id and a.party_type is not null
            join financial_year fy on fy.id = ob.financial_year_id
            where ob.debit - ob.credit <> 0
              and not exists (select 1 from financial_year p where p.status = 'CLOSED' and p.end_date < fy.start_date)
        """);
        Set<UUID> keep = new HashSet<>();
        for (Map<String, Object> r : rows) {
            UUID obId = (UUID) r.get("id");
            BigDecimal net = bd(r.get("net"));
            String pt = (String) r.get("party_type");
            String kind = ("CUSTOMER".equals(pt) == (net.signum() > 0)) ? "BILL" : "CREDIT";
            List<Map<String, Object>> cur = jdbc.queryForList("select id, kind, amount from party_item where opening_id = ?", obId);
            if (!cur.isEmpty() && kind.equals(cur.get(0).get("kind")) && bd(cur.get(0).get("amount")).compareTo(net.abs()) == 0) {
                keep.add((UUID) cur.get(0).get("id"));
                continue;
            }
            jdbc.update("delete from party_item where opening_id = ?", obId);
            LocalDate d = ((java.sql.Date) r.get("start_date")).toLocalDate();
            UUID id = insertItem(pt, (UUID) r.get("party_id"), (UUID) r.get("account_id"), kind, "OPENING", obId,
                null, obId, "OPENING", d, d, net.abs());
            keep.add(id);
            fifo(id);
        }
        List<UUID> stale = jdbc.queryForList("select id from party_item where source_type = 'OPENING'", UUID.class);
        for (UUID s : stale) if (!keep.contains(s)) jdbc.update("delete from party_item where id = ?", s);
    }

    // ------------------------------------------------------------------ reads
    /** Open bills (oldest due first) and unallocated credits / advances of one party. */
    public Map<String, Object> openItems(String partyType, UUID partyId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            select i.id, i.kind, i.source_type, i.doc_no, i.doc_date, i.due_date, i.amount,
                   i.amount - coalesce((select sum(x.amount) from bill_allocation x where x.bill_id = i.id or x.credit_id = i.id), 0) as open_amount
            from party_item i
            where i.party_type = ? and i.party_id = ?
            order by i.due_date, i.doc_date, i.created_at
        """, partyType, partyId);
        List<Map<String, Object>> bills = new ArrayList<>(), credits = new ArrayList<>(), matched = new ArrayList<>();
        BigDecimal billTotal = BigDecimal.ZERO, creditTotal = BigDecimal.ZERO;
        for (Map<String, Object> r : rows) {
            BigDecimal open = bd(r.get("open_amount"));
            if (open.signum() <= 0) {   // fully matched credits, so a wrong match can be undone
                if ("CREDIT".equals(r.get("kind"))) matched.add(Map.of("id", r.get("id"), "sourceType", r.get("source_type"),
                    "docNo", String.valueOf(r.get("doc_no")), "docDate", String.valueOf(r.get("doc_date")), "amount", r.get("amount")));
                continue;
            }
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("id", r.get("id")); o.put("sourceType", r.get("source_type")); o.put("docNo", r.get("doc_no"));
            o.put("docDate", String.valueOf(r.get("doc_date"))); o.put("dueDate", String.valueOf(r.get("due_date")));
            o.put("amount", r.get("amount")); o.put("open", open);
            o.put("status", open.compareTo(bd(r.get("amount"))) == 0 ? "OPEN" : "PART");
            if ("BILL".equals(r.get("kind"))) { bills.add(o); billTotal = billTotal.add(open); }
            else { credits.add(o); creditTotal = creditTotal.add(open); }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        java.util.Collections.reverse(matched);
        out.put("bills", bills); out.put("advances", credits); out.put("matched", matched.subList(0, Math.min(30, matched.size())));
        out.put("billTotal", billTotal); out.put("advanceTotal", creditTotal);
        out.put("balance", billTotal.subtract(creditTotal));
        return out;
    }

    /** Bills of one party settled by a journal's credit (for printing the voucher). */
    public List<Map<String, Object>> allocationsOf(UUID journalId) {
        UUID credit = itemOf(journalId);
        if (credit == null) return List.of();
        return jdbc.queryForList("""
            select b.doc_no, b.doc_date, b.amount as bill_amount, x.amount
            from bill_allocation x join party_item b on b.id = case when x.credit_id = ? then x.bill_id else x.credit_id end
            where x.credit_id = ? or x.bill_id = ?
            order by b.due_date, b.doc_date
        """, credit, credit, credit);
    }

    // ------------------------------------------------------------------ helpers
    private UUID insertItem(String pt, UUID partyId, UUID accountId, String kind, String sourceType, UUID sourceId,
                            UUID journalId, UUID openingId, String docNo, LocalDate docDate, LocalDate dueDate, BigDecimal amount) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
            insert into party_item (id, party_type, party_id, account_id, kind, source_type, source_id, journal_id,
                                    opening_id, doc_no, doc_date, due_date, amount)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, id, pt, partyId, accountId, kind, sourceType, sourceId, journalId, openingId, docNo, docDate, dueDate, amount);
        return id;
    }

    private UUID itemOf(UUID journalId) {
        List<UUID> r = jdbc.queryForList(
            "select id from party_item where journal_id = ? order by amount desc limit 1", UUID.class, journalId);
        return r.isEmpty() ? null : r.get(0);
    }

    private Map<String, Object> item(UUID id) {
        return jdbc.queryForMap("select * from party_item where id = ?", id);
    }

    private BigDecimal open(UUID id) {
        return bd(jdbc.queryForObject("""
            select i.amount - coalesce((select sum(x.amount) from bill_allocation x where x.bill_id = i.id or x.credit_id = i.id), 0)
            from party_item i where i.id = ?
        """, BigDecimal.class, id));
    }

    private List<Map<String, Object>> openItems(UUID accountId, String kind) {
        return jdbc.queryForList("""
            select * from (
              select i.id, i.source_id, i.due_date, i.doc_date, i.created_at,
                     i.amount - coalesce((select sum(x.amount) from bill_allocation x where x.bill_id = i.id or x.credit_id = i.id), 0) as open_amount
              from party_item i where i.account_id = ? and i.kind = ?
            ) t where open_amount > 0
            order by due_date, doc_date, created_at
        """, accountId, kind);
    }

    private void release(UUID itemId) {
        jdbc.update("delete from bill_allocation where bill_id = ? or credit_id = ?", itemId, itemId);
    }

    /** Link two items of opposite kinds; argument order does not matter. */
    private void link(UUID a, UUID b, BigDecimal amount) { link(a, b, amount, false); }

    private void link(UUID a, UUID b, BigDecimal amount, boolean manual) {
        boolean aBill = "BILL".equals(jdbc.queryForObject("select kind from party_item where id = ?", String.class, a));
        jdbc.update("insert into bill_allocation (bill_id, credit_id, amount, created_by, manual) values (?,?,?,?,?)",
            aBill ? a : b, aBill ? b : a, amount, currentUser(), manual);
    }

    private static String currentUser() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a != null && a.getPrincipal() instanceof com.mim.erp.auth.AuthPrincipal p ? p.username() : "system";
    }

    private static BigDecimal bd(Object o) {
        return o == null ? BigDecimal.ZERO : o instanceof BigDecimal b ? b : new BigDecimal(o.toString());
    }
}
