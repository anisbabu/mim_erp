package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity @Table(name = "journal_entry")
@Getter @Setter
public class JournalEntry {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String entryNo;
    private LocalDate entryDate;
    private String narration;
    private String sourceType;   // GRN | SALES_DELIVERY | PAYMENT | RECEIPT | PETTY_CASH | ADJUSTMENT
    private UUID sourceId;

    @JsonIgnore
    @OneToMany(mappedBy = "journal", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<JournalLine> lines = new ArrayList<>();
}
