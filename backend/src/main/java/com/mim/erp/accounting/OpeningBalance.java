package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.util.UUID;

@Entity @Table(name = "opening_balance")
@Getter @Setter
public class OpeningBalance {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    @Column(name = "financial_year_id") private UUID financialYearId;
    @Column(name = "account_id") private UUID accountId;
    private BigDecimal debit = BigDecimal.ZERO;
    private BigDecimal credit = BigDecimal.ZERO;
}
