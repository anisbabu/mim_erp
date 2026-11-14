package com.mim.erp.master;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.util.UUID;

@Entity @Table(name = "supplier")
@Getter @Setter
public class Supplier {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String code;
    private String name;
    private String nameBn;
    private String mobile;
    private String address;
    private UUID groupId;
    private int creditDays;   // a supplier bill is due this many days after the bill date
}
