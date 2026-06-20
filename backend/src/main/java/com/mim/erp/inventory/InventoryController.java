package com.mim.erp.inventory;

import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/inventory")
public class InventoryController {

    private final StockLayerRepository layers;

    public InventoryController(StockLayerRepository layers) { this.layers = layers; }

    /** Per-warehouse availability for a product — drives the sales-order stock picker. */
    @GetMapping("/availability")
    public List<StockLayerRepository.WarehouseStock> availability(@RequestParam UUID productId) {
        return layers.availabilityByWarehouse(productId);
    }

    /** Available qty of a product in a specific warehouse. */
    @GetMapping("/available")
    public BigDecimal available(@RequestParam UUID productId, @RequestParam UUID warehouseId) {
        return layers.availableQty(productId, warehouseId);
    }

    /** Whole-company stock overview (qty + value per product/warehouse). */
    @GetMapping("/overview")
    public List<StockLayerRepository.StockRow> overview() {
        return layers.stockOverview();
    }

    /**
     * Price-variance report. scope=warehouse (default) breaks down per warehouse;
     * scope=company rolls up per product across all warehouses.
     */
    @GetMapping("/price-variance")
    public List<StockLayerRepository.VarianceRow> priceVariance(
            @RequestParam(defaultValue = "warehouse") String scope) {
        return "company".equals(scope)
            ? layers.varianceCompanyWide()
            : layers.varianceByWarehouse();
    }
}
