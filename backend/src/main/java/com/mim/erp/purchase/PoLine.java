package com.mim.erp.purchase;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;
import java.util.UUID;

@Entity @Table(name = "po_line")
@Getter @Setter
public class PoLine {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "po_id")
    private PurchaseOrder po;

    @Column(name = "product_id") private UUID productId;
    private BigDecimal qtyOrdered;
    private BigDecimal qtyBalance;   // starts = qtyOrdered, decremented per receipt
    private BigDecimal unitPrice;    // locked PO price (0 for a free line)
    private boolean freeProduct;     // free/complimentary: qty counts, no price
    private Integer lineNo;
}
