package com.mim.erp.accounting;

import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.auth.CurrentUserService;
import com.mim.erp.common.ApiException;
import com.mim.erp.master.CustomerRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Cheques received from customers. A cheque is tracked, not booked, until
 * it is posted:
 *   PENDING ⇄ HOLD (customer asked not to submit), maturity date changes,
 *   PENDING → CASHED (bank confirmed) → POSTED (Dr Bank / Cr customer AR),
 *   or BOUNCED at any open step. Bouncing a POSTED cheque reverses the entry.
 *   A PENDING or HOLD cheque entered wrongly can be EDITED or CANCELLED.
 * Every step is logged in cheque_event with date, who and why.
 */
@Service
public class ChequeService {

    private static final String BANK = "1010";

    private final ChequeRepository cheques;
    private final ChequeEventRepository events;
    private final CashService cash;
    private final AccountingService accounting;
    private final LedgerService ledgers;
    private final CurrentUserService currentUser;
    private final CustomerRepository customers;

    public ChequeService(ChequeRepository cheques, ChequeEventRepository events, CashService cash,
                         AccountingService accounting, LedgerService ledgers, CurrentUserService currentUser,
                         CustomerRepository customers) {
        this.cheques = cheques; this.events = events; this.cash = cash;
        this.accounting = accounting; this.ledgers = ledgers; this.currentUser = currentUser;
        this.customers = customers;
    }

    @Transactional
    public Cheque record(UUID customerId, BigDecimal amount, String chequeNo,
                         String bankName, String branchName, LocalDate maturityDate, String note) {
        validate(customerId, amount, chequeNo, maturityDate);

        Cheque c = new Cheque();
        c.setChequeNo(chequeNo.trim());
        c.setBankName(bankName);
        c.setBranchName(blankToNull(branchName));
        c.setCustomerId(customerId);
        c.setAmount(amount);
        c.setReceiveDate(LocalDate.now());
        c.setMaturityDate(maturityDate);
        c.setStatus("PENDING");
        c.setNote(note);
        cheques.save(c);
        event(c, "RECEIVED", null, null, null, note);
        return c;
    }

    /** Fix details typed wrongly. Only before the cheque goes to the bank; the diff is logged. */
    @Transactional
    public Cheque edit(UUID id, UUID customerId, BigDecimal amount, String chequeNo,
                       String bankName, String branchName, LocalDate maturityDate, String note) {
        Cheque c = get(id);
        require(c, Set.of("PENDING", "HOLD"), "Only a pending or held cheque can be edited");
        validate(customerId, amount, chequeNo, maturityDate);
        chequeNo = chequeNo.trim();
        bankName = blankToNull(bankName);
        branchName = blankToNull(branchName);
        note = blankToNull(note);

        List<String> changes = new ArrayList<>();
        if (!customerId.equals(c.getCustomerId()))
            changes.add("Customer: " + customerName(c.getCustomerId()) + " → " + customerName(customerId));
        if (amount.compareTo(c.getAmount()) != 0)
            changes.add("Amount: " + c.getAmount().stripTrailingZeros().toPlainString() + " → " + amount.stripTrailingZeros().toPlainString());
        diff(changes, "Cheque no.", c.getChequeNo(), chequeNo);
        diff(changes, "Bank", c.getBankName(), bankName);
        diff(changes, "Branch", c.getBranchName(), branchName);
        diff(changes, "Maturity", c.getMaturityDate(), maturityDate);
        diff(changes, "Note", c.getNote(), note);
        if (changes.isEmpty()) throw new ApiException("Nothing changed");

        LocalDate oldDate = c.getMaturityDate();
        boolean dateChanged = !maturityDate.equals(oldDate);
        c.setCustomerId(customerId);
        c.setAmount(amount);
        c.setChequeNo(chequeNo);
        c.setBankName(bankName);
        c.setBranchName(branchName);
        c.setMaturityDate(maturityDate);
        c.setNote(note);
        cheques.save(c);
        event(c, "EDITED", dateChanged ? oldDate : null, dateChanged ? maturityDate : null,
            null, null, String.join("; ", changes));
        return c;
    }

    /** Void a cheque entered by mistake. Nothing was posted, so nothing to reverse. */
    @Transactional
    public Cheque cancel(UUID id, String note) {
        Cheque c = get(id);
        require(c, Set.of("PENDING", "HOLD"), "Only a pending or held cheque can be cancelled");
        if (note == null || note.isBlank()) throw new ApiException("Reason is required");
        c.setStatus("CANCELLED");
        cheques.save(c);
        event(c, "CANCELLED", null, null, null, note);
        return c;
    }

    public List<Cheque> list() {
        return cheques.findAllByOrderByMaturityDateAsc();
    }

    @Transactional
    public Cheque changeDate(UUID id, LocalDate newMaturityDate, String requestedBy, String note) {
        Cheque c = get(id);
        require(c, Set.of("PENDING", "HOLD"), "Only a pending or held cheque can have its maturity date changed");
        if (newMaturityDate == null) throw new ApiException("New maturity date is required");
        if (newMaturityDate.equals(c.getMaturityDate()))
            throw new ApiException("New maturity date is the same as the current one");
        if (requestedBy == null || requestedBy.isBlank()) throw new ApiException("Requested by is required");

        LocalDate old = c.getMaturityDate();
        c.setMaturityDate(newMaturityDate);
        c.setStatus("PENDING");
        cheques.save(c);
        event(c, "DATE_CHANGED", old, newMaturityDate, requestedBy, note);
        return c;
    }

    @Transactional
    public Cheque hold(UUID id, String requestedBy, String note) {
        Cheque c = get(id);
        require(c, Set.of("PENDING"), "Only a pending cheque can be put on hold");
        if (requestedBy == null || requestedBy.isBlank()) throw new ApiException("Requested by is required");
        c.setStatus("HOLD");
        cheques.save(c);
        event(c, "HOLD", null, null, requestedBy, note);
        return c;
    }

    @Transactional
    public Cheque resume(UUID id, String note) {
        Cheque c = get(id);
        require(c, Set.of("HOLD"), "Only a held cheque can be resumed");
        c.setStatus("PENDING");
        cheques.save(c);
        event(c, "RESUMED", null, null, null, note);
        return c;
    }

    @Transactional
    public Cheque markCashed(UUID id, String note) {
        Cheque c = get(id);
        require(c, Set.of("PENDING"), "Only a pending cheque can be marked cashed");
        c.setStatus("CASHED");
        cheques.save(c);
        event(c, "CASHED", null, null, null, note);
        return c;
    }

    /** Book the receipt: Dr Bank / Cr the customer's AR ledger, through a BANK/IN payment. */
    @Transactional
    public Cheque post(UUID id, String note) {
        Cheque c = get(id);
        require(c, Set.of("CASHED"), "Only a cashed cheque can be posted");
        Payment payment = cash.record("IN", "CUSTOMER", c.getCustomerId(), c.getAmount(), "BANK",
            "Cheque " + c.getChequeNo() + (note == null || note.isBlank() ? "" : " — " + note), BANK);
        c.setPaymentId(payment.getId());
        c.setStatus("POSTED");
        cheques.save(c);
        event(c, "POSTED", null, null, null, note);
        return c;
    }

    @Transactional
    public Cheque markBounced(UUID id, String note) {
        Cheque c = get(id);
        if ("BOUNCED".equals(c.getStatus())) throw new ApiException("Cheque is already bounced");
        if ("CANCELLED".equals(c.getStatus())) throw new ApiException("A cancelled cheque cannot be bounced");

        if ("POSTED".equals(c.getStatus())) {
            // The receipt was booked — reverse it, the money never stayed in the bank.
            String arLedger = ledgers.customerLedger(c.getCustomerId()).getCode();
            accounting.post(LocalDate.now(), "Cheque bounced " + c.getChequeNo(),
                "CHEQUE_BOUNCE", c.getId(),
                List.of(Leg.debit(arLedger, c.getAmount()), Leg.credit(BANK, c.getAmount())));
        }
        c.setStatus("BOUNCED");
        cheques.save(c);
        event(c, "BOUNCED", null, null, null, note);
        return c;
    }

    public List<ChequeEvent> history(UUID chequeId) {
        return events.findByChequeIdOrderByCreatedAtDesc(chequeId);
    }

    private void event(Cheque c, String type, LocalDate oldDate, LocalDate newDate, String requestedBy, String note) {
        event(c, type, oldDate, newDate, requestedBy, note, null);
    }

    private void event(Cheque c, String type, LocalDate oldDate, LocalDate newDate, String requestedBy,
                       String note, String changes) {
        ChequeEvent e = new ChequeEvent();
        e.setChequeId(c.getId());
        e.setEventType(type);
        e.setEventDate(LocalDate.now());
        e.setOldMaturityDate(oldDate);
        e.setNewMaturityDate(newDate);
        e.setRequestedBy(requestedBy);
        e.setNote(note);
        e.setChanges(changes);
        var me = currentUser.me();
        e.setUserId(me.getId());
        e.setUserName(me.getFullName() != null && !me.getFullName().isBlank() ? me.getFullName() : me.getUsername());
        events.save(e);
    }

    private static void validate(UUID customerId, BigDecimal amount, String chequeNo, LocalDate maturityDate) {
        if (customerId == null) throw new ApiException("Customer is required");
        if (amount == null || amount.signum() <= 0) throw new ApiException("Amount must be positive");
        if (chequeNo == null || chequeNo.isBlank()) throw new ApiException("Cheque number is required");
        if (maturityDate == null) throw new ApiException("Maturity date is required");
    }

    private static void diff(List<String> changes, String label, Object oldVal, Object newVal) {
        if (!Objects.equals(oldVal, newVal))
            changes.add(label + ": " + (oldVal == null ? "—" : oldVal) + " → " + (newVal == null ? "—" : newVal));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private String customerName(UUID id) {
        return customers.findById(id).map(cu -> cu.getName()).orElse("?");
    }

    private static void require(Cheque c, Set<String> allowed, String message) {
        if (!allowed.contains(c.getStatus())) throw new ApiException(message);
    }

    private Cheque get(UUID id) {
        return cheques.findById(id).orElseThrow(() -> new ApiException("Cheque not found"));
    }
}
