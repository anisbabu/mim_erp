package com.mim.erp.purchase;

import com.mim.erp.accounting.AccountingService;
import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.accounting.LedgerService;
import com.mim.erp.auth.CurrentUserService;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * Supplier bills - the accounts-payable document, separate from the goods receipt (3-way match:
 * PO -> GRN -> bill). The receipt parks its value in 2010 "Goods received, not billed"; the bill moves it
 * to the supplier:
 *   Dr 2010 (value received) / Cr Supplier (billed), any difference to 5000 (purchase price variance).
 * The bill becomes a BILL item in the supplier's bill-wise ledger, so payments settle it like any other bill.
 * One bill covers one or more receipts of the same PO; a receipt is billed once.
 */
@Service
public class SupplierBillService {

    public static final String GRNI = "2010", PRICE_VARIANCE = "5000";

    public record Line(UUID grnId, BigDecimal amount) {}   // amount blank = the receipt's value
    public record CreateRequest(String supplierInvoiceNo, LocalDate billDate, LocalDate dueDate, String note, List<Line> lines) {}
    public record CancelRequest(String reason) {}

    private final JdbcTemplate jdbc;
    private final AccountingService accounting;
    private final LedgerService ledgers;
    private final DocNumberService docNo;
    private final CurrentUserService currentUser;
    private final PoStatusService poStatus;

    public SupplierBillService(JdbcTemplate jdbc, AccountingService accounting, LedgerService ledgers,
                               DocNumberService docNo, CurrentUserService currentUser, PoStatusService poStatus) {
        this.jdbc = jdbc; this.accounting = accounting; this.ledgers = ledgers;
        this.docNo = docNo; this.currentUser = currentUser; this.poStatus = poStatus;
    }

    // ------------------------------------------------------------------ reads
    /** Bills, newest first, with what is paid and still open. */
    public List<Map<String, Object>> list(UUID supplierId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            select b.id, b.bill_no, b.supplier_invoice_no, b.bill_date, b.due_date, b.grn_value, b.total, b.variance,
                   b.status, b.legacy, b.note, b.created_by, b.cancel_reason, b.po_id, po.po_no,
                   s.id as supplier_id, s.code as supplier_code, s.name as supplier_name, s.name_bn as supplier_name_bn,
                   coalesce(o.amount, 0) as amount, coalesce(o.open_amount, 0) as open_amount,
                   (select string_agg(g.grn_no, ', ' order by g.grn_no) from supplier_bill_line bl
                      join goods_receipt g on g.id = bl.grn_id where bl.bill_id = b.id) as grn_nos,
                   (select i.id from party_item i where i.kind = 'BILL' and (
                        (i.source_type = 'SUPPLIER_BILL' and i.source_id = b.id)
                     or (b.legacy and i.source_type = 'GRN' and i.source_id in (select grn_id from supplier_bill_line where bill_id = b.id)))
                    order by i.created_at limit 1) as item_id
            from supplier_bill b
            join supplier s on s.id = b.supplier_id
            join purchase_order po on po.id = b.po_id
            left join supplier_bill_open o on o.bill_id = b.id
            where (?::uuid is null or b.supplier_id = ?::uuid)
            order by b.bill_date desc, b.bill_no desc
        """, supplierId, supplierId);
        for (Map<String, Object> r : rows) {
            BigDecimal amount = bd(r.get("amount")), open = bd(r.get("open_amount"));
            r.put("paid", amount.subtract(open.max(BigDecimal.ZERO)));
            r.put("pay_status", "CANCELLED".equals(r.get("status")) ? "CANCELLED"
                : amount.signum() == 0 || open.compareTo(amount) >= 0 ? "UNPAID" : open.signum() <= 0 ? "PAID" : "PARTIAL");
        }
        return rows;
    }

    /** Receipts still to be billed (optionally of one supplier), oldest first. */
    public List<Map<String, Object>> unbilled(UUID supplierId) {
        return jdbc.queryForList("""
            select g.id as grn_id, g.grn_no, g.receipt_date, g.bill_no, g.bill_date, g.due_date, gb.to_bill,
                   po.id as po_id, po.po_no, s.id as supplier_id, s.code as supplier_code,
                   s.name as supplier_name, s.name_bn as supplier_name_bn
            from grn_billing gb
            join goods_receipt g on g.id = gb.grn_id
            join purchase_order po on po.id = g.po_id
            join supplier s on s.id = po.supplier_id
            where gb.bill_id is null and gb.to_bill > 0 and (?::uuid is null or s.id = ?::uuid)
            order by g.receipt_date, g.grn_no
        """, supplierId, supplierId);
    }

    /** Is this receipt billed yet? (A receipt with nothing to bill counts as billed.) */
    public boolean isBilled(UUID grnId) {
        List<Map<String, Object>> r = jdbc.queryForList("select bill_id, to_bill from grn_billing where grn_id = ?", grnId);
        return r.isEmpty() || r.get(0).get("bill_id") != null || bd(r.get(0).get("to_bill")).signum() <= 0;
    }

    // ------------------------------------------------------------------ create
    @Transactional
    public Map<String, Object> create(CreateRequest req) {
        if (req.lines() == null || req.lines().isEmpty()) throw new ApiException("Pick at least one goods receipt to bill");
        String invoice = req.supplierInvoiceNo() == null ? "" : req.supplierInvoiceNo().trim();
        if (invoice.isEmpty()) throw new ApiException("Enter the supplier's bill number");
        LocalDate billDate = req.billDate() == null ? LocalDate.now() : req.billDate();
        if (billDate.isAfter(LocalDate.now())) throw new ApiException("The bill date can't be in the future");
        accounting.assertPeriodOpen(billDate);

        Set<UUID> seen = new HashSet<>();
        for (Line l : req.lines()) {
            if (l.grnId() == null) throw new ApiException("Goods receipt missing on a bill line");
            if (!seen.add(l.grnId())) throw new ApiException("A goods receipt appears twice on the bill");
        }
        // lock the receipts so two bills can't take the same one
        String in = String.join(",", Collections.nCopies(seen.size(), "?"));
        jdbc.queryForList("select id from goods_receipt where id in (" + in + ") for update", UUID.class, seen.toArray());
        Map<UUID, Map<String, Object>> grns = new HashMap<>();
        for (Map<String, Object> g : jdbc.queryForList("""
                select g.id, g.grn_no, g.po_id, po.supplier_id, gb.to_bill, gb.bill_id
                from goods_receipt g join purchase_order po on po.id = g.po_id join grn_billing gb on gb.grn_id = g.id
                where g.id in (""" + in + ")", seen.toArray()))
            grns.put((UUID) g.get("id"), g);

        UUID poId = null, supplierId = null;
        BigDecimal grnValue = BigDecimal.ZERO, total = BigDecimal.ZERO;
        List<Object[]> lineRows = new ArrayList<>();
        UUID billId = UUID.randomUUID();
        for (Line l : req.lines()) {
            Map<String, Object> g = grns.get(l.grnId());
            if (g == null) throw new ApiException("Goods receipt not found");
            if (g.get("bill_id") != null) throw new ApiException(g.get("grn_no") + " is already billed");
            BigDecimal toBill = bd(g.get("to_bill"));
            if (toBill.signum() <= 0) throw new ApiException(g.get("grn_no") + " has nothing left to bill");
            if (poId == null) { poId = (UUID) g.get("po_id"); supplierId = (UUID) g.get("supplier_id"); }
            else if (!poId.equals(g.get("po_id"))) throw new ApiException("One bill covers receipts of one purchase order");
            BigDecimal amount = l.amount() == null ? toBill : l.amount().setScale(2, java.math.RoundingMode.HALF_UP);
            if (amount.signum() <= 0) throw new ApiException("The billed amount for " + g.get("grn_no") + " must be more than zero");
            grnValue = grnValue.add(toBill);
            total = total.add(amount);
            lineRows.add(new Object[]{UUID.randomUUID(), billId, l.grnId(), toBill, amount});
        }

        int days = Optional.ofNullable(jdbc.queryForObject("select credit_days from supplier where id = ?", Integer.class, supplierId)).orElse(0);
        LocalDate due = req.dueDate() != null ? req.dueDate() : billDate.plusDays(Math.max(0, days));
        if (due.isBefore(billDate)) throw new ApiException("The due date can't be before the bill date");
        BigDecimal variance = total.subtract(grnValue);
        String billNo = docNo.next("SB");

        jdbc.update("""
            insert into supplier_bill (id, bill_no, supplier_id, po_id, supplier_invoice_no, bill_date, due_date,
                                       grn_value, total, variance, status, note, created_by)
            values (?,?,?,?,?,?,?,?,?,?,'POSTED',?,?)
        """, billId, billNo, supplierId, poId, invoice, billDate, due, grnValue, total, variance,
            req.note() == null || req.note().isBlank() ? null : req.note().trim(), currentUser.me().getUsername());
        for (Object[] r : lineRows)
            jdbc.update("insert into supplier_bill_line (id, bill_id, grn_id, grn_value, billed_amount) values (?,?,?,?,?)", r);
        // the receipts carry the supplier's reference too (printed on returns / debit notes)
        jdbc.update("update goods_receipt set bill_no = coalesce(bill_no, ?), bill_date = coalesce(bill_date, ?), due_date = ? where id in (" + in + ")",
            concat(new Object[]{invoice, billDate, due}, seen.toArray()));

        List<Leg> legs = new ArrayList<>();
        legs.add(Leg.debit(GRNI, grnValue));
        if (variance.signum() > 0) legs.add(Leg.debit(PRICE_VARIANCE, variance));
        legs.add(Leg.credit(ledgers.supplierLedger(supplierId).getCode(), total));
        if (variance.signum() < 0) legs.add(Leg.credit(PRICE_VARIANCE, variance.negate()));
        UUID journal = accounting.post(billDate, "Supplier bill " + billNo + " - invoice " + invoice,
            "SUPPLIER_BILL", billId, legs).getId();
        jdbc.update("update supplier_bill set journal_id = ? where id = ?", journal, billId);
        poStatus.refresh(poId, null);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("id", billId); res.put("billNo", billNo); res.put("total", total);
        res.put("grnValue", grnValue); res.put("variance", variance); res.put("dueDate", due);
        return res;
    }

    // ------------------------------------------------------------------ cancel
    /** Cancel a bill nothing has been paid against: its entry is reversed and the receipts can be billed again. */
    @Transactional
    public Map<String, Object> cancel(UUID id, CancelRequest req) {
        String reason = req == null || req.reason() == null ? "" : req.reason().trim();
        if (reason.isEmpty()) throw new ApiException("Give the reason for cancelling the bill");
        Map<String, Object> b = jdbc.queryForList("select * from supplier_bill where id = ? for update", id)
            .stream().findFirst().orElseThrow(() -> new ApiException("Supplier bill not found"));
        if (!"POSTED".equals(b.get("status"))) throw new ApiException("This bill is already cancelled");
        if (Boolean.TRUE.equals(b.get("legacy")))
            throw new ApiException("This bill was posted with its goods receipt before supplier bills existed - use a purchase return instead");
        Integer matched = jdbc.queryForObject("""
            select count(*) from bill_allocation x join party_item i on i.id = x.bill_id
            where i.source_type = 'SUPPLIER_BILL' and i.source_id = ?
        """, Integer.class, id);
        if (matched != null && matched > 0)
            throw new ApiException("A payment or debit note is matched to this bill - undo the match in Party statement first");
        jdbc.update("update supplier_bill set status = 'CANCELLED', cancelled_at = now(), cancel_reason = ? where id = ?", reason, id);
        accounting.reverse((UUID) b.get("journal_id"), "cancel supplier bill " + b.get("bill_no") + ": " + reason, LocalDate.now());
        poStatus.refresh((UUID) b.get("po_id"), null);
        return Map.of("id", id, "status", "CANCELLED");
    }

    /** A receipt's supplier reference / due date was corrected: carry it onto its (non-legacy) bill and open item. */
    public void retag(UUID grnId, String invoiceNo, LocalDate due) {
        List<UUID> ids = jdbc.queryForList("""
            select b.id from supplier_bill b join supplier_bill_line bl on bl.bill_id = b.id
            where bl.grn_id = ? and b.status = 'POSTED' and not b.legacy
        """, UUID.class, grnId);
        for (UUID id : ids) {
            jdbc.update("update supplier_bill set supplier_invoice_no = ?, due_date = greatest(?, bill_date) where id = ?", invoiceNo, due, id);
            jdbc.update("""
                update party_item i set doc_no = coalesce(b.supplier_invoice_no || ' / ' || b.bill_no, b.bill_no), due_date = b.due_date
                from supplier_bill b where b.id = ? and i.source_type = 'SUPPLIER_BILL' and i.source_id = b.id and i.kind = 'BILL'
            """, id);
        }
    }

    private static Object[] concat(Object[] a, Object[] b) {
        Object[] r = Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, r, a.length, b.length);
        return r;
    }

    private static BigDecimal bd(Object o) {
        return o == null ? BigDecimal.ZERO : o instanceof BigDecimal x ? x : new BigDecimal(o.toString());
    }
}
