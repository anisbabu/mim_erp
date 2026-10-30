package com.mim.erp.inventory;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Stock reports that look beyond stock_layer:
 *   status   — on hand vs committed (sold, not yet picked up) vs on order (due from suppliers)
 *   committed — which customers are waiting for a product
 *   summary  — opening / inward / outward / closing over a period, from stock_movement
 */
@Service
public class StockReportService {

    private final JdbcTemplate jdbc;

    public StockReportService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public record StatusRow(UUID productId, BigDecimal onHand, BigDecimal committed,
                            BigDecimal available, BigDecimal onOrder, BigDecimal value) {}

    public record CommittedRow(UUID soId, String soNo, LocalDate orderDate,
                               UUID customerId, String customerName, BigDecimal qtyPending) {}

    public record SummaryRow(UUID productId, String productGroup,
                             BigDecimal openingQty, BigDecimal openingValue,
                             BigDecimal inwardQty, BigDecimal inwardValue,
                             BigDecimal outwardQty, BigDecimal outwardValue,
                             BigDecimal closingQty, BigDecimal closingValue) {}

    /** Per product: on hand, committed to customers, available (= on hand - committed), on order. */
    public List<StatusRow> status() {
        return jdbc.query("""
            with oh as (
              select product_id, sum(qty_remaining) qty, sum(qty_remaining * unit_cost) val
              from stock_layer where qty_remaining > 0 group by product_id
            ), cm as (
              select sl.product_id, sum(sl.qty_pending) qty
              from so_line sl join sales_order so on so.id = sl.so_id
              where sl.qty_pending > 0 and so.status <> 'CANCELLED' group by sl.product_id
            ), oo as (
              select pl.product_id, sum(pl.qty_balance) qty
              from po_line pl join purchase_order po on po.id = pl.po_id
              where po.status = 'OPEN' and pl.qty_balance > 0 group by pl.product_id
            )
            select p.id, coalesce(oh.qty,0) on_hand, coalesce(cm.qty,0) committed,
                   coalesce(oo.qty,0) on_order, coalesce(oh.val,0) val
            from product p
            left join oh on oh.product_id = p.id
            left join cm on cm.product_id = p.id
            left join oo on oo.product_id = p.id
            where oh.product_id is not null or cm.product_id is not null or oo.product_id is not null
            """, (rs, i) -> {
                BigDecimal onHand = rs.getBigDecimal("on_hand");
                BigDecimal committed = rs.getBigDecimal("committed");
                return new StatusRow(rs.getObject("id", UUID.class), onHand, committed,
                    onHand.subtract(committed), rs.getBigDecimal("on_order"), rs.getBigDecimal("val"));
            });
    }

    /** Open sales-order lines still waiting for this product, oldest first. */
    public List<CommittedRow> committed(UUID productId) {
        return jdbc.query("""
            select so.id, so.so_no, so.order_date, c.id cust_id, c.name cust_name, sum(sl.qty_pending) qty
            from so_line sl
            join sales_order so on so.id = sl.so_id
            join customer c on c.id = so.customer_id
            where sl.product_id = ? and sl.qty_pending > 0 and so.status <> 'CANCELLED'
            group by so.id, so.so_no, so.order_date, c.id, c.name
            order by so.order_date, so.so_no
            """, (rs, i) -> new CommittedRow(rs.getObject("id", UUID.class), rs.getString("so_no"),
                rs.getObject("order_date", LocalDate.class), rs.getObject("cust_id", UUID.class),
                rs.getString("cust_name"), rs.getBigDecimal("qty")), productId);
    }

    /**
     * Opening / inward / outward / closing per product for [from, to].
     * Company-wide (warehouseId null) ignores transfers in the in/out columns, since
     * they only move stock between our own warehouses; per-warehouse includes them.
     */
    public List<SummaryRow> summary(LocalDate from, LocalDate to, UUID warehouseId) {
        String counted = warehouseId == null ? "m.type not in ('TRANSFER_IN','TRANSFER_OUT')" : "true";
        String whFilter = warehouseId == null ? "" : "and m.warehouse_id = ?::uuid";
        List<Object> args = new ArrayList<>(List.of(from.toString(), to.toString()));
        if (warehouseId != null) args.add(warehouseId.toString());

        String sql = """
            with prm as (select ?::date d_from, ?::date d_to)
            select m.product_id, p.product_group,
              sum(case when m.move_date < prm.d_from then m.qty else 0 end) open_qty,
              sum(case when m.move_date < prm.d_from then m.qty * m.unit_cost else 0 end) open_val,
              sum(case when m.move_date >= prm.d_from and m.qty > 0 and %1$s then m.qty else 0 end) in_qty,
              sum(case when m.move_date >= prm.d_from and m.qty > 0 and %1$s then m.qty * m.unit_cost else 0 end) in_val,
              sum(case when m.move_date >= prm.d_from and m.qty < 0 and %1$s then -m.qty else 0 end) out_qty,
              sum(case when m.move_date >= prm.d_from and m.qty < 0 and %1$s then -m.qty * m.unit_cost else 0 end) out_val,
              sum(m.qty) close_qty, sum(m.qty * m.unit_cost) close_val
            from stock_movement m
            cross join prm
            join product p on p.id = m.product_id
            where m.move_date <= prm.d_to %2$s
            group by m.product_id, p.product_group
            having sum(abs(m.qty)) > 0
            order by p.product_group nulls last, m.product_id
            """.formatted(counted, whFilter);

        return jdbc.query(sql, (rs, i) -> new SummaryRow(
            rs.getObject("product_id", UUID.class), rs.getString("product_group"),
            rs.getBigDecimal("open_qty"), rs.getBigDecimal("open_val"),
            rs.getBigDecimal("in_qty"), rs.getBigDecimal("in_val"),
            rs.getBigDecimal("out_qty"), rs.getBigDecimal("out_val"),
            rs.getBigDecimal("close_qty"), rs.getBigDecimal("close_val")), args.toArray());
    }
}
