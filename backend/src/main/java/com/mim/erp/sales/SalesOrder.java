package com.mim.erp.sales;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity @Table(name = "sales_order")
@Getter @Setter
public class SalesOrder {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String soNo;
    @Column(name = "shop_id")     private UUID shopId;
    @Column(name = "customer_id") private UUID customerId;
    private String workflow;       // SO_FIRST | DC_FIRST
    private String paymentMode;     // CASH | CREDIT
    private String status = "DRAFT";
    private LocalDate orderDate;
    private String creditOverrideBy;  // audit: who authorised an over-limit credit sale
    private String discountBy;        // audit: who authorised the discount

    @JsonIgnore
    @OneToMany(mappedBy = "so", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<SoLine> lines = new ArrayList<>();
}
