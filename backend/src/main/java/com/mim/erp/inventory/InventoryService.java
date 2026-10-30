package com.mim.erp.inventory;

import com.mim.erp.common.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class InventoryService {

    private final StockLayerRepository layers;
    private final StockMovementRepository movements;

    public InventoryService(StockLayerRepository layers, StockMovementRepository movements) {
        this.layers = layers;
        this.movements = movements;
    }

    /**
     * Create a cost layer (goods receipt, opening stock, transfer-in) and record the
     * inward movement. layerDate drives FIFO order; moveDate is when the stock
     * actually arrived here (differs for transfers, which keep the original layer date).
     */
    @Transactional
    public StockLayer addLayer(UUID productId, UUID warehouseId, UUID grnLineId,
                               BigDecimal qty, BigDecimal unitCost, LocalDate layerDate,
                               LocalDate moveDate, String moveType, UUID refId) {
        StockLayer l = new StockLayer();
        l.setProductId(productId);
        l.setWarehouseId(warehouseId);
        l.setGrnLineId(grnLineId);
        l.setUnitCost(unitCost);
        l.setQtyReceived(qty);
        l.setQtyRemaining(qty);
        l.setReceivedDate(layerDate);
        StockLayer saved = layers.save(l);
        record(moveDate, productId, warehouseId, qty, unitCost, moveType, refId, saved.getId());
        return saved;
    }

    public BigDecimal available(UUID productId, UUID warehouseId) {
        return layers.availableQty(productId, warehouseId);
    }

    /**
     * Consume `qty` of a product from ONE warehouse using FIFO and record one
     * outward movement per layer touched.
     * Returns the per-layer allocations (layer id, qty taken, that layer's cost)
     * so the caller can build delivery-challan lines and COGS postings.
     * Throws if the warehouse doesn't hold enough.
     */
    @Transactional
    public List<Consumption> consumeFifo(UUID productId, UUID warehouseId, BigDecimal qty,
                                         String moveType, UUID refId) {
        if (qty == null || qty.signum() <= 0)
            throw new ApiException("Quantity to consume must be positive");

        List<StockLayer> open = layers.findOpenLayersForUpdate(productId, warehouseId);
        List<Consumption> result = new ArrayList<>();
        BigDecimal remaining = qty;

        for (StockLayer layer : open) {
            if (remaining.signum() == 0) break;
            BigDecimal take = layer.getQtyRemaining().min(remaining);
            layer.setQtyRemaining(layer.getQtyRemaining().subtract(take));
            result.add(new Consumption(layer.getId(), take, layer.getUnitCost(), layer.getReceivedDate()));
            remaining = remaining.subtract(take);
        }

        if (remaining.signum() > 0)
            throw new ApiException("Insufficient stock in warehouse: short by " + remaining);

        layers.saveAll(open);
        LocalDate today = LocalDate.now();
        for (Consumption c : result)
            record(today, productId, warehouseId, c.qty().negate(), c.unitCost(), moveType, refId, c.stockLayerId());
        return result;
    }

    private void record(LocalDate date, UUID productId, UUID warehouseId, BigDecimal signedQty,
                        BigDecimal unitCost, String type, UUID refId, UUID layerId) {
        StockMovement m = new StockMovement();
        m.setMoveDate(date);
        m.setProductId(productId);
        m.setWarehouseId(warehouseId);
        m.setQty(signedQty);
        m.setUnitCost(unitCost);
        m.setType(type);
        m.setRefId(refId);
        m.setStockLayerId(layerId);
        movements.save(m);
    }

    /** One FIFO allocation: how much came from which layer, at what cost and date. */
    public record Consumption(UUID stockLayerId, BigDecimal qty, BigDecimal unitCost, java.time.LocalDate receivedDate) {
        public BigDecimal cost() { return qty.multiply(unitCost); }
    }
}
