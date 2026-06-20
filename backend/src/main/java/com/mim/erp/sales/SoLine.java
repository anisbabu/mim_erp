package com.mim.erp.sales;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;
import java.util.UUID;

@Entity @Table(name = "so_line")
@Getter @Setter
public class SoLine {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "so_id")
    private SalesOrder so;

    @Column(name = "product_id") private UUID productId;
    private BigDecimal qty;
    private BigDecimal unitPrice;        // net selling price (after discount)
    private BigDecimal discountAmt = java.math.BigDecimal.ZERO;  // flat line discount amount
    private String priceOverrideBy;       // audit: who authorised out-of-band price
    private Integer lineNo;
}
