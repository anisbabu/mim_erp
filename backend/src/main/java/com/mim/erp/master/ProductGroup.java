package com.mim.erp.master;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.util.UUID;

@Entity @Table(name = "product_group")
@Getter @Setter
public class ProductGroup {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String name;
}
