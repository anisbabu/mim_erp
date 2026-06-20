package com.mim.erp.master;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.util.UUID;

@Entity @Table(name = "warehouse")
@Getter @Setter
public class Warehouse {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String code;
    private String name;
    private String nameBn;
    private String address;
}
