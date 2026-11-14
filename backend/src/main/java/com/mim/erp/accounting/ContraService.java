package com.mim.erp.accounting;

import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Contra voucher: money moved between our own cash and bank ledgers (cash deposited, cash withdrawn,
 * bank to bank). Dr the receiving ledger / Cr the paying ledger, numbered CV-yyyy-nnnnnn.
 */
@Service
public class ContraService {

    public record ContraRequest(LocalDate date, String fromAccount, String toAccount, BigDecimal amount,
                                String reference, String note) {}

    private final JdbcTemplate jdbc;
    private final AccountingService accounting;
    private final CashService cash;

    public ContraService(JdbcTemplate jdbc, AccountingService accounting, CashService cash) {
        this.jdbc = jdbc; this.accounting = accounting; this.cash = cash;
    }

    /** Ledgers money can sit in: the cash group, petty cash and every bank ledger. */
    public List<Map<String, Object>> moneyLedgers() {
        return jdbc.queryForList("""
            select a.code, a.name, a.name_bn from account a left join account_group g on g.id = a.group_id
            where a.party_type is null and a.type = 'ASSET' and coalesce(a.active, true)
              and (g.code in ('A-CH', 'A-BK') or a.code in ('1000', '1010', '1300'))
            order by case when a.code = '1000' then 0 else 1 end, a.code
        """);
    }

    /** Check a request without posting it (used before it is queued for approval). */
    public void validate(ContraRequest r) {
        if (r.amount() == null || r.amount().signum() <= 0) throw new ApiException("Amount must be positive");
        if (r.fromAccount() == null || r.toAccount() == null) throw new ApiException("Pick both ledgers");
        if (r.fromAccount().equals(r.toAccount())) throw new ApiException("From and To must be different ledgers");
        List<Object> codes = moneyLedgers().stream().map(m -> m.get("code")).toList();
        if (!codes.contains(r.fromAccount()) || !codes.contains(r.toAccount()))
            throw new ApiException("A contra voucher moves money between cash and bank ledgers only");
        LocalDate d = r.date() == null ? LocalDate.now() : r.date();
        if (d.isAfter(LocalDate.now())) throw new ApiException("A voucher can't be dated in the future");
        accounting.assertPeriodOpen(d);
    }

    @Transactional
    public Map<String, Object> post(ContraRequest r, String requestedBy, String approvedBy) {
        validate(r);
        LocalDate date = r.date() == null ? LocalDate.now() : r.date();
        BigDecimal amount = r.amount().setScale(2, RoundingMode.HALF_UP);
        String no = cash.nextVoucherNo("CV", date);
        UUID id = UUID.randomUUID();
        String user = currentUser();
        jdbc.update("""
            insert into contra_voucher (id, voucher_no, voucher_date, from_account, to_account, amount, reference, note,
                                        requested_by, approved_by, created_by)
            values (?,?,?,?,?,?,?,?,?,?,?)
        """, id, no, date, r.fromAccount(), r.toAccount(), amount, blank(r.reference()), blank(r.note()),
            requestedBy, approvedBy, user);
        accounting.post(date, "Contra " + no + (blank(r.note()) == null ? "" : " - " + r.note().trim()), "CONTRA", id,
            List.of(Leg.debit(r.toAccount(), amount), Leg.credit(r.fromAccount(), amount)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id); out.put("voucherNo", no); out.put("amount", amount);
        return out;
    }

    public List<Map<String, Object>> list(int limit) {
        return jdbc.queryForList("""
            select c.*, fa.name as from_name, fa.name_bn as from_name_bn, ta.name as to_name, ta.name_bn as to_name_bn
            from contra_voucher c
            left join account fa on fa.code = c.from_account left join account ta on ta.code = c.to_account
            order by c.voucher_date desc, c.created_at desc limit ?
        """, Math.max(1, Math.min(limit, 1000)));
    }

    private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }

    static String currentUser() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a != null && a.getPrincipal() instanceof com.mim.erp.auth.AuthPrincipal p ? p.username() : "system";
    }
}
