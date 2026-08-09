package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

@Entity @Table(name = "cheque_extension")
@Getter @Setter
public class ChequeExtension {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @Column(name = "cheque_id") private UUID chequeId;
    private LocalDate oldMaturityDate;
    private LocalDate newMaturityDate;
    private String requestedBy;   // who asked for the extension (customer / their rep)
    private String note;
    @Column(name = "extended_by") private UUID extendedBy;         // staff user who processed it
    @Column(name = "extended_by_name") private String extendedByName;
    @Column(insertable = false, updatable = false) private OffsetDateTime extendedAt;
}
