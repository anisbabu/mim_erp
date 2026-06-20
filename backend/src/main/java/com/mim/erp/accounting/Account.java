package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.util.UUID;

@Entity @Table(name = "account")
@Getter @Setter
public class Account {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String code;
    private String name;
    private String nameBn;
    private String type;   // ASSET|LIABILITY|EQUITY|INCOME|EXPENSE (nature, kept for reports)
    @Column(name = "group_id")  private java.util.UUID groupId;
    @Column(name = "party_type") private String partyType;  // SUPPLIER | CUSTOMER (subsidiary ledger)
    @Column(name = "party_id")   private java.util.UUID partyId;
    private boolean active = true;
    private boolean isSystem = false;
}
