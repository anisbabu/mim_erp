package com.mim.erp.accounting;

import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Cash movements:
 *   payment OUT to supplier  — settle AP:  Dr Accounts Payable / Cr Cash
 *   payment IN from customer — settle AR:  Dr Cash / Cr Accounts Receivable
 *   petty cash voucher       — shop spend: Dr <expense account> / Cr Petty Cash
 */
@Service
public class CashService {

    private final PaymentRepository payments;
    private final PettyCashVoucherRepository vouchers;
    private final AccountRepository accounts;
    private final AccountingService accounting;
    private final LedgerService ledgers;
    private final DocNumberService docNo;

    private final JdbcTemplate jdbc;
    private final BillService bills;

    public CashService(PaymentRepository payments, PettyCashVoucherRepository vouchers,
                       AccountRepository accounts, AccountingService accounting,
                       LedgerService ledgers, DocNumberService docNo, JdbcTemplate jdbc,
                       BillService bills) {
        this.payments = payments; this.vouchers = vouchers; this.accounts = accounts;
        this.accounting = accounting; this.ledgers = ledgers; this.docNo = docNo; this.jdbc = jdbc; this.bills = bills;
    }

    /** Discount allowed to a customer (expense) / received from a supplier (income). */
    static final String DISCOUNT_ALLOWED = "5500", DISCOUNT_RECEIVED = "4300";

    /** One receipt / payment voucher as entered on the screen. */
    public record VoucherRequest(String direction, String partyType, UUID partyId, LocalDate date,
                                 BigDecimal amount, BigDecimal discount, String method, String cashAccount,
                                 String bankAccountNo, String bankBranch, String reference, String note,
                                 List<BillService.Alloc> allocations,
                                 BigDecimal ait, BigDecimal vds) {}   // tax deducted at source (AIT / VAT)

    /**
     * Receipt voucher (IN):  Dr Cash/Bank amount, Dr Discount Allowed discount / Cr Customer amount + discount.
     * Payment voucher (OUT): Dr Supplier amount + discount / Cr Cash/Bank amount, Cr Discount Received discount.
     * No bills picked = settle the oldest bills first; bills picked = only those, the rest stays as advance.
     * Cash goes to Cash (1000); bank goes to the chosen bank ledger, else the default bank, else Bank (1010).
     */
    @Transactional
    public Payment voucher(VoucherRequest r) {
        boolean bank = "BANK".equals(r.method());
        if (bank && (r.bankAccountNo() == null || r.bankAccountNo().isBlank()))
            throw new ApiException("Bank account number is required for bank payments");
        String account = !bank ? "1000"
            : r.cashAccount() != null && !r.cashAccount().isBlank() ? bankLedger(r.cashAccount().trim())
            : accounts.findFirstByDefaultDepositTrue().map(Account::getCode).orElse("1010");
        LocalDate date = r.date() == null ? LocalDate.now() : r.date();
        if (date.isAfter(LocalDate.now())) throw new ApiException("A voucher can't be dated in the future");
        Payment p = post(r.direction(), r.partyType(), r.partyId(), date, r.amount(), r.discount(), r.method(),
            r.note(), account, bank ? r.bankAccountNo().trim() : null,
            bank && r.bankBranch() != null && !r.bankBranch().isBlank() ? r.bankBranch().trim() : null,
            r.reference() == null || r.reference().isBlank() ? null : r.reference().trim(), r.ait(), r.vds());
        if (r.allocations() != null && !r.allocations().isEmpty()) {
            UUID journal = jdbc.queryForObject(
                "select id from journal_entry where source_id = ? and source_type in ('RECEIPT','PAYMENT')", UUID.class, p.getId());
            bills.allocate(journal, r.allocations());
        }
        return p;
    }

    private String bankLedger(String code) {
        Account a = accounts.findByCode(code).orElseThrow(() -> new ApiException("Unknown bank ledger " + code));
        if (!"ASSET".equals(a.getType()) || a.getPartyType() != null) throw new ApiException("Pick a bank ledger");
        return a.getCode();
    }

    /** Old entry point (no date / discount / allocation): today, settled oldest-first. */
    @Transactional
    public Payment record(String direction, String partyType, UUID partyId,
                          BigDecimal amount, String method, String note,
                          String bankAccountNo, String bankBranch) {
        return voucher(new VoucherRequest(direction, partyType, partyId, null, amount, null, method, null,
            bankAccountNo, bankBranch, null, note, null, null, null));
    }

    /** Past receipts (IN) or payments (OUT), newest first, with the party's name. */
    public List<Map<String, Object>> list(String direction, int limit) {
        if (!"IN".equals(direction) && !"OUT".equals(direction)) throw new ApiException("Direction must be IN or OUT");
        return jdbc.queryForList("""
            select p.id, p.payment_no, p.voucher_no, p.discount, p.ait, p.vds, p.reference, p.direction, p.party_type, p.party_id, p.amount, p.method, p.note, p.payment_date, p.bank_account_no, p.bank_branch,
                   coalesce(c.code, s.code) as party_code,
                   coalesce(c.name, s.name) as party_name,
                   coalesce(c.name_bn, s.name_bn) as party_name_bn
            from payment p
            left join customer c on p.party_type = 'CUSTOMER' and c.id = p.party_id
            left join supplier s on p.party_type = 'SUPPLIER' and s.id = p.party_id
            where p.direction = ?
            order by p.payment_date desc, p.created_at desc
            limit ?
        """, direction, Math.max(1, Math.min(limit, 1000)));
    }

    /** Receipt / payment voucher slip: party, money ledger, bills settled, balance now. */
    public byte[] voucherPdf(UUID paymentId, boolean bn) {
        Map<String, Object> v = jdbc.queryForList("""
            select p.*, coalesce(c.code, s.code) as party_code, coalesce(c.name, s.name) as party_name,
                   coalesce(c.name_bn, s.name_bn) as party_name_bn, coalesce(c.mobile, s.mobile) as party_mobile,
                   je.id as journal_id, je.entry_no, je.created_by,
                   (select a.name from journal_line jl join account a on a.id = jl.account_id
                     where jl.journal_id = je.id and a.party_type is null and a.code not in ('5500','4300')
                     limit 1) as money_ledger
            from payment p
            left join customer c on p.party_type = 'CUSTOMER' and c.id = p.party_id
            left join supplier s on p.party_type = 'SUPPLIER' and s.id = p.party_id
            left join journal_entry je on je.source_id = p.id and je.source_type in ('RECEIPT','PAYMENT')
            where p.id = ?
        """, paymentId).stream().findFirst().orElseThrow(() -> new ApiException("Voucher not found"));
        UUID journal = (UUID) v.get("journal_id");
        List<Map<String, Object>> allocs = journal == null ? List.of() : bills.allocationsOf(journal);
        Object balance = bills.openItems((String) v.get("party_type"), (UUID) v.get("party_id")).get("balance");
        return VoucherPdf.render(v, allocs, (BigDecimal) balance, bn);
    }

    /** Same as {@link #record}, but the money side lands on {@code cashAccount} (e.g. "1010" Bank). */
    @Transactional
    public Payment record(String direction, String partyType, UUID partyId,
                          BigDecimal amount, String method, String note, String cashAccount) {
        return record(direction, partyType, partyId, amount, method, note, cashAccount, null, null);
    }

    @Transactional
    public Payment record(String direction, String partyType, UUID partyId,
                          BigDecimal amount, String method, String note, String cashAccount,
                          String bankAccountNo, String bankBranch) {
        return post(direction, partyType, partyId, LocalDate.now(), amount, null, method, note, cashAccount,
            bankAccountNo, bankBranch, null, null, null);
    }

    private Payment post(String direction, String partyType, UUID partyId, LocalDate date,
                         BigDecimal amount, BigDecimal discount, String method, String note, String cashAccount,
                         String bankAccountNo, String bankBranch, String reference, BigDecimal aitIn, BigDecimal vdsIn) {
        if (!"IN".equals(direction) && !"OUT".equals(direction))
            throw new ApiException("Payment direction must be IN or OUT");
        if (amount == null || amount.signum() <= 0)
            throw new ApiException("Payment amount must be positive");
        BigDecimal disc = discount == null ? BigDecimal.ZERO : discount;
        if (disc.signum() < 0) throw new ApiException("Discount can't be negative");
        BigDecimal ait = aitIn == null ? BigDecimal.ZERO : aitIn, vds = vdsIn == null ? BigDecimal.ZERO : vdsIn;
        if (ait.signum() < 0 || vds.signum() < 0) throw new ApiException("Tax deducted at source can't be negative");
        if (partyId == null) throw new ApiException("Pick a " + ("IN".equals(direction) ? "customer" : "supplier"));
        accounting.assertPeriodOpen(date);

        boolean in = "IN".equals(direction);
        Payment p = new Payment();
        p.setPaymentNo(docNo.next("PAY"));
        p.setVoucherNo(nextVoucherNo(in ? "RV" : "PV", date));
        p.setDirection(direction);
        p.setPartyType(in ? "CUSTOMER" : "SUPPLIER");
        p.setPartyId(partyId);
        p.setAmount(amount);
        p.setDiscount(disc);
        p.setAit(ait);
        p.setVds(vds);
        p.setMethod(method == null ? "CASH" : method);
        p.setNote(note);
        p.setReference(reference);
        p.setBankAccountNo(bankAccountNo);
        p.setBankBranch(bankBranch);
        p.setPaymentDate(date);
        Payment saved = payments.save(p);

        // the party's account is settled by the cash plus discount plus any tax deducted at source
        BigDecimal settled = amount.add(disc).add(ait).add(vds);
        List<Leg> legs = new java.util.ArrayList<>();
        String narration = (in ? "Receipt " : "Payment ") + saved.getVoucherNo()
            + (reference == null ? "" : " ref " + reference) + (note == null || note.isBlank() ? "" : " - " + note);
        if (in) {        // receive from customer, settle that customer's AR ledger
            legs.add(Leg.debit(cashAccount, amount));
            if (disc.signum() > 0) legs.add(Leg.debit(DISCOUNT_ALLOWED, disc));
            if (ait.signum() > 0) legs.add(Leg.debit(VatService.AIT_CREDIT, ait));   // customer withheld income tax: our advance tax
            if (vds.signum() > 0) legs.add(Leg.debit(VatService.VDS_CREDIT, vds));   // customer withheld VAT: credit against our VAT
            legs.add(Leg.credit(ledgers.customerLedger(partyId).getCode(), settled));
        } else {         // pay supplier, settle that supplier's AP ledger
            legs.add(Leg.debit(ledgers.supplierLedger(partyId).getCode(), settled));
            legs.add(Leg.credit(cashAccount, amount));
            if (disc.signum() > 0) legs.add(Leg.credit(DISCOUNT_RECEIVED, disc));
            if (ait.signum() > 0) legs.add(Leg.credit(VatService.AIT_PAYABLE, ait)); // we withheld income tax: owed to NBR
            if (vds.signum() > 0) legs.add(Leg.credit(VatService.VDS_PAYABLE, vds)); // we withheld VAT: owed to NBR
        }
        accounting.post(date, narration, in ? "RECEIPT" : "PAYMENT", saved.getId(), legs);
        return saved;
    }

    /** Gapless RV / PV number per calendar year of the voucher date (counter locked until commit). */
    String nextVoucherNo(String prefix, LocalDate date) {
        Long n = jdbc.queryForObject(
            "insert into doc_counter (prefix, yr, last_no) values (?, ?, 1) "
          + "on conflict (prefix, yr) do update set last_no = doc_counter.last_no + 1 returning last_no",
            Long.class, prefix, date.getYear());
        return "%s-%d-%06d".formatted(prefix, date.getYear(), n);
    }

    @Transactional
    public PettyCashVoucher pettyCash(UUID shopId, BigDecimal amount,
                                      UUID expenseAccountId, String description) {
        if (amount == null || amount.signum() <= 0)
            throw new ApiException("Voucher amount must be positive");
        Account expense = accounts.findById(expenseAccountId)
            .orElseThrow(() -> new ApiException("Expense account not found"));
        if (!"EXPENSE".equals(expense.getType()))
            throw new ApiException("Petty cash must post to an expense account");

        PettyCashVoucher v = new PettyCashVoucher();
        v.setVoucherNo(docNo.next("PCV"));
        v.setShopId(shopId);
        v.setAmount(amount);
        v.setExpenseAccountId(expenseAccountId);
        v.setDescription(description);
        v.setVoucherDate(LocalDate.now());
        PettyCashVoucher saved = vouchers.save(v);

        accounting.post(saved.getVoucherDate(), "Petty cash " + saved.getVoucherNo(),
            "PETTY_CASH", saved.getId(),
            List.of(Leg.debit(expense.getCode(), amount), Leg.credit("1300", amount)));
        return saved;
    }
}
