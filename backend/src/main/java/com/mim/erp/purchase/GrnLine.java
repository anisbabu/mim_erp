package com.mim.erp.purchase;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;
import java.util.UUID;

@Entity @Table(name = "grn_line")
@Getter @Setter
public class GrnLine {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "grn_id")
    private GoodsReceipt grn;

    @Column(name = "po_line_id") private UUID poLineId;
    @Column(name = "received_product_id") private UUID receivedProductId;  // what actually arrived
    private BigDecimal qtyReceived;
}
