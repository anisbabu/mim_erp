package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

@Entity @Table(name = "payment")
@Getter @Setter
public class Payment {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String paymentNo;
    private String direction;     // OUT (pay supplier) | IN (receive from customer)
    private String partyType;      // SUPPLIER | CUSTOMER
    @Column(name = "party_id") private UUID partyId;
    private BigDecimal amount;
    private String method;         // CASH | BANK
    private String note;
    private LocalDate paymentDate;
}
