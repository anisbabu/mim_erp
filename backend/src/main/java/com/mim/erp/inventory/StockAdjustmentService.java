package com.mim.erp.inventory;

import com.mim.erp.accounting.AccountingService;
import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Stock adjustments:
 *   DAMAGE   — write off qty from a warehouse at FIFO cost: Dr Inventory Loss / Cr Inventory
 *   COUNT    — shrinkage correction (decrease), posted like DAMAGE
 *   TRANSFER — move qty between warehouses at the SAME cost layers (no P&L impact)
 */
@Service
public class StockAdjustmentService {

    private final StockAdjustmentRepository repo;
    private final InventoryService inventory;
    private final AccountingService accounting;
    private final DocNumberService docNo;

    public StockAdjustmentService(StockAdjustmentRepository repo, InventoryService inventory,
                                  AccountingService accounting, DocNumberService docNo) {
        this.repo = repo; this.inventory = inventory;
        this.accounting = accounting; this.docNo = docNo;
    }

    @Transactional
    public StockAdjustment adjust(String type, UUID productId, UUID fromWarehouseId,
                                  UUID toWarehouseId, BigDecimal qty, String reason) {
        if (qty == null || qty.signum() <= 0)
            throw new ApiException("Adjustment quantity must be positive");

        StockAdjustment adj = new StockAdjustment();
        adj.setAdjNo(docNo.next("ADJ"));
        adj.setType(type);
        adj.setProductId(productId);
        adj.setFromWarehouseId(fromWarehouseId);
        adj.setToWarehouseId(toWarehouseId);
        adj.setQty(qty);
        adj.setReason(reason);
        adj.setAdjDate(LocalDate.now());

        switch (type) {
            case "DAMAGE", "COUNT" -> {
                if (fromWarehouseId == null)
                    throw new ApiException("Select the warehouse to adjust from");
                var consumed = inventory.consumeFifo(productId, fromWarehouseId, qty);
                BigDecimal cost = consumed.stream().map(c -> c.cost())
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
                accounting.post(adj.getAdjDate(),
                    type + " write-off " + adj.getAdjNo(), "ADJUSTMENT", adj.getId(),
                    List.of(Leg.debit("5100", cost), Leg.credit("1200", cost)));
            }
            case "TRANSFER" -> {
                if (fromWarehouseId == null || toWarehouseId == null)
                    throw new ApiException("Transfer needs both source and destination warehouses");
                if (fromWarehouseId.equals(toWarehouseId))
                    throw new ApiException("Source and destination warehouses must differ");
                // consume from source, recreate layers in destination at same cost+date
                var consumed = inventory.consumeFifo(productId, fromWarehouseId, qty);
                for (var c : consumed) {
                    inventory.addLayer(productId, toWarehouseId, null,
                        c.qty(), c.unitCost(), c.receivedDate());
                }
                // no journal entry: inventory value unchanged, just relocated
            }
            default -> throw new ApiException("Unknown adjustment type: " + type);
        }
        return repo.save(adj);
    }
}
