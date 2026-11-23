package com.mim.erp.purchase;

import com.mim.erp.accounting.BillService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Receipt / billing / payment progress of purchase orders (view {@code po_progress}, V79).
 * A PO is CLOSED only when every line is received, every receipt is billed and every bill is settled;
 * it opens again when a payment match is undone or a bill is cancelled. CANCELLED POs are left alone.
 */
@Service
@Order(200)   // after BillService has built the bill-wise items
public class PoStatusService implements BillService.PartyListener, ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PoStatusService.class);
    private final JdbcTemplate jdbc;

    public PoStatusService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    private static final String CLOSED_EXPR = """
        case when v.receipt_status = 'DONE' and v.unbilled <= 0 and v.remaining <= 0 then 'CLOSED' else 'OPEN' end
    """;

    /** Recompute the stored status of one PO, one supplier's POs, or (both null) every PO. */
    public int refresh(UUID poId, UUID supplierId) {
        return jdbc.update("""
            update purchase_order p set status = %s, updated_at = now()
            from po_progress v
            where v.po_id = p.id and p.status in ('OPEN', 'CLOSED')
              and (?::uuid is null or p.id = ?::uuid) and (?::uuid is null or p.supplier_id = ?::uuid)
              and p.status <> %s
        """.formatted(CLOSED_EXPR, CLOSED_EXPR), poId, poId, supplierId, supplierId);
    }

    @Override
    public void partyChanged(String partyType, UUID partyId) {
        if (partyType == null || "SUPPLIER".equals(partyType)) refresh(null, partyId);
    }

    @Override
    public void run(ApplicationArguments args) {
        int n = refresh(null, null);
        if (n > 0) log.info("Purchase order status brought in line with receipts, bills and payments: {}", n);
    }

    /** Progress of POs (all when ids is null) keyed by PO id: receipt, bill and payment status with amounts. */
    public Map<UUID, Map<String, Object>> progress(Collection<UUID> ids) {
        List<Map<String, Object>> rows = ids == null
            ? jdbc.queryForList("select * from po_progress")
            : ids.isEmpty() ? List.of()
            : jdbc.queryForList("select * from po_progress where po_id in (" + String.join(",", Collections.nCopies(ids.size(), "?")) + ")",
                ids.toArray());
        Map<UUID, Map<String, Object>> out = new LinkedHashMap<>();
        for (Map<String, Object> r : rows) out.put((UUID) r.get("po_id"), shape(r));
        return out;
    }

    static Map<String, Object> shape(Map<String, Object> r) {
        java.math.BigDecimal unbilled = bd(r.get("unbilled")), billed = bd(r.get("billed")), remaining = bd(r.get("remaining"));
        String bill = unbilled.signum() > 0 ? (billed.signum() > 0 ? "PARTIAL" : "NONE")
            : billed.signum() > 0 ? "BILLED" : "NONE";
        String pay = billed.signum() == 0 ? "UNPAID" : remaining.signum() <= 0 ? "PAID"
            : remaining.compareTo(billed) < 0 ? "PARTIAL" : "UNPAID";
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("poId", r.get("po_id"));
        m.put("status", r.get("status"));
        m.put("receiptStatus", r.get("receipt_status"));
        m.put("billStatus", bill);
        m.put("payStatus", pay);
        m.put("unbilled", unbilled);
        m.put("billed", billed);
        m.put("paid", billed.subtract(remaining.max(java.math.BigDecimal.ZERO)));
        m.put("remaining", remaining);
        return m;
    }

    private static java.math.BigDecimal bd(Object o) {
        return o == null ? java.math.BigDecimal.ZERO : o instanceof java.math.BigDecimal b ? b : new java.math.BigDecimal(o.toString());
    }
}
