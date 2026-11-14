package com.mim.erp.accounting;

import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * One-off clean-up for sales booked before Sales Discount (4010) and Transport Recovered (4400) existed:
 * those postings put transport and the net-of-discount value all into Sales (4000). For every fully booked
 * order (and every sales return) it posts the missing split as a RECLASS journal against the order / return:
 *   Dr Sales 4000 / Cr Transport Recovered 4400   for transport
 *   Dr Sales Discount 4010 / Cr Sales 4000         for discount (a return: the reverse, its share)
 * Party ledgers are untouched. Safe to run again: what is already split (by new postings or an earlier run)
 * is not split twice.
 */
@Service
public class ReclassService {

    private static final String SALES = "4000", DISCOUNT = "4010", TRANSPORT = "4400";

    private final JdbcTemplate jdbc;
    private final AccountingService accounting;

    public ReclassService(JdbcTemplate jdbc, AccountingService accounting) { this.jdbc = jdbc; this.accounting = accounting; }

    @Transactional
    public Map<String, Object> reclassifySales() {
        List<Map<String, Object>> done = new ArrayList<>();
        BigDecimal transportTotal = BigDecimal.ZERO, discountTotal = BigDecimal.ZERO;

        for (Map<String, Object> so : jdbc.queryForList("""
                select so.id, so.so_no, coalesce(so.transport_and_lifting, 0) as transport,
                       coalesce((select sum(coalesce(sl.discount_amt, 0)) from so_line sl where sl.so_id = so.id), 0) as discount,
                       coalesce((select sum(round(sl.qty * sl.unit_price, 2) - coalesce(sl.discount_amt, 0)) from so_line sl where sl.so_id = so.id), 0)
                         + coalesce(so.transport_and_lifting, 0) as total
                from sales_order so where so.status <> 'CANCELLED' order by so.order_date, so.so_no
            """)) {
            UUID soId = (UUID) so.get("id");
            String sources = "select ?::uuid union select id from delivery_challan where so_id = ?";
            String types = "('SALES_DELIVERY', 'SALES_INVOICE', 'RECLASS')";
            BigDecimal booked = net("'4000','4010','4400','2100'", types, sources, soId);
            if (booked.compareTo(bd(so.get("total"))) < 0) continue;            // not fully booked yet: new rules will split it
            BigDecimal t = bd(so.get("transport")).subtract(net("'" + TRANSPORT + "'", types, sources, soId)).max(BigDecimal.ZERO);
            BigDecimal d = bd(so.get("discount")).subtract(net("'" + DISCOUNT + "'", types, sources, soId).negate()).max(BigDecimal.ZERO);
            if (t.signum() == 0 && d.signum() == 0) continue;
            List<Leg> legs = new ArrayList<>();
            if (t.signum() > 0) { legs.add(Leg.debit(SALES, t)); legs.add(Leg.credit(TRANSPORT, t)); }
            if (d.signum() > 0) { legs.add(Leg.debit(DISCOUNT, d)); legs.add(Leg.credit(SALES, d)); }
            LocalDate date = postingDate(types, sources, soId);
            accounting.post(date, "Reclassify " + so.get("so_no") + ": transport / discount out of Sales", "RECLASS", soId, legs);
            transportTotal = transportTotal.add(t); discountTotal = discountTotal.add(d);
            done.add(Map.of("doc", so.get("so_no"), "date", date.toString(), "transport", t, "discount", d));
        }

        // returns booked as one net debit to Sales: give back their share of the discount on 4010
        for (Map<String, Object> r : jdbc.queryForList("""
                select sr.id, sr.return_no,
                       coalesce((select sum(round(rl.qty * coalesce(
                           (select sum(coalesce(sl.discount_amt, 0)) / nullif(sum(sl.qty), 0) from so_line sl
                             where sl.so_id = sr.so_id and sl.product_id = rl.product_id), 0), 2))
                         from sales_return_line rl where rl.return_id = sr.id), 0) as discount
                from sales_return sr order by sr.return_date, sr.return_no
            """)) {
            UUID id = (UUID) r.get("id");
            String sources = "select ?::uuid union select ?::uuid";
            String types = "('SALES_RETURN', 'RECLASS')";
            BigDecimal d = bd(r.get("discount")).subtract(net("'" + DISCOUNT + "'", types, sources, id)).max(BigDecimal.ZERO);
            if (d.signum() == 0) continue;
            LocalDate date = postingDate(types, sources, id);
            accounting.post(date, "Reclassify " + r.get("return_no") + ": discount given back", "RECLASS", id,
                List.of(Leg.debit(SALES, d), Leg.credit(DISCOUNT, d)));
            discountTotal = discountTotal.subtract(d);
            done.add(Map.of("doc", r.get("return_no"), "date", date.toString(), "transport", BigDecimal.ZERO, "discount", d.negate()));
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("documents", done); out.put("transport", transportTotal); out.put("discount", discountTotal);
        return out;
    }

    /** Net credit on the given ledgers by journals of the given types for a document and its challans. */
    private BigDecimal net(String codes, String types, String sources, UUID id) {
        return bd(jdbc.queryForObject(
            "select coalesce(sum(jl.credit - jl.debit), 0) from journal_line jl join journal_entry je on je.id = jl.journal_id "
          + "join account a on a.id = jl.account_id where a.code in (" + codes + ") and je.source_type in " + types
          + " and je.source_id in (" + sources + ")", BigDecimal.class, id, id));
    }

    /** The document's own last posting date when its period is still open, else today. */
    private LocalDate postingDate(String types, String sources, UUID id) {
        LocalDate d = jdbc.queryForObject("select max(je.entry_date) from journal_entry je where je.source_type in " + types
            + " and je.source_id in (" + sources + ")", LocalDate.class, id, id);
        if (d == null) return LocalDate.now();
        try { accounting.assertPeriodOpen(d); return d; } catch (ApiException closed) { return LocalDate.now(); }
    }

    private static BigDecimal bd(Object o) { return o == null ? BigDecimal.ZERO : new BigDecimal(o.toString()); }
}
