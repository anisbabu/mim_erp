package com.mim.erp.purchase;

import com.mim.erp.accounting.AccountingService;
import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.accounting.LedgerService;
import com.mim.erp.auth.AppUser;
import com.mim.erp.auth.CurrentUserService;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import com.mim.erp.inventory.InventoryService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.*;

/**
 * Purchase returns: goods sent back to the supplier out of the receipt (GRN) they arrived on.
 *   Debit note:  Dr Supplier (billed value) / Cr Inventory (landed cost)
 *   Cash refund: Dr Cash/Bank (billed value) / Cr Inventory (landed cost)
 * Any freight in the landed cost that the supplier does not refund goes to Cost of sales (5000).
 * A debit note settles the bill of its own receipt first.
 */
@Service
public class PurchaseReturnService {

    public record Line(UUID grnLineId, BigDecimal qty) {}
    /** settlement: DEBIT_NOTE (default) or CASH_REFUND. returnDate blank = today. refundAccount: cash/bank ledger code. */
    public record CreateRequest(UUID grnId, String reason, String settlement, LocalDate returnDate,
                                String refundAccount, List<Line> lines) {}

    private final JdbcTemplate jdbc;
    private final InventoryService inventory;
    private final AccountingService accounting;
    private final LedgerService ledgers;
    private final DocNumberService docNo;
    private final CurrentUserService currentUser;

    public PurchaseReturnService(JdbcTemplate jdbc, InventoryService inventory, AccountingService accounting,
                                 LedgerService ledgers, DocNumberService docNo, CurrentUserService currentUser) {
        this.jdbc = jdbc; this.inventory = inventory; this.accounting = accounting;
        this.ledgers = ledgers; this.docNo = docNo; this.currentUser = currentUser;
    }

    // ------------------------------------------------------------------ reads
    /** Goods receipts with their supplier bill details, newest first (optionally for one supplier). */
    public List<Map<String, Object>> receipts(UUID supplierId) {
        return jdbc.queryForList("""
            select g.id, g.grn_no, g.receipt_date, g.bill_no, g.bill_date, g.due_date, g.goods_value, g.freight,
                   g.freight_on_bill, g.price_approved_by, po.po_no, s.id as supplier_id, s.code as supplier_code,
                   s.name as supplier_name, s.name_bn as supplier_name_bn,
                   coalesce((select sum(r.goods_value) from purchase_return r where r.grn_id = g.id), 0) as returned_value
            from goods_receipt g join purchase_order po on po.id = g.po_id join supplier s on s.id = po.supplier_id
            where (?::uuid is null or s.id = ?::uuid)
            order by g.receipt_date desc, g.grn_no desc
        """, supplierId, supplierId);
    }

    /** One receipt's lines with what can still go back: received - returned, capped by what is left in that layer. */
    public Map<String, Object> returnable(UUID grnId) {
        List<Map<String, Object>> head = jdbc.queryForList("""
            select g.id, g.grn_no, g.receipt_date, g.bill_no, g.warehouse_id, g.goods_value, g.vat, po.po_no, s.id as supplier_id,
                   s.code as supplier_code, s.name as supplier_name, s.name_bn as supplier_name_bn
            from goods_receipt g join purchase_order po on po.id = g.po_id join supplier s on s.id = po.supplier_id
            where g.id = ?
        """, grnId);
        if (head.isEmpty()) throw new ApiException("Goods receipt not found");
        List<Map<String, Object>> lines = jdbc.queryForList("""
            select gl.id as grn_line_id, gl.received_product_id as product_id, p.name as product_name, p.name_bn as product_name_bn,
                   gl.qty_received, coalesce(gl.unit_price, pl.unit_price) as unit_price, sl.unit_cost, sl.id as stock_layer_id,
                   coalesce((select sum(rl.qty) from purchase_return_line rl where rl.grn_line_id = gl.id), 0) as qty_returned,
                   coalesce(sl.qty_remaining, 0) as qty_in_stock
            from grn_line gl join po_line pl on pl.id = gl.po_line_id join product p on p.id = gl.received_product_id
            left join stock_layer sl on sl.grn_line_id = gl.id
            where gl.grn_id = ?
            order by p.name
        """, grnId);
        for (Map<String, Object> l : lines) {
            BigDecimal left = bd(l.get("qty_received")).subtract(bd(l.get("qty_returned"))).min(bd(l.get("qty_in_stock")));
            l.put("qty_available", left.max(BigDecimal.ZERO));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("receipt", head.get(0));
        out.put("lines", lines);
        return out;
    }

    public List<Map<String, Object>> list() {
        return jdbc.queryForList("""
            select r.id, r.return_no, r.debit_note_no, r.return_date, r.reason, r.settlement, r.goods_value, r.cost_value,
                   r.created_by, g.grn_no, g.bill_no, s.code as supplier_code, s.name as supplier_name, s.name_bn as supplier_name_bn
            from purchase_return r join goods_receipt g on g.id = r.grn_id join supplier s on s.id = r.supplier_id
            order by r.return_date desc, r.return_no desc
        """);
    }

    // ------------------------------------------------------------------ create
    @Transactional
    public Map<String, Object> create(CreateRequest req) {
        if (req.grnId() == null) throw new ApiException("Select the goods receipt being returned against");
        if (req.reason() == null || req.reason().isBlank()) throw new ApiException("Give the reason for the return");
        if (req.lines() == null || req.lines().stream().noneMatch(l -> l.qty() != null && l.qty().signum() > 0))
            throw new ApiException("Enter a return quantity for at least one line");
        AppUser u = currentUser.me();
        if (!"ADMIN".equals(u.getRole()) && !"MANAGER".equals(u.getRole()))
            throw new ApiException("Only a manager or admin can send goods back to a supplier");

        Map<String, Object> data = returnable(req.grnId());
        @SuppressWarnings("unchecked") Map<String, Object> grn = (Map<String, Object>) data.get("receipt");
        @SuppressWarnings("unchecked") List<Map<String, Object>> grnLines = (List<Map<String, Object>>) data.get("lines");
        UUID supplierId = (UUID) grn.get("supplier_id");

        String settlement = req.settlement() == null || req.settlement().isBlank() ? "DEBIT_NOTE" : req.settlement();
        if (!"DEBIT_NOTE".equals(settlement) && !"CASH_REFUND".equals(settlement))
            throw new ApiException("Settlement must be DEBIT_NOTE or CASH_REFUND");

        LocalDate returnDate = req.returnDate() == null ? LocalDate.now() : req.returnDate();
        LocalDate received = ((java.sql.Date) grn.get("receipt_date")).toLocalDate();
        if (returnDate.isAfter(LocalDate.now())) throw new ApiException("A return can't be dated in the future");
        if (returnDate.isBefore(received)) throw new ApiException("A return can't be dated before its receipt (" + received + ")");
        accounting.assertPeriodOpen(returnDate);

        String refundTo = null;
        if ("CASH_REFUND".equals(settlement)) {
            String code = req.refundAccount() == null || req.refundAccount().isBlank() ? "1000" : req.refundAccount().trim();
            List<String> ok = jdbc.queryForList("""
                select a.code from account a left join account_group g on g.id = a.group_id
                where a.code = ? and a.active and (a.code = '1000' or g.code = 'A-BK')
            """, String.class, code);
            if (ok.isEmpty()) throw new ApiException("Pick a cash or bank ledger the refund is received into");
            refundTo = ok.get(0);
        }

        Map<UUID, Map<String, Object>> byLine = new HashMap<>();
        for (Map<String, Object> l : grnLines) byLine.put((UUID) l.get("grn_line_id"), l);

        UUID returnId = UUID.randomUUID();
        String returnNo = docNo.next("PR");
        String debitNo = "DEBIT_NOTE".equals(settlement) ? docNo.next("DN") : null;
        BigDecimal goods = BigDecimal.ZERO, cost = BigDecimal.ZERO;
        List<Object[]> rows = new ArrayList<>();
        Set<UUID> seen = new HashSet<>();
        for (Line l : req.lines()) {
            if (l.qty() == null || l.qty().signum() == 0) continue;
            if (l.qty().signum() < 0) throw new ApiException("Return quantity can't be negative");
            if (!seen.add(l.grnLineId())) throw new ApiException("A receipt line appears twice in the return");
            Map<String, Object> gl = byLine.get(l.grnLineId());
            if (gl == null) throw new ApiException("That line is not on this goods receipt");
            UUID layer = (UUID) gl.get("stock_layer_id");
            if (layer == null) throw new ApiException("No stock layer for " + gl.get("product_name"));
            jdbc.queryForList("select id from stock_layer where id = ? for update", UUID.class, layer);   // lock vs. a sale
            BigDecimal avail = bd(jdbc.queryForObject("select qty_remaining from stock_layer where id = ?", BigDecimal.class, layer))
                .min(bd(gl.get("qty_received")).subtract(bd(gl.get("qty_returned"))));
            if (l.qty().compareTo(avail) > 0)
                throw new ApiException("Only " + avail.stripTrailingZeros().toPlainString() + " of " + gl.get("product_name") + " can go back");
            BigDecimal price = bd(gl.get("unit_price")), unitCost = bd(gl.get("unit_cost"));
            goods = goods.add(l.qty().multiply(price).setScale(2, RoundingMode.HALF_UP));
            cost = cost.add(l.qty().multiply(unitCost).setScale(2, RoundingMode.HALF_UP));
            rows.add(new Object[]{UUID.randomUUID(), returnId, l.grnLineId(), gl.get("product_id"), layer, l.qty(), price, unitCost});
        }
        if (rows.isEmpty()) throw new ApiException("Enter a return quantity for at least one line");
        // the input VAT claimed on these goods goes back too, in proportion to the bill
        BigDecimal billGoods = bd(grn.get("goods_value"));
        BigDecimal vatBack = billGoods.signum() == 0 ? BigDecimal.ZERO
            : bd(grn.get("vat")).multiply(goods).divide(billGoods, 2, RoundingMode.HALF_UP);

        jdbc.update("""
            insert into purchase_return (id, return_no, debit_note_no, grn_id, supplier_id, warehouse_id, return_date, reason,
                                         settlement, refund_account, goods_value, cost_value, vat, created_by)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, returnId, returnNo, debitNo, req.grnId(), supplierId, grn.get("warehouse_id"), returnDate, req.reason().trim(),
            settlement, refundTo, goods, cost, vatBack, u.getUsername());
        for (Object[] r : rows) {
            jdbc.update("""
                insert into purchase_return_line (id, return_id, grn_line_id, product_id, stock_layer_id, qty, unit_price, unit_cost)
                values (?,?,?,?,?,?,?,?)
            """, r);
            inventory.removeFromLayer((UUID) r[4], (BigDecimal) r[5], returnId, returnDate);
        }

        // supplier (or the refund) takes the billed value; stock leaves at landed cost; unrefunded freight is a cost
        String counter = "DEBIT_NOTE".equals(settlement) ? ledgers.supplierLedger(supplierId).getCode() : refundTo;
        List<Leg> legs = new ArrayList<>();
        if (goods.signum() > 0) legs.add(Leg.debit(counter, goods));
        BigDecimal diff = cost.add(vatBack).subtract(goods);
        if (diff.signum() > 0) legs.add(Leg.debit("5000", diff));
        if (diff.signum() < 0) legs.add(Leg.credit("5000", diff.negate()));
        if (cost.signum() > 0) legs.add(Leg.credit("1200", cost));
        if (vatBack.signum() > 0) legs.add(Leg.credit(com.mim.erp.accounting.VatService.INPUT_VAT, vatBack));
        if (!legs.isEmpty())
            accounting.post(returnDate, ("DEBIT_NOTE".equals(settlement) ? "Debit note " + debitNo : "Supplier refund")
                + " - purchase return " + returnNo + " against " + grn.get("grn_no"), "PURCHASE_RETURN", returnId, legs);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("id", returnId); res.put("returnNo", returnNo); res.put("debitNoteNo", debitNo);
        res.put("settlement", settlement); res.put("goodsValue", goods); res.put("costValue", cost);
        return res;
    }

    private static BigDecimal bd(Object o) {
        return o == null ? BigDecimal.ZERO : o instanceof BigDecimal b ? b : new BigDecimal(o.toString());
    }
}
