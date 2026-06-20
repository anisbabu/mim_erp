package com.mim.erp.sales;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;
import java.util.UUID;

/** Each challan line consumes one FIFO layer, capturing cost + selling price for margin. */
@Entity @Table(name = "dc_line")
@Getter @Setter
public class DcLine {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "dc_id")
    private DeliveryChallan dc;

    @Column(name = "product_id")     private UUID productId;
    @Column(name = "stock_layer_id") private UUID stockLayerId;
    private BigDecimal qty;
    private BigDecimal unitCost;       // from FIFO layer
    private BigDecimal unitPrice;      // net selling price (after discount)
    private BigDecimal discountAmt = java.math.BigDecimal.ZERO;  // flat line discount amount
}
