package com.mim.erp.accounting;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

@Entity @Table(name = "petty_cash_voucher")
@Getter @Setter
public class PettyCashVoucher {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private String voucherNo;
    @Column(name = "shop_id") private UUID shopId;
    private BigDecimal amount;
    @Column(name = "expense_account_id") private UUID expenseAccountId;
    private String description;
    private LocalDate voucherDate;
}
