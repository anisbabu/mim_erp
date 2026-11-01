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
 *   A BOUNCED cheque can be RESUBMITTED (back to PENDING) when the customer says so.
 * Every step is logged in cheque_event with date, who and why.
 */
@Service
public class ChequeService {

    private static final String BANK = "1010";
    private static final Set<String> BOUNCE_REASONS = Set.of("INSUFFICIENT_FUNDS", "SIGNATURE_MISMATCH", "OTHER");

    private final ChequeRepository cheques;
    private final ChequeEventRepository events;
    private final CashService cash;
    private final AccountingService accounting;
    private final LedgerService ledgers;
    private final CurrentUserService currentUser;
    private final CustomerRepository customers;
    private final AccountRepository accounts;
    private final AccountGroupRepository groups;

    public ChequeService(ChequeRepository cheques, ChequeEventRepository events, CashService cash,
                         AccountingService accounting, LedgerService ledgers, CurrentUserService currentUser,
                         CustomerRepository customers, AccountRepository accounts, AccountGroupRepository groups) {
        this.cheques = cheques; this.events = events; this.cash = cash;
        this.accounting = accounting; this.ledgers = ledgers; this.currentUser = currentUser;
        this.customers = customers; this.accounts = accounts; this.groups = groups;
    }

    @Transactional
    public Cheque record(UUID customerId, BigDecimal amount, String chequeNo,
                         String bankName, String branchName, LocalDate maturityDate, String note) {
        validate(customerId, amount, chequeNo, maturityDate);
        rejectDuplicate(null, chequeNo, bankName);

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
        rejectDuplicate(id, chequeNo, bankName);
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

    /** Book the receipt: Dr the chosen bank ledger / Cr the customer's AR ledger, through a BANK/IN payment. */
    @Transactional
    public Cheque post(UUID id, String depositAccount, String note) {
        Cheque c = get(id);
        require(c, Set.of("CASHED"), "Only a cashed cheque can be posted");
        List<Account> banks = bankAccounts();   // default deposit bank first
        String bank = depositAccount == null || depositAccount.isBlank()
            ? (banks.isEmpty() ? BANK : banks.get(0).getCode()) : depositAccount.trim();
        if (banks.stream().noneMatch(a -> a.getCode().equals(bank)))
            throw new ApiException("Pick a bank account to deposit into");
        Payment payment = cash.record("IN", "CUSTOMER", c.getCustomerId(), c.getAmount(), "BANK",
            "Cheque " + c.getChequeNo() + (note == null || note.isBlank() ? "" : " — " + note), bank);
        c.setPaymentId(payment.getId());
        c.setDepositAccount(bank);
        c.setStatus("POSTED");
        cheques.save(c);
        event(c, "POSTED", null, null, null, note);
        return c;
    }

    @Transactional
    public Cheque markBounced(UUID id, String reason, String note) {
        Cheque c = get(id);
        if (reason == null || !BOUNCE_REASONS.contains(reason)) throw new ApiException("Pick a bounce reason");
        if ("OTHER".equals(reason) && (note == null || note.isBlank()))
            throw new ApiException("Describe the reason when it is Other");
        if ("BOUNCED".equals(c.getStatus())) throw new ApiException("Cheque is already bounced");
        if ("CANCELLED".equals(c.getStatus())) throw new ApiException("A cancelled cheque cannot be bounced");

        if ("POSTED".equals(c.getStatus())) {
            // The receipt was booked — reverse it, the money never stayed in the bank.
            String arLedger = ledgers.customerLedger(c.getCustomerId()).getCode();
            accounting.post(LocalDate.now(), "Cheque bounced " + c.getChequeNo(),
                "CHEQUE_BOUNCE", c.getId(),
                List.of(Leg.debit(arLedger, c.getAmount()),
                        Leg.credit(c.getDepositAccount() == null ? BANK : c.getDepositAccount(), c.getAmount())));
        }
        c.setStatus("BOUNCED");
        cheques.save(c);
        event(c, "BOUNCED", null, null, null, note, null, reason);
        return c;
    }

    /** Customer asked to present a bounced cheque again — it goes back to PENDING with a new maturity date. */
    @Transactional
    public Cheque resubmit(UUID id, LocalDate newMaturityDate, String note) {
        Cheque c = get(id);
        require(c, Set.of("BOUNCED"), "Only a bounced cheque can be submitted again");
        if (newMaturityDate == null) throw new ApiException("New maturity date is required");
        LocalDate old = c.getMaturityDate();
        c.setMaturityDate(newMaturityDate);
        c.setStatus("PENDING");
        c.setPaymentId(null);
        c.setDepositAccount(null);
        cheques.save(c);
        event(c, "RESUBMITTED", old, newMaturityDate, null, note);
        return c;
    }

    /** Ledgers under the Bank Accounts head — where a cheque can be deposited. Default deposit bank first. */
    public List<Account> bankAccounts() {
        List<Account> list = groups.findByCode("A-BK")
            .map(g -> accounts.findByGroupIdAndActiveTrueOrderByCode(g.getId()))
            .orElseGet(() -> accounts.findByCode(BANK).map(List::of).orElse(List.of()));
        return list.stream()
            .sorted(java.util.Comparator.comparing((Account a) -> !a.isDefaultDeposit()))
            .toList();
    }

    public BigDecimal customerBalance(UUID customerId) {
        return ledgers.customerBalance(customerId);
    }

    public byte[] receiptPdf(UUID id, boolean bn) {
        Cheque c = get(id);
        return ChequeReceiptPdf.render(c, customers.findById(c.getCustomerId()).orElse(null), bn);
    }

    public List<ChequeEvent> history(UUID chequeId) {
        return events.findByChequeIdOrderByCreatedAtDesc(chequeId);
    }

    private void event(Cheque c, String type, LocalDate oldDate, LocalDate newDate, String requestedBy, String note) {
        event(c, type, oldDate, newDate, requestedBy, note, null);
    }

    private void event(Cheque c, String type, LocalDate oldDate, LocalDate newDate, String requestedBy,
                       String note, String changes) {
        event(c, type, oldDate, newDate, requestedBy, note, changes, null);
    }

    private void event(Cheque c, String type, LocalDate oldDate, LocalDate newDate, String requestedBy,
                       String note, String changes, String reason) {
        ChequeEvent e = new ChequeEvent();
        e.setChequeId(c.getId());
        e.setEventType(type);
        e.setEventDate(LocalDate.now());
        e.setOldMaturityDate(oldDate);
        e.setNewMaturityDate(newDate);
        e.setRequestedBy(requestedBy);
        e.setNote(note);
        e.setChanges(changes);
        e.setReason(reason);
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

    /** Same cheque no. from the same bank twice is a typing mistake — unless the first one was cancelled. */
    private void rejectDuplicate(UUID selfId, String chequeNo, String bankName) {
        String bank = blankToNull(bankName);
        cheques.findByChequeNoIgnoreCase(chequeNo.trim()).stream()
            .filter(o -> !o.getId().equals(selfId) && !"CANCELLED".equals(o.getStatus()))
            .filter(o -> bank == null || o.getBankName() == null || o.getBankName().equalsIgnoreCase(bank))
            .findFirst()
            .ifPresent(o -> { throw new ApiException("Cheque " + o.getChequeNo()
                + (o.getBankName() == null ? "" : " of " + o.getBankName())
                + " is already recorded (" + o.getStatus().toLowerCase() + ", " + customerName(o.getCustomerId()) + ")"); });
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
