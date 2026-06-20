package com.mim.erp.accounting;

import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.UUID;

@RestController
@RequestMapping("/api/accounting")
public class CashController {

    private final CashService cash;

    public CashController(CashService cash) { this.cash = cash; }

    public record PaymentRequest(String direction, String partyType, UUID partyId,
                                 BigDecimal amount, String method, String note) {}
    public record PettyCashRequest(UUID shopId, BigDecimal amount,
                                   UUID expenseAccountId, String description) {}

    @PostMapping("/payments")
    public Payment payment(@RequestBody PaymentRequest r) {
        return cash.record(r.direction(), r.partyType(), r.partyId(), r.amount(), r.method(), r.note());
    }

    @PostMapping("/petty-cash")
    public PettyCashVoucher pettyCash(@RequestBody PettyCashRequest r) {
        return cash.pettyCash(r.shopId(), r.amount(), r.expenseAccountId(), r.description());
    }
}
