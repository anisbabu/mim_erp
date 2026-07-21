package com.mim.erp.accounting;

import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.common.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Cheques received from customers. Recording a cheque books the usual
 * BANK/IN payment (Dr Cash / Cr AR) via CashService, then keeps the
 * physical-cheque details (number, bank, maturity) alongside it so the
 * office can watch for cheques coming due. A bounce reverses the receipt.
 */
@Service
public class ChequeService {

    private final ChequeRepository cheques;
    private final CashService cash;
    private final AccountingService accounting;
    private final LedgerService ledgers;

    public ChequeService(ChequeRepository cheques, CashService cash,
                         AccountingService accounting, LedgerService ledgers) {
        this.cheques = cheques; this.cash = cash;
        this.accounting = accounting; this.ledgers = ledgers;
    }

    @Transactional
    public Cheque record(UUID customerId, BigDecimal amount, String chequeNo,
                         String bankName, LocalDate maturityDate, String note) {
        if (customerId == null) throw new ApiException("Customer is required");
        if (chequeNo == null || chequeNo.isBlank()) throw new ApiException("Cheque number is required");
        if (maturityDate == null) throw new ApiException("Maturity date is required");

        Payment payment = cash.record("IN", "CUSTOMER", customerId, amount, "BANK", note);

        Cheque c = new Cheque();
        c.setPaymentId(payment.getId());
        c.setChequeNo(chequeNo);
        c.setBankName(bankName);
        c.setCustomerId(customerId);
        c.setAmount(amount);
        c.setReceiveDate(payment.getPaymentDate());
        c.setMaturityDate(maturityDate);
        c.setStatus("PENDING");
        c.setNote(note);
        return cheques.save(c);
    }

    public List<Cheque> list() {
        return cheques.findAllByOrderByMaturityDateAsc();
    }

    @Transactional
    public Cheque markCleared(UUID id) {
        Cheque c = get(id);
        if (!"PENDING".equals(c.getStatus())) throw new ApiException("Only a pending cheque can be cleared");
        c.setStatus("CLEARED");
        return cheques.save(c);
    }

    @Transactional
    public Cheque markBounced(UUID id) {
        Cheque c = get(id);
        if (!"PENDING".equals(c.getStatus())) throw new ApiException("Only a pending cheque can be bounced");
        c.setStatus("BOUNCED");
        cheques.save(c);

        // Reverse the original receipt — the cash never actually landed.
        String arLedger = ledgers.customerLedger(c.getCustomerId()).getCode();
        accounting.post(LocalDate.now(), "Cheque bounced " + c.getChequeNo(),
            "CHEQUE_BOUNCE", c.getId(),
            List.of(Leg.debit(arLedger, c.getAmount()), Leg.credit("1000", c.getAmount())));
        return c;
    }

    private Cheque get(UUID id) {
        return cheques.findById(id).orElseThrow(() -> new ApiException("Cheque not found"));
    }
}
