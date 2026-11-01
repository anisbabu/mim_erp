package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

/** One dated step in a cheque's life — received, held, date changed, cashed, posted, bounced. */
@Entity @Table(name = "cheque_event")
@Getter @Setter
public class ChequeEvent {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @Column(name = "cheque_id") private UUID chequeId;
    private String eventType;     // RECEIVED | DATE_CHANGED | HOLD | RESUMED | CASHED | POSTED | BOUNCED | EDITED | CANCELLED | RESUBMITTED
    private LocalDate eventDate;
    private LocalDate oldMaturityDate;
    private LocalDate newMaturityDate;
    private String requestedBy;   // who asked (customer / their rep), for HOLD and DATE_CHANGED
    private String note;
    private String changes;       // EDITED: readable old → new diff
    private String reason;        // BOUNCED: INSUFFICIENT_FUNDS | SIGNATURE_MISMATCH | OTHER
    @Column(name = "user_id") private UUID userId;     // staff user who recorded the step
    @Column(name = "user_name") private String userName;
    @Column(insertable = false, updatable = false) private OffsetDateTime createdAt;
}
