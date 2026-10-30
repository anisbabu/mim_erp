package com.mim.erp.inventory;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * One stock change (append-only). qty is signed: + in, - out.
 * Feeds the opening / inward / outward / closing stock summary.
 */
@Entity @Table(name = "stock_movement")
@Getter @Setter
public class StockMovement {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private LocalDate moveDate;
    @Column(name = "product_id")     private UUID productId;
    @Column(name = "warehouse_id")   private UUID warehouseId;
    private BigDecimal qty;
    private BigDecimal unitCost;
    private String type;            // OPENING | GRN | SALE | DAMAGE | COUNT | TRANSFER_IN | TRANSFER_OUT
    @Column(name = "ref_id")         private UUID refId;
    @Column(name = "stock_layer_id") private UUID stockLayerId;
}
