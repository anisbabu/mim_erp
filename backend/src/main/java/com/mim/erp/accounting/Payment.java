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
    private String bankAccountNo;
    private String bankBranch;
    private String note;
    private LocalDate paymentDate;
    private String voucherNo;      // RV-yyyy-nnnnnn (receipt) | PV-yyyy-nnnnnn (payment), gapless
    private BigDecimal discount = BigDecimal.ZERO;   // discount allowed (IN) / received (OUT)
    private String reference;      // party's ref: money receipt no, bill no, transaction id
    private BigDecimal ait = BigDecimal.ZERO;   // income tax deducted at source (by us OUT, by the customer IN)
    private BigDecimal vds = BigDecimal.ZERO;   // VAT deducted at source
    private String requestedBy;    // maker, when the voucher went through approval
    private String approvedBy;     // checker who released it
}
