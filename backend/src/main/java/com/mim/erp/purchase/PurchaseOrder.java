package com.mim.erp.purchase;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity @Table(name = "purchase_order")
@Getter @Setter
public class PurchaseOrder {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String poNo;
    @Column(name = "supplier_id") private UUID supplierId;
    private LocalDate orderDate;
    private String status = "OPEN";   // OPEN | CLOSED | CANCELLED
    private String note;

    @JsonIgnore
    @OneToMany(mappedBy = "po", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<PoLine> lines = new ArrayList<>();
}
