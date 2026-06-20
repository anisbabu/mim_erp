package com.mim.erp.master;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.util.UUID;

@Entity @Table(name = "customer")
@Getter @Setter
public class Customer {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String code;
    private String name;
    private String nameBn;
    private String type;            // INDIVIDUAL | PARTY
    private String mobile;
    private String address;
    private BigDecimal creditLimit; // PARTY only
    private Integer creditDays;     // PARTY only

    // delivery address details — helps the driver find the drop-off
    private String deliveryAddress;
    private String deliveryLandmark;
    private String deliveryContactName;
    private String deliveryContactPhone;
    private String deliveryNote;
    private String deliveryMapLink;
}
