package com.mim.erp.purchase;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity @Table(name = "goods_receipt")
@Getter @Setter
public class GoodsReceipt {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String grnNo;
    @Column(name = "po_id")        private UUID poId;
    @Column(name = "warehouse_id") private UUID warehouseId;   // chosen at receipt time
    private LocalDate receiptDate;
    // the supplier's invoice
    private String billNo;
    private LocalDate billDate;
    private LocalDate dueDate;
    private BigDecimal goodsValue = BigDecimal.ZERO;
    private BigDecimal freight = BigDecimal.ZERO;
    private boolean freightOnBill = true;      // false = freight paid to a carrier in cash
    private String priceApprovedBy;            // who approved a billed price that differs from the PO
    private BigDecimal vat = BigDecimal.ZERO;   // input VAT on the supplier VAT invoice, inside goodsValue

    @JsonIgnore
    @OneToMany(mappedBy = "grn", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<GrnLine> lines = new ArrayList<>();
}
