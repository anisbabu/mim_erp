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
    private String branchName;
    @Column(name = "customer_id") private UUID customerId;
    private BigDecimal amount;
    private LocalDate receiveDate;
    private LocalDate maturityDate;
    private String status;         // PENDING | HOLD | CASHED | POSTED | BOUNCED | CANCELLED
    private String depositAccount; // bank ledger code it was posted to
    private String note;
    private LocalDate reminderForDate;   // maturity date the last WhatsApp reminder was made for
    private OffsetDateTime reminderSentAt;
    private String reminderStatus;       // SENT | FAILED | SKIPPED
    private String reminderError;
    @Column(insertable = false, updatable = false) private OffsetDateTime createdAt;
    private BigDecimal bounceCharge = BigDecimal.ZERO;   // bank fee for the returned cheque
    private boolean bounceChargeToCustomer;            // recovered from the customer, else Bank Charges 5600
}
