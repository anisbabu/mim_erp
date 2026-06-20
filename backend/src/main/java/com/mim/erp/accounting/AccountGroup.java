package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.util.UUID;

@Entity @Table(name = "account_group")
@Getter @Setter
public class AccountGroup {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String code;
    private String name;
    private String nameBn;
    private String nature;     // ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
    @Column(name = "parent_id") private UUID parentId;
    private boolean isSystem = false;
}
