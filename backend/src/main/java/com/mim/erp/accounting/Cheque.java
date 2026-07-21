package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

@Entity @Table(name = "cheque")
@Getter @Setter
public class Cheque {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @Column(name = "payment_id") private UUID paymentId;
    private String chequeNo;
    private String bankName;
    @Column(name = "customer_id") private UUID customerId;
    private BigDecimal amount;
    private LocalDate receiveDate;
    private LocalDate maturityDate;
    private String status;         // PENDING | CLEARED | BOUNCED
    private String note;
    @Column(insertable = false, updatable = false) private OffsetDateTime createdAt;
}
