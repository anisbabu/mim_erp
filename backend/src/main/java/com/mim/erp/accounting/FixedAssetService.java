package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.mim.erp.accounting.ReportService.bd;

/**
 * Fixed asset register with straight-line depreciation (IAS 16).
 * Cost sits in 1500, accumulated depreciation in 1590, the charge in 5400, disposal gain / loss in 4100 / 5900.
 * Depreciation starts in the month of purchase and stops when cost less residual value is fully written off.
 */
@Service
public class FixedAssetService {

    private final JdbcTemplate jdbc;
    private final AccountingService accounting;

    public FixedAssetService(JdbcTemplate jdbc, AccountingService accounting) {
        this.jdbc = jdbc; this.accounting = accounting;
    }

    public List<Map<String, Object>> register() {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "select f.id, f.code, f.name, f.category, f.purchase_date, f.cost, f.residual_value, f.useful_life_months, "
          + "       f.status, f.disposal_date, f.disposal_proceeds, f.note, "
          + "       coalesce((select sum(d.amount) from fixed_asset_depreciation d where d.asset_id = f.id), 0) as accumulated, "
          + "       (select count(*) from fixed_asset_depreciation d where d.asset_id = f.id) as months_charged "
          + "from fixed_asset f order by f.code");
        for (Map<String, Object> r : rows) r.put("net_book_value", bd(r.get("cost")).subtract(bd(r.get("accumulated"))));
        return rows;
    }

    private String nextCode() {
        Long max = jdbc.queryForObject(
            "select max(substring(code from 4)::bigint) from fixed_asset where code ~ '^FA-[0-9]+$'", Long.class);
        return "FA-%04d".formatted(max == null ? 1 : max + 1);
    }

    /**
     * Register a new asset. When {@code paidFromAccountId} is given, the purchase is posted
     * (Dr Fixed Assets, Cr that ledger - bank, cash or a supplier ledger); otherwise it only
     * records the asset (opening assets already in the books).
     */
    @Transactional
    public Map<String, Object> create(Map<String, Object> in) {
        String name = str(in.get("name"));
        if (name == null) throw new ApiException("Asset name is required");
        LocalDate purchase = LocalDate.parse(String.valueOf(in.get("purchaseDate")));
        BigDecimal cost = dec(in.get("cost"));
        BigDecimal residual = in.get("residualValue") == null ? BigDecimal.ZERO : dec(in.get("residualValue"));
        int life = Integer.parseInt(String.valueOf(in.get("usefulLifeMonths")));
        if (cost.signum() <= 0) throw new ApiException("Cost must be greater than zero");
        if (residual.compareTo(cost) >= 0) throw new ApiException("Residual value must be less than cost");
        if (life <= 0) throw new ApiException("Useful life must be at least one month");

        String code = nextCode();
        UUID id = UUID.randomUUID();
        jdbc.update("insert into fixed_asset (id, code, name, category, purchase_date, cost, residual_value, useful_life_months, note) "
                  + "values (?, ?, ?, ?, ?::date, ?, ?, ?, ?)",
            id, code, name, str(in.get("category")), purchase.toString(), cost, residual, life, str(in.get("note")));

        Object paidFrom = in.get("paidFromAccountId");
        if (paidFrom != null && !paidFrom.toString().isBlank()) {
            String payCode = jdbc.queryForObject("select code from account where id = ?::uuid", String.class, paidFrom.toString());
            accounting.post(purchase, "Purchase of fixed asset " + code + " " + name, "FIXED_ASSET", id,
                List.of(AccountingService.Leg.debit("1500", cost), AccountingService.Leg.credit(payCode, cost)));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id); out.put("code", code);
        return out;
    }

    /** Charge one month's depreciation for every active asset; one journal entry for the whole run. */
    @Transactional
    public Map<String, Object> depreciate(String period) {
        YearMonth ym;
        try { ym = YearMonth.parse(period); } catch (Exception e) { throw new ApiException("Period must be yyyy-mm"); }
        LocalDate last = ym.atEndOfMonth();
        if (last.isAfter(LocalDate.now().withDayOfMonth(1).plusMonths(1).minusDays(1)))
            throw new ApiException("Depreciation can't be charged for a future month");

        List<Map<String, Object>> assets = jdbc.queryForList(
            "select id, code, cost, residual_value, useful_life_months, purchase_date, "
          + "       coalesce((select sum(amount) from fixed_asset_depreciation d where d.asset_id = f.id), 0) as accumulated "
          + "from fixed_asset f where status = 'ACTIVE' and purchase_date <= ?::date "
          + "  and not exists (select 1 from fixed_asset_depreciation d where d.asset_id = f.id and d.period = ?) "
          + "order by code", last.toString(), period);

        List<Object[]> charges = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;
        for (Map<String, Object> a : assets) {
            BigDecimal depreciable = bd(a.get("cost")).subtract(bd(a.get("residual_value")));
            BigDecimal remaining = depreciable.subtract(bd(a.get("accumulated")));
            if (remaining.signum() <= 0) continue;
            int life = ((Number) a.get("useful_life_months")).intValue();
            BigDecimal monthly = depreciable.divide(BigDecimal.valueOf(life), 2, RoundingMode.HALF_UP).min(remaining);
            // the final month takes whatever is left so rounding never leaves a residue
            long monthsBefore = ChronoUnit.MONTHS.between(
                YearMonth.from(((java.sql.Date) a.get("purchase_date")).toLocalDate()), ym);
            if (monthsBefore + 1 >= life) monthly = remaining;
            if (monthly.signum() <= 0) continue;
            charges.add(new Object[]{a.get("id"), monthly});
            total = total.add(monthly);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("period", period);
        if (charges.isEmpty()) { out.put("assets", 0); out.put("total", BigDecimal.ZERO); return out; }

        JournalEntry je = accounting.post(last, "Depreciation for " + period, "DEPRECIATION", null,
            List.of(AccountingService.Leg.debit("5400", total), AccountingService.Leg.credit("1590", total)));
        for (Object[] c : charges)
            jdbc.update("insert into fixed_asset_depreciation (asset_id, period, amount, journal_id) values (?, ?, ?, ?)",
                c[0], period, c[1], je.getId());
        out.put("assets", charges.size()); out.put("total", total); out.put("entryNo", je.getEntryNo());
        return out;
    }

    /** Dispose of an asset: remove cost and accumulated depreciation, bank the proceeds, book the gain or loss. */
    @Transactional
    public Map<String, Object> dispose(UUID id, LocalDate date, BigDecimal proceeds, UUID depositAccountId) {
        Map<String, Object> a = jdbc.queryForList(
            "select id, code, name, cost, status, "
          + "  coalesce((select sum(amount) from fixed_asset_depreciation d where d.asset_id = f.id), 0) as accumulated "
          + "from fixed_asset f where id = ?", id).stream().findFirst()
            .orElseThrow(() -> new ApiException("Asset not found"));
        if (!"ACTIVE".equals(a.get("status"))) throw new ApiException("This asset is already disposed");
        BigDecimal p = proceeds == null ? BigDecimal.ZERO : proceeds;
        if (p.signum() < 0) throw new ApiException("Proceeds can't be negative");
        if (p.signum() > 0 && depositAccountId == null) throw new ApiException("Pick the cash / bank ledger that receives the proceeds");

        BigDecimal cost = bd(a.get("cost")), acc = bd(a.get("accumulated"));
        BigDecimal nbv = cost.subtract(acc);
        BigDecimal gainLoss = p.subtract(nbv);                    // > 0 gain, < 0 loss
        List<AccountingService.Leg> legs = new ArrayList<>();
        if (p.signum() > 0) {
            String dep = jdbc.queryForObject("select code from account where id = ?", String.class, depositAccountId);
            legs.add(AccountingService.Leg.debit(dep, p));
        }
        if (acc.signum() > 0) legs.add(AccountingService.Leg.debit("1590", acc));
        legs.add(AccountingService.Leg.credit("1500", cost));
        if (gainLoss.signum() > 0) legs.add(AccountingService.Leg.credit("4100", gainLoss));
        if (gainLoss.signum() < 0) legs.add(AccountingService.Leg.debit("5900", gainLoss.negate()));
        JournalEntry je = accounting.post(date, "Disposal of fixed asset " + a.get("code") + " " + a.get("name"),
            "FIXED_ASSET", id, legs);
        jdbc.update("update fixed_asset set status = 'DISPOSED', disposal_date = ?::date, disposal_proceeds = ? where id = ?",
            date.toString(), p, id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("entryNo", je.getEntryNo()); out.put("gainLoss", gainLoss);
        return out;
    }

    private static String str(Object o) { return o == null || o.toString().isBlank() ? null : o.toString().trim(); }
    private static BigDecimal dec(Object o) {
        try { return new BigDecimal(String.valueOf(o)); } catch (Exception e) { throw new ApiException("Invalid amount"); }
    }
}
