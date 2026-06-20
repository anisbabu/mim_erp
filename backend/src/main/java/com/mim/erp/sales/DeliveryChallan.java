package com.mim.erp.sales;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity @Table(name = "delivery_challan")
@Getter @Setter
public class DeliveryChallan {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String dcNo;
    @Column(name = "so_id")        private UUID soId;        // nullable in DC_FIRST until consolidated
    @Column(name = "shop_id")      private UUID shopId;
    @Column(name = "customer_id")  private UUID customerId;
    @Column(name = "warehouse_id") private UUID warehouseId;  // ONE warehouse per challan
    private LocalDate challanDate;
    private String status = "ISSUED";   // ISSUED | CONSOLIDATED | CANCELLED
    private String discountBy;          // audit: who authorised the discount

    @JsonIgnore
    @OneToMany(mappedBy = "dc", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<DcLine> lines = new ArrayList<>();
}
