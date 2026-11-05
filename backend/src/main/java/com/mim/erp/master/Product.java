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
    private String thicknessLabel;  // display text when a number can't express it (2/3, 19X1)
    private String unit;
    private BigDecimal priceLower;  // selling price band (fixed, management-set)
    private BigDecimal priceUpper;
    private BigDecimal taxRate;     // nullable: tax-aware, inactive
    @Column(name = "supplier_id") private UUID supplierId;
    private String category;
    @Column(name = "product_group_id") private UUID productGroupId;   // FK to product_group
    /** Read-only group name for lists, search and reports; change the group through productGroupId. */
    @org.hibernate.annotations.Formula("(select g.name from product_group g where g.id = product_group_id)")
    private String productGroup;
    private String supplierTag;     // supplier/brand as written in the old system, e.g. AHMED, CHINA
    private String edgingSize;      // set instead of thicknessMm when category is EDGING
    private String color;
    private String side;            // O/S | B/S (one side / both side lamination)
    private String fullName;
    private String comments;
    private boolean active = true;
    @Column(name = "created_at", insertable = false, updatable = false)
    private java.time.OffsetDateTime createdAt;
}
