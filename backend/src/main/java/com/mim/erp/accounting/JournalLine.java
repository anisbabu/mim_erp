package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import java.math.BigDecimal;
import java.util.UUID;

@Entity @Table(name = "journal_line")
@Getter @Setter
public class JournalLine {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "journal_id")
    private JournalEntry journal;

    @Column(name = "account_id") private UUID accountId;
    private BigDecimal debit  = BigDecimal.ZERO;
    private BigDecimal credit = BigDecimal.ZERO;
    private String partyType;      // CUSTOMER | SUPPLIER when posted to a party ledger
    @Column(name = "party_id") private UUID partyId;
    private String refNo;          // document behind the entry: SO / GRN / voucher / credit note no
    private String narration;
}
