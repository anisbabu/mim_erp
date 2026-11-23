package com.mim.erp.sales;

import com.mim.erp.accounting.BillService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.*;

/**
 * Delivery / payment progress of sales orders (view {@code so_progress}, V80). The delivery is the invoice,
 * so an order is CLOSED once everything is delivered and every invoice on it is settled; it goes back to
 * DELIVERED (order first) or INVOICED (challans first, day-end invoice) when a receipt match is undone.
 * Orders still being delivered, drafts and cancelled orders are left alone.
 */
@Service
@Order(210)   // after BillService has built the bill-wise items
public class SoStatusService implements BillService.PartyListener, ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SoStatusService.class);
    private final JdbcTemplate jdbc;

    public SoStatusService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    private static final String TARGET = """
        case when v.delivery_status = 'DONE' and v.remaining <= 0 then 'CLOSED'
             when v.workflow = 'DC_FIRST' then 'INVOICED' else 'DELIVERED' end
    """;

    /** Recompute the stored status of one order, one customer's orders, or (both null) every order. */
    public int refresh(UUID soId, UUID customerId) {
        return jdbc.update("""
            update sales_order s set status = %s, updated_at = now()
            from so_progress v
            where v.so_id = s.id and s.status in ('DELIVERED', 'INVOICED', 'CLOSED') and v.delivery_status = 'DONE'
              and (?::uuid is null or s.id = ?::uuid) and (?::uuid is null or s.customer_id = ?::uuid)
              and s.status <> %s
        """.formatted(TARGET, TARGET), soId, soId, customerId, customerId);
    }

    public String status(UUID soId) {
        return jdbc.queryForObject("select status from sales_order where id = ?", String.class, soId);
    }

    @Override
    public void partyChanged(String partyType, UUID partyId) {
        if (partyType == null || "CUSTOMER".equals(partyType)) refresh(null, partyId);
    }

    @Override
    public void run(ApplicationArguments args) {
        int n = refresh(null, null);
        if (n > 0) log.info("Sales order status brought in line with deliveries and receipts: {}", n);
    }

    /** Progress of orders (all when ids is null) keyed by order id. */
    public Map<UUID, Map<String, Object>> progress(Collection<UUID> ids) {
        List<Map<String, Object>> rows = ids == null
            ? jdbc.queryForList("select * from so_progress")
            : ids.isEmpty() ? List.of()
            : jdbc.queryForList("select * from so_progress where so_id in (" + String.join(",", Collections.nCopies(ids.size(), "?")) + ")",
                ids.toArray());
        Map<UUID, Map<String, Object>> out = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) {
            BigDecimal invoiced = bd(r.get("invoiced")), remaining = bd(r.get("remaining"));
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("soId", r.get("so_id"));
            m.put("status", r.get("status"));
            m.put("deliveryStatus", r.get("delivery_status"));
            // nothing on account: a cash sale (paid at the counter) or a free delivery is settled
            boolean settledOutright = invoiced.signum() == 0
                && ("CASH".equals(r.get("payment_mode")) || "DONE".equals(r.get("delivery_status")));
            m.put("payStatus", settledOutright ? "PAID" : invoiced.signum() == 0 ? "UNPAID" : remaining.signum() <= 0 ? "PAID"
                : remaining.compareTo(invoiced) < 0 ? "PARTIAL" : "UNPAID");
            m.put("invoiced", invoiced);
            m.put("paid", invoiced.subtract(remaining.max(BigDecimal.ZERO)));
            m.put("remaining", remaining);
            out.put((UUID) r.get("so_id"), m);
        }
        return out;
    }

    /** Customer invoices (one per delivery / day-end invoice, plus openings), newest first. */
    public List<Map<String, Object>> invoices(UUID customerId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
            select ci.*, c.code as customer_code, c.name as customer_name, c.name_bn as customer_name_bn
            from customer_invoice ci join customer c on c.id = ci.customer_id
            where (?::uuid is null or ci.customer_id = ?::uuid)
            order by ci.doc_date desc, ci.doc_no desc
        """, customerId, customerId);
        for (Map<String, Object> r : rows) {
            BigDecimal amount = bd(r.get("amount")), open = bd(r.get("open_amount"));
            r.put("paid", amount.subtract(open.max(BigDecimal.ZERO)));
            r.put("pay_status", open.signum() <= 0 ? "PAID" : open.compareTo(amount) < 0 ? "PARTIAL" : "UNPAID");
        }
        return rows;
    }

    private static BigDecimal bd(Object o) {
        return o == null ? BigDecimal.ZERO : o instanceof BigDecimal b ? b : new BigDecimal(o.toString());
    }
}
