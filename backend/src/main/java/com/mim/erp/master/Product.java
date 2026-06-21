package com.mim.erp.master;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.util.UUID;

@Entity @Table(name = "product")
@Getter @Setter
public class Product {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String sku;
    private String name;
    private String nameBn;
    private String type;            // BOARD | HARDWARE
    private BigDecimal thicknessMm; // null for hardware
    private String unit;
    private BigDecimal priceLower;  // selling price band (fixed, management-set)
    private BigDecimal priceUpper;
    private BigDecimal taxRate;     // nullable: tax-aware, inactive
    @Column(name = "supplier_id") private UUID supplierId;
    private String category;
    private String color;
    private String fullName;
    private boolean active = true;
}
