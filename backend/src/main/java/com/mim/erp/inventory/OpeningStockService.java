package com.mim.erp.inventory;

import com.mim.erp.accounting.AccountingService;
import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.common.ApiException;
import com.mim.erp.master.Product;
import com.mim.erp.master.ProductRepository;
import com.mim.erp.master.Warehouse;
import com.mim.erp.master.WarehouseRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * One-time load of closing stock from the old system as opening stock.
 * CSV columns: product_name,warehouse_name,qty,unit_cost[,product_id] (header row optional).
 * When product_id is given it wins over the name, so names never have to be re-matched.
 * Positive rows become OPENING layers dated at cut-over; negative rows, unknown
 * products/warehouses and missing costs are skipped and returned as exceptions.
 * Dry run validates and totals without writing anything.
 */
@Service
public class OpeningStockService {

    private final InventoryService inventory;
    private final StockMovementRepository movements;
    private final ProductRepository products;
    private final WarehouseRepository warehouses;
    private final AccountingService accounting;

    public OpeningStockService(InventoryService inventory, StockMovementRepository movements,
                               ProductRepository products, WarehouseRepository warehouses,
                               AccountingService accounting) {
        this.inventory = inventory; this.movements = movements;
        this.products = products; this.warehouses = warehouses; this.accounting = accounting;
    }

    public record ImportException(int line, String product, String warehouse, String qty, String reason) {}

    public record ImportResult(boolean dryRun, LocalDate cutOver, int rowsRead, int layersCreated,
                               BigDecimal totalQty, BigDecimal totalValue, List<ImportException> exceptions) {}

    private record Key(UUID productId, UUID warehouseId) {}
    private record Acc(BigDecimal qty, BigDecimal value) {}

    @Transactional
    public ImportResult importCsv(String csv, LocalDate cutOver, boolean dryRun) {
        if (!dryRun && movements.existsByType("OPENING"))
            throw new ApiException("Opening stock has already been imported");

        Map<String, Warehouse> whByName = new HashMap<>();
        warehouses.findAll().forEach(w -> whByName.put(norm(w.getName()), w));
        List<Product> allProducts = products.findAll();
        Map<UUID, Product> byId = new HashMap<>();
        allProducts.forEach(p -> byId.put(p.getId(), p));
        Map<String, List<Product>> exact = new HashMap<>();
        for (Product p : allProducts) {
            exact.computeIfAbsent(norm(p.getName()), k -> new ArrayList<>()).add(p);
            if (p.getFullName() != null && !norm(p.getFullName()).equals(norm(p.getName())))
                exact.computeIfAbsent(norm(p.getFullName()), k -> new ArrayList<>()).add(p);
        }

        List<ImportException> exceptions = new ArrayList<>();
        Map<Key, Acc> totals = new LinkedHashMap<>();
        int rowsRead = 0;
        String[] lines = csv.split("\\r?\\n");
        for (int i = 0; i < lines.length; i++) {
            String raw = lines[i];
            if (raw.isBlank()) continue;
            List<String> f = parseCsvLine(raw);
            if (i == 0 && !f.isEmpty() && norm(f.get(0)).startsWith("PRODUCT")) continue;   // header
            rowsRead++;
            int lineNo = i + 1;
            String pName = f.size() > 0 ? f.get(0).trim() : "";
            String wName = f.size() > 1 ? f.get(1).trim() : "";
            String qtyS  = f.size() > 2 ? f.get(2).trim() : "";
            String costS = f.size() > 3 ? f.get(3).trim() : "";
            String idS   = f.size() > 4 ? f.get(4).trim() : "";

            BigDecimal qty = num(qtyS);
            if (qty == null) { exceptions.add(new ImportException(lineNo, pName, wName, qtyS, "Quantity is not a number")); continue; }
            if (qty.signum() == 0) continue;
            if (qty.signum() < 0) { exceptions.add(new ImportException(lineNo, pName, wName, qtyS, "Negative stock: imported as 0, count physically")); continue; }

            Warehouse w = whByName.get(norm(wName));
            if (w == null) { exceptions.add(new ImportException(lineNo, pName, wName, qtyS, "Warehouse not found")); continue; }

            Product p;
            List<Product> hits = exact.getOrDefault(norm(pName), List.of());
            if (!idS.isEmpty()) {
                UUID id;
                try { id = UUID.fromString(idS); } catch (IllegalArgumentException e) { id = null; }
                p = id == null ? null : byId.get(id);
                if (p == null) { exceptions.add(new ImportException(lineNo, pName, wName, qtyS, "Unknown product_id " + idS)); continue; }
            }
            else if (hits.size() == 1) p = hits.get(0);
            else if (hits.size() > 1) { exceptions.add(new ImportException(lineNo, pName, wName, qtyS, "Several products have this name")); continue; }
            else {
                // the old system truncates long names: accept a unique prefix match
                String prefix = norm(pName);
                List<Product> pre = allProducts.stream()
                    .filter(x -> norm(x.getName()).startsWith(prefix)
                              || (x.getFullName() != null && norm(x.getFullName()).startsWith(prefix)))
                    .toList();
                if (pre.size() == 1) p = pre.get(0);
                else { exceptions.add(new ImportException(lineNo, pName, wName, qtyS,
                        pre.isEmpty() ? "Product not found" : "Name matches " + pre.size() + " products")); continue; }
            }

            BigDecimal cost = num(costS);
            if (cost == null || cost.signum() < 0) { exceptions.add(new ImportException(lineNo, pName, wName, qtyS, "Missing or invalid unit cost")); continue; }

            totals.merge(new Key(p.getId(), w.getId()), new Acc(qty, qty.multiply(cost)),
                (a, b) -> new Acc(a.qty().add(b.qty()), a.value().add(b.value())));
        }

        BigDecimal totalQty = BigDecimal.ZERO, totalValue = BigDecimal.ZERO;
        for (Acc a : totals.values()) { totalQty = totalQty.add(a.qty()); totalValue = totalValue.add(a.value()); }

        if (!dryRun) {
            for (var e : totals.entrySet()) {
                Acc a = e.getValue();
                BigDecimal unitCost = a.value().divide(a.qty(), 4, java.math.RoundingMode.HALF_UP);
                inventory.addLayer(e.getKey().productId(), e.getKey().warehouseId(), null,
                    a.qty(), unitCost, cutOver, cutOver, "OPENING", null);
            }
            if (totalValue.signum() > 0)
                accounting.post(cutOver, "Opening stock (imported from old system)", "OPENING_STOCK", null,
                    List.of(Leg.debit("1200", totalValue), Leg.credit("3000", totalValue)));
        } else {
            TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
        }

        return new ImportResult(dryRun, cutOver, rowsRead, totals.size(), totalQty, totalValue, exceptions);
    }

    private static String norm(String s) {
        return s == null ? "" : s.trim().replaceAll("\\s+", " ").toUpperCase(Locale.ROOT);
    }

    private static BigDecimal num(String s) {
        if (s == null || s.isBlank()) return null;
        try { return new BigDecimal(s.replace(",", "").trim()); } catch (NumberFormatException e) { return null; }
    }

    /** Minimal RFC-4180 line split: commas, "quoted, fields" and "" escapes. */
    static List<String> parseCsvLine(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (quoted) {
                if (c == '"' && i + 1 < line.length() && line.charAt(i + 1) == '"') { cur.append('"'); i++; }
                else if (c == '"') quoted = false;
                else cur.append(c);
            } else if (c == '"') quoted = true;
            else if (c == ',') { out.add(cur.toString()); cur.setLength(0); }
            else cur.append(c);
        }
        out.add(cur.toString());
        return out;
    }
}
