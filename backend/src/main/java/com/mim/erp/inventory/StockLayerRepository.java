package com.mim.erp.inventory;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public interface StockLayerRepository extends JpaRepository<StockLayer, UUID> {

    /**
     * Open layers for a product in a warehouse, oldest first (FIFO order).
     * Pessimistic write-lock so two concurrent sales can't double-consume a layer.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        select l from StockLayer l
        where l.productId = :productId and l.warehouseId = :warehouseId
          and l.qtyRemaining > 0
        order by l.receivedDate asc, l.seq asc
    """)
    List<StockLayer> findOpenLayersForUpdate(@Param("productId") UUID productId,
                                             @Param("warehouseId") UUID warehouseId);

    /** Available quantity of a product in one warehouse. */
    @Query("""
        select coalesce(sum(l.qtyRemaining),0) from StockLayer l
        where l.productId = :productId and l.warehouseId = :warehouseId
    """)
    BigDecimal availableQty(@Param("productId") UUID productId,
                            @Param("warehouseId") UUID warehouseId);

    /** Per-warehouse availability for a product (drives the sales screen). */
    @Query("""
        select l.warehouseId as warehouseId, sum(l.qtyRemaining) as qty
        from StockLayer l
        where l.productId = :productId and l.qtyRemaining > 0
        group by l.warehouseId
    """)
    List<WarehouseStock> availabilityByWarehouse(@Param("productId") UUID productId);

    interface WarehouseStock {
        UUID getWarehouseId();
        BigDecimal getQty();
    }

    /** Whole-company stock overview: qty + value per (product, warehouse). */
    @Query("""
        select l.productId as productId, l.warehouseId as warehouseId,
               sum(l.qtyRemaining) as qty,
               sum(l.qtyRemaining * l.unitCost) as value
        from StockLayer l
        where l.qtyRemaining > 0
        group by l.productId, l.warehouseId
    """)
    List<StockRow> stockOverview();

    interface StockRow {
        UUID getProductId();
        UUID getWarehouseId();
        BigDecimal getQty();
        BigDecimal getValue();
    }

    /** Price-variance source: cost spread per (product, warehouse). */
    @Query("""
        select l.productId as productId, l.warehouseId as warehouseId,
               min(l.unitCost) as minCost, max(l.unitCost) as maxCost,
               avg(l.unitCost) as avgCost,
               sum(l.qtyRemaining) as qtyOnHand
        from StockLayer l
        where l.qtyRemaining > 0
        group by l.productId, l.warehouseId
    """)
    List<VarianceRow> varianceByWarehouse();

    /** Price-variance source: cost spread per product across the whole company. */
    @Query("""
        select l.productId as productId, null as warehouseId,
               min(l.unitCost) as minCost, max(l.unitCost) as maxCost,
               avg(l.unitCost) as avgCost,
               sum(l.qtyRemaining) as qtyOnHand
        from StockLayer l
        where l.qtyRemaining > 0
        group by l.productId
    """)
    List<VarianceRow> varianceCompanyWide();

    /** Stock on hand grouped by supplier + product (joins across purchase module). */
    @Query(value = """
        SELECT po.supplier_id AS supplierId, sl.product_id AS productId,
               SUM(sl.qty_remaining) AS qty, SUM(sl.qty_remaining * sl.unit_cost) AS value
        FROM stock_layer sl
        JOIN grn_line gl ON gl.id = sl.grn_line_id
        JOIN goods_receipt gr ON gr.id = gl.grn_id
        JOIN purchase_order po ON po.id = gr.po_id
        WHERE sl.qty_remaining > 0
        GROUP BY po.supplier_id, sl.product_id
        ORDER BY po.supplier_id, sl.product_id
    """, nativeQuery = true)
    List<SupplierStockRow> stockBySupplier();

    interface SupplierStockRow {
        UUID getSupplierId();
        UUID getProductId();
        BigDecimal getQty();
        BigDecimal getValue();
    }

    interface VarianceRow {
        UUID getProductId();
        UUID getWarehouseId();
        BigDecimal getMinCost();
        BigDecimal getMaxCost();
        BigDecimal getAvgCost();
        BigDecimal getQtyOnHand();
    }
}
