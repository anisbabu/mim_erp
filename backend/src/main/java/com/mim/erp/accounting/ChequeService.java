package com.mim.erp.accounting;

import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.auth.CurrentUserService;
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
    private final ChequeExtensionRepository extensions;
    private final CashService cash;
    private final AccountingService accounting;
    private final LedgerService ledgers;
    private final CurrentUserService currentUser;

    public ChequeService(ChequeRepository cheques, ChequeExtensionRepository extensions, CashService cash,
                         AccountingService accounting, LedgerService ledgers, CurrentUserService currentUser) {
        this.cheques = cheques; this.extensions = extensions; this.cash = cash;
        this.accounting = accounting; this.ledgers = ledgers; this.currentUser = currentUser;
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

    private static boolean isOpen(String status) {
        return "PENDING".equals(status) || "EXTENDED".equals(status);
    }

    @Transactional
    public Cheque markCleared(UUID id) {
        Cheque c = get(id);
        if (!isOpen(c.getStatus())) throw new ApiException("Only a pending cheque can be cleared");
        c.setStatus("CLEARED");
        return cheques.save(c);
    }

    @Transactional
    public Cheque markBounced(UUID id) {
        Cheque c = get(id);
        if (!isOpen(c.getStatus())) throw new ApiException("Only a pending cheque can be bounced");
        c.setStatus("BOUNCED");
        cheques.save(c);

        // Reverse the original receipt — the cash never actually landed.
        String arLedger = ledgers.customerLedger(c.getCustomerId()).getCode();
        accounting.post(LocalDate.now(), "Cheque bounced " + c.getChequeNo(),
            "CHEQUE_BOUNCE", c.getId(),
            List.of(Leg.debit(arLedger, c.getAmount()), Leg.credit("1000", c.getAmount())));
        return c;
    }

    @Transactional
    public Cheque extendMaturity(UUID id, LocalDate newMaturityDate, String requestedBy, String note) {
        Cheque c = get(id);
        if (!isOpen(c.getStatus())) throw new ApiException("Only a pending cheque can have its maturity extended");
        if (newMaturityDate == null) throw new ApiException("New maturity date is required");
        if (!newMaturityDate.isAfter(c.getMaturityDate()))
            throw new ApiException("New maturity date must be after the current maturity date");
        if (requestedBy == null || requestedBy.isBlank())
            throw new ApiException("Requested by is required");

        ChequeExtension ext = new ChequeExtension();
        ext.setChequeId(c.getId());
        ext.setOldMaturityDate(c.getMaturityDate());
        ext.setNewMaturityDate(newMaturityDate);
        ext.setRequestedBy(requestedBy);
        ext.setNote(note);
        var me = currentUser.me();
        ext.setExtendedBy(me.getId());
        ext.setExtendedByName(me.getFullName() != null && !me.getFullName().isBlank() ? me.getFullName() : me.getUsername());
        extensions.save(ext);

        c.setMaturityDate(newMaturityDate);
        c.setStatus("EXTENDED");
        return cheques.save(c);
    }

    public List<ChequeExtension> extensionHistory(UUID chequeId) {
        return extensions.findByChequeIdOrderByExtendedAtDesc(chequeId);
    }

    private Cheque get(UUID id) {
        return cheques.findById(id).orElseThrow(() -> new ApiException("Cheque not found"));
    }
}
