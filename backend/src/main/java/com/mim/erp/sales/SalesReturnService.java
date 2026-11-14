package com.mim.erp.sales;

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
 * Sales return / credit note. Goods go back into the FIFO layer they were sold from, and the sale is
 * reversed: Dr Sales / Cr customer (credit note) or Cash (refund), and Dr Inventory / Cr Cost of sales.
 * Only goods already delivered on an order can come back, and never more than was delivered.
 */
@Service
public class SalesReturnService {

    public record Line(UUID dcLineId, BigDecimal qty) {}
    /** returnDate: blank = today. refundAccount: cash/bank ledger code a cash refund is paid from (blank = Cash 1000). */
    public record CreateRequest(UUID soId, String reason, String settlement, List<Line> lines,
                                LocalDate returnDate, String refundAccount) {}

    private final JdbcTemplate jdbc;
    private final InventoryService inventory;
    private final AccountingService accounting;
    private final LedgerService ledgers;
    private final DocNumberService docNo;
    private final CurrentUserService currentUser;

    public SalesReturnService(JdbcTemplate jdbc, InventoryService inventory, AccountingService accounting,
                              LedgerService ledgers, DocNumberService docNo, CurrentUserService currentUser) {
        this.jdbc = jdbc; this.inventory = inventory; this.accounting = accounting;
        this.ledgers = ledgers; this.docNo = docNo; this.currentUser = currentUser;
    }

    // ------------------------------------------------------------------ what can still come back
    /** Delivered lines of an order with how much has already been returned and the net price invoiced. */
    public Map<String, Object> returnable(UUID soId) {
        Map<String, Object> so = order(soId);
        Map<UUID, BigDecimal> price = netPrices(soId);
        List<Map<String, Object>> rows = jdbc.queryForList("""
            select dl.id as dc_line_id, dc.dc_no, dc.warehouse_id, w.name as warehouse_name,
                   dl.product_id, p.name as product_name, p.name_bn as product_name_bn, p.unit,
                   dl.qty as qty_delivered, dl.unit_cost,
                   coalesce((select sum(rl.qty) from sales_return_line rl where rl.dc_line_id = dl.id), 0) as qty_returned
            from dc_line dl
            join delivery_challan dc on dc.id = dl.dc_id
            join product p on p.id = dl.product_id
            left join warehouse w on w.id = dc.warehouse_id
            where dc.so_id = ? and dc.status <> 'CANCELLED'
            order by dc.dc_no, p.name
        """, soId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> o = new LinkedHashMap<>(r);
            BigDecimal avail = bd(r.get("qty_delivered")).subtract(bd(r.get("qty_returned")));
            o.put("qty_available", avail);
            o.put("net_unit_price", price.getOrDefault((UUID) r.get("product_id"), BigDecimal.ZERO));
            out.add(o);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("order", so);
        res.put("lines", out);
        return res;
    }

    // ------------------------------------------------------------------ create
    @Transactional
    public Map<String, Object> create(CreateRequest req) {
        if (req.soId() == null) throw new ApiException("Select the sales order being returned against");
        if (req.reason() == null || req.reason().isBlank()) throw new ApiException("Give the reason for the return");
        if (req.lines() == null || req.lines().stream().noneMatch(l -> l.qty() != null && l.qty().signum() > 0))
            throw new ApiException("Enter a return quantity for at least one line");

        AppUser u = currentUser.me();
        if (!"ADMIN".equals(u.getRole()) && !"MANAGER".equals(u.getRole()))
            throw new ApiException("Only a manager or admin can accept a sales return");

        Map<String, Object> so = order(req.soId());
        UUID shopId = (UUID) so.get("shop_id");
        if ("MANAGER".equals(u.getRole()) && (shopId == null || !u.getShopIds().contains(shopId)))
            throw new ApiException("That order belongs to a shop you don't manage");
        UUID customerId = (UUID) so.get("customer_id");
        String payMode = String.valueOf(so.get("payment_mode"));

        String settlement = req.settlement() == null || req.settlement().isBlank()
            ? ("CASH".equals(payMode) ? "CASH_REFUND" : "CREDIT_NOTE") : req.settlement();
        if (!"CREDIT_NOTE".equals(settlement) && !"CASH_REFUND".equals(settlement))
            throw new ApiException("Settlement must be CREDIT_NOTE or CASH_REFUND");
        if ("CASH_REFUND".equals(settlement) && !"CASH".equals(payMode))
            throw new ApiException("This was a credit sale - settle the return with a credit note");

        // the return is booked on the day the goods came back, which may be before it is keyed in
        LocalDate returnDate = req.returnDate() == null ? LocalDate.now() : req.returnDate();
        if (returnDate.isAfter(LocalDate.now())) throw new ApiException("A return can't be dated in the future");
        Object ordered = so.get("order_date");
        if (ordered instanceof java.sql.Date d && returnDate.isBefore(d.toLocalDate()))
            throw new ApiException("A return can't be dated before its order (" + d.toLocalDate() + ")");
        accounting.assertPeriodOpen(returnDate);

        String refundFrom = "1000";
        if ("CASH_REFUND".equals(settlement) && req.refundAccount() != null && !req.refundAccount().isBlank()) {
            List<String> ok = jdbc.queryForList("""
                select a.code from account a left join account_group g on g.id = a.group_id
                where a.code = ? and a.active and (a.code = '1000' or g.code = 'A-BK')
            """, String.class, req.refundAccount().trim());
            if (ok.isEmpty()) throw new ApiException("Pick a cash or bank ledger to refund from");
            refundFrom = ok.get(0);
        }

        Map<UUID, BigDecimal> price = netPrices(req.soId()), unitDisc = unitDiscounts(req.soId());
        UUID returnId = UUID.randomUUID();
        BigDecimal goods = BigDecimal.ZERO, cost = BigDecimal.ZERO, vatBack = BigDecimal.ZERO, discBack = BigDecimal.ZERO;
        List<Object[]> lineRows = new ArrayList<>();
        Set<UUID> seen = new HashSet<>();

        for (Line l : req.lines()) {
            if (l.qty() == null || l.qty().signum() == 0) continue;
            if (l.qty().signum() < 0) throw new ApiException("Return quantity cannot be negative");
            if (!seen.add(l.dcLineId())) throw new ApiException("A delivery line appears twice in the return");
            List<Map<String, Object>> found = jdbc.queryForList("""
                select dl.id, dl.product_id, dl.stock_layer_id, dl.qty, dl.unit_cost, dc.warehouse_id, dl.vat_rate,
                       coalesce((select sum(rl.qty) from sales_return_line rl where rl.dc_line_id = dl.id), 0) as returned
                from dc_line dl join delivery_challan dc on dc.id = dl.dc_id
                where dl.id = ? and dc.so_id = ? and dc.status <> 'CANCELLED'
                for update of dl
            """, l.dcLineId(), req.soId());
            if (found.isEmpty()) throw new ApiException("A returned line does not belong to this order");
            Map<String, Object> dl = found.get(0);
            BigDecimal avail = bd(dl.get("qty")).subtract(bd(dl.get("returned")));
            if (l.qty().compareTo(avail) > 0)
                throw new ApiException("Cannot return more than was delivered (" + avail.stripTrailingZeros().toPlainString() + " left on that line)");

            UUID productId = (UUID) dl.get("product_id");
            BigDecimal unitPrice = price.getOrDefault(productId, BigDecimal.ZERO);
            BigDecimal unitCost = bd(dl.get("unit_cost"));
            BigDecimal lineGoods = l.qty().multiply(unitPrice).setScale(2, RoundingMode.HALF_UP);
            goods = goods.add(lineGoods);
            discBack = discBack.add(l.qty().multiply(unitDisc.getOrDefault(productId, BigDecimal.ZERO)).setScale(2, RoundingMode.HALF_UP));
            vatBack = vatBack.add(com.mim.erp.accounting.VatService.inside(lineGoods, bd(dl.get("vat_rate"))));
            cost = cost.add(l.qty().multiply(unitCost).setScale(2, RoundingMode.HALF_UP));
            lineRows.add(new Object[]{UUID.randomUUID(), returnId, l.dcLineId(), productId, dl.get("warehouse_id"),
                dl.get("stock_layer_id"), l.qty(), unitPrice, unitCost});
        }
        if (lineRows.isEmpty()) throw new ApiException("Enter a return quantity for at least one line");

        String returnNo = docNo.next("SR");
        String creditNo = "CREDIT_NOTE".equals(settlement) ? docNo.next("CN") : null;
        jdbc.update("""
            insert into sales_return (id, return_no, credit_note_no, so_id, customer_id, shop_id, return_date, reason,
                                      settlement, goods_value, cost_value, vat, created_by)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, returnId, returnNo, creditNo, req.soId(), customerId, shopId, returnDate, req.reason().trim(),
            settlement, goods, cost, vatBack, u.getUsername());
        for (Object[] r : lineRows) {
            jdbc.update("""
                insert into sales_return_line (id, return_id, dc_line_id, product_id, warehouse_id, stock_layer_id, qty, unit_price, unit_cost)
                values (?,?,?,?,?,?,?,?,?)
            """, r);
            inventory.returnToLayer((UUID) r[5], (BigDecimal) r[6], returnId);
        }

        String customerSide = "CREDIT_NOTE".equals(settlement) ? ledgers.customerLedger(customerId).getCode() : refundFrom;
        List<Leg> legs = new ArrayList<>();
        if (goods.signum() > 0) {   // the sale and the output VAT charged on it both come back
            BigDecimal list = goods.subtract(vatBack).add(discBack);   // list price ex VAT; the discount given comes back too
            if (list.signum() > 0) legs.add(Leg.debit("4000", list));
            if (discBack.signum() > 0) legs.add(Leg.credit("4010", discBack));
            if (vatBack.signum() > 0) legs.add(Leg.debit(com.mim.erp.accounting.VatService.OUTPUT_VAT, vatBack));
            legs.add(Leg.credit(customerSide, goods));
        }
        if (cost.signum() > 0) { legs.add(Leg.debit("1200", cost)); legs.add(Leg.credit("5000", cost)); }
        accounting.post(returnDate, ("CREDIT_NOTE".equals(settlement) ? "Credit note " + creditNo : "Cash refund") + " - sales return " + returnNo
            + " against " + so.get("so_no"), "SALES_RETURN", returnId, legs);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("id", returnId); res.put("returnNo", returnNo); res.put("creditNoteNo", creditNo);
        res.put("settlement", settlement); res.put("goodsValue", goods); res.put("costValue", cost);
        return res;
    }

    // ------------------------------------------------------------------ reads
    public List<Map<String, Object>> list() {
        return jdbc.queryForList("""
            select r.id, r.return_no, r.credit_note_no, r.return_date, r.reason, r.settlement, r.goods_value, r.created_by,
                   so.so_no, c.code as customer_code, c.name as customer_name, c.name_bn as customer_name_bn
            from sales_return r
            join sales_order so on so.id = r.so_id
            join customer c on c.id = r.customer_id
            order by r.return_date desc, r.created_at desc
            limit 500
        """);
    }

    public Map<String, Object> detail(UUID id) {
        List<Map<String, Object>> h = jdbc.queryForList("""
            select r.*, so.so_no, c.code as customer_code, c.name as customer_name, c.name_bn as customer_name_bn,
                   c.address as customer_address, c.mobile as customer_mobile
            from sales_return r
            join sales_order so on so.id = r.so_id
            join customer c on c.id = r.customer_id
            where r.id = ?
        """, id);
        if (h.isEmpty()) throw new ApiException("Sales return not found");
        Map<String, Object> out = new LinkedHashMap<>(h.get(0));
        out.put("lines", jdbc.queryForList("""
            select p.name as product_name, p.name_bn as product_name_bn, p.unit, rl.qty, rl.unit_price,
                   round(rl.qty * rl.unit_price, 2) as amount
            from sales_return_line rl join product p on p.id = rl.product_id
            where rl.return_id = ? order by p.name
        """, id));
        return out;
    }

    public byte[] creditNotePdf(UUID id, boolean bn) { return SalesReturnPdf.render(detail(id), bn); }

    // ------------------------------------------------------------------ helpers
    private Map<String, Object> order(UUID soId) {
        List<Map<String, Object>> r = jdbc.queryForList("""
            select so.id, so.so_no, so.shop_id, so.customer_id, so.payment_mode, so.status, so.order_date,
                   c.code as customer_code, c.name as customer_name, c.name_bn as customer_name_bn
            from sales_order so join customer c on c.id = so.customer_id where so.id = ?
        """, soId);
        if (r.isEmpty()) throw new ApiException("Sales order not found");
        return r.get(0);
    }

    /** Net invoiced unit price per product on the order (after line discounts), the price revenue was booked at. */
    private Map<UUID, BigDecimal> netPrices(UUID soId) {
        Map<UUID, BigDecimal> out = new HashMap<>();
        jdbc.queryForList("""
            select product_id, sum(qty * unit_price - coalesce(discount_amt, 0)) as net, sum(qty) as q
            from so_line where so_id = ? group by product_id
        """, soId).forEach(r -> {
            BigDecimal q = bd(r.get("q"));
            out.put((UUID) r.get("product_id"), q.signum() == 0 ? BigDecimal.ZERO
                : bd(r.get("net")).divide(q, 4, RoundingMode.HALF_UP));
        });
        return out;
    }

    /** Trade discount per unit sold, by product, so a return gives back its share of Sales Discount (4010). */
    private Map<UUID, BigDecimal> unitDiscounts(UUID soId) {
        Map<UUID, BigDecimal> out = new HashMap<>();
        jdbc.queryForList("""
            select product_id, sum(coalesce(discount_amt, 0)) as d, sum(qty) as q from so_line where so_id = ? group by product_id
        """, soId).forEach(r -> {
            BigDecimal q = bd(r.get("q"));
            out.put((UUID) r.get("product_id"), q.signum() == 0 ? BigDecimal.ZERO : bd(r.get("d")).divide(q, 4, RoundingMode.HALF_UP));
        });
        return out;
    }

    private static BigDecimal bd(Object o) { return o == null ? BigDecimal.ZERO : new BigDecimal(o.toString()); }
}
