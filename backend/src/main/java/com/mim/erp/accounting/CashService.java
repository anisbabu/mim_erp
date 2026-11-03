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

    public CashService(PaymentRepository payments, PettyCashVoucherRepository vouchers,
                       AccountRepository accounts, AccountingService accounting,
                       LedgerService ledgers, DocNumberService docNo, JdbcTemplate jdbc) {
        this.payments = payments; this.vouchers = vouchers; this.accounts = accounts;
        this.accounting = accounting; this.ledgers = ledgers; this.docNo = docNo; this.jdbc = jdbc;
    }

    /** Cash goes to Cash (1000); a bank payment goes to the default bank ledger, else Bank (1010). */
    @Transactional
    public Payment record(String direction, String partyType, UUID partyId,
                          BigDecimal amount, String method, String note) {
        String account = "BANK".equals(method)
            ? accounts.findFirstByDefaultDepositTrue().map(Account::getCode).orElse("1010")
            : "1000";
        return record(direction, partyType, partyId, amount, method, note, account);
    }

    /** Past receipts (IN) or payments (OUT), newest first, with the party's name. */
    public List<Map<String, Object>> list(String direction, int limit) {
        if (!"IN".equals(direction) && !"OUT".equals(direction)) throw new ApiException("Direction must be IN or OUT");
        return jdbc.queryForList("""
            select p.id, p.payment_no, p.direction, p.party_type, p.party_id, p.amount, p.method, p.note, p.payment_date,
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

    /** Same as {@link #record}, but the money side lands on {@code cashAccount} (e.g. "1010" Bank). */
    @Transactional
    public Payment record(String direction, String partyType, UUID partyId,
                          BigDecimal amount, String method, String note, String cashAccount) {
        if (amount == null || amount.signum() <= 0)
            throw new ApiException("Payment amount must be positive");

        Payment p = new Payment();
        p.setPaymentNo(docNo.next("PAY"));
        p.setDirection(direction);
        p.setPartyType(partyType);
        p.setPartyId(partyId);
        p.setAmount(amount);
        p.setMethod(method == null ? "CASH" : method);
        p.setNote(note);
        p.setPaymentDate(LocalDate.now());
        Payment saved = payments.save(p);

        if ("OUT".equals(direction)) {        // pay supplier, settle that supplier's AP ledger
            String apLedger = partyId != null ? ledgers.supplierLedger(partyId).getCode() : "2000";
            accounting.post(saved.getPaymentDate(), "Payment to supplier " + saved.getPaymentNo(),
                "PAYMENT", saved.getId(),
                List.of(Leg.debit(apLedger, amount), Leg.credit(cashAccount, amount)));
        } else if ("IN".equals(direction)) {  // receive from customer, settle that customer's AR ledger
            String arLedger = partyId != null ? ledgers.customerLedger(partyId).getCode() : "1100";
            accounting.post(saved.getPaymentDate(), "Receipt from customer " + saved.getPaymentNo(),
                "RECEIPT", saved.getId(),
                List.of(Leg.debit(cashAccount, amount), Leg.credit(arLedger, amount)));
        } else {
            throw new ApiException("Payment direction must be IN or OUT");
        }
        return saved;
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
