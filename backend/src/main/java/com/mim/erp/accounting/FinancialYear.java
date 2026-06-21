package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDate;
import java.util.UUID;

@Entity @Table(name = "financial_year")
@Getter @Setter
public class FinancialYear {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String name;
    private LocalDate startDate;
    private LocalDate endDate;
    private String status = "OPEN";   // OPEN | CLOSED
    private boolean isCurrent = false;
}
