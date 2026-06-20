package com.mim.erp.inventory;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

@Entity @Table(name = "stock_adjustment")
@Getter @Setter
public class StockAdjustment {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String adjNo;
    private String type;            // DAMAGE | COUNT | TRANSFER
    @Column(name = "product_id")        private UUID productId;
    @Column(name = "from_warehouse_id") private UUID fromWarehouseId;
    @Column(name = "to_warehouse_id")   private UUID toWarehouseId;
    private BigDecimal qty;
    private String reason;
    private LocalDate adjDate;
}
