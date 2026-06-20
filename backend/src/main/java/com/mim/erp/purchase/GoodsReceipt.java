package com.mim.erp.purchase;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
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

    @JsonIgnore
    @OneToMany(mappedBy = "grn", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<GrnLine> lines = new ArrayList<>();
}
