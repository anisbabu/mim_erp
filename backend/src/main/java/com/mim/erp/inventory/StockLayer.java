package com.mim.erp.inventory;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A FIFO cost layer. One per goods-receipt line.
 * Quantity is logically merged per (product, warehouse) by SUMMING qtyRemaining,
 * but each layer keeps its own unitCost + receivedDate for FIFO costing and the
 * price-variance report.
 */
@Entity @Table(name = "stock_layer")
@Getter @Setter
public class StockLayer {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "product_id")   private UUID productId;
    @Column(name = "warehouse_id") private UUID warehouseId;
    @Column(name = "grn_line_id")  private UUID grnLineId;

    private BigDecimal unitCost;
    private BigDecimal qtyReceived;
    private BigDecimal qtyRemaining;
    private LocalDate  receivedDate;

    @Column(insertable = false, updatable = false)
    private Long seq;   // DB-assigned FIFO tie-breaker
}
