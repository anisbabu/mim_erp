package com.mim.erp.master;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.util.UUID;

@Entity @Table(name = "shop")
@Getter @Setter
public class Shop {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String code;
    private String name;
    private String nameBn;
    private String primaryLine;     // BOARD | HARDWARE (primary line, not a restriction)
    private String address;
    private String mobile;
    private String location;
    private BigDecimal monthlyTarget;
    private BigDecimal pettyCashFloat;
}
