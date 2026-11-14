package com.mim.erp.accounting;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mim.erp.auth.AuthPrincipal;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Maker-checker for money going out. When an approval limit is set, a payment voucher (OUT) or a contra
 * voucher above it, entered by anyone but an admin, is queued instead of posted. A manager or admin
 * other than the maker approves it (it posts then, on its own date) or rejects it with a reason.
 * Receipts (money coming in) never wait.
 */
@Service
public class ApprovalService {

    static final String LIMIT_KEY = "voucher_approval_limit";

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final CashService cash;
    private final ContraService contra;
    private final PaymentRepository payments;
    private final DocNumberService docNo;

    public ApprovalService(JdbcTemplate jdbc, ObjectMapper json, CashService cash, ContraService contra,
                           PaymentRepository payments, DocNumberService docNo) {
        this.jdbc = jdbc; this.json = json; this.cash = cash; this.contra = contra; this.payments = payments; this.docNo = docNo;
    }

    // ------------------------------------------------------------------ settings
    /** Amount above which outgoing vouchers need approval; null = approval is off. */
    public BigDecimal limit() {
        List<String> v = jdbc.queryForList("select value from app_setting where key = ?", String.class, LIMIT_KEY);
        return v.isEmpty() || v.get(0) == null || v.get(0).isBlank() ? null : new BigDecimal(v.get(0));
    }

    @Transactional
    public Map<String, Object> saveLimit(BigDecimal limit) {
        if (limit != null && limit.signum() < 0) throw new ApiException("The approval limit can't be negative");
        if (limit == null) jdbc.update("delete from app_setting where key = ?", LIMIT_KEY);
        else jdbc.update("insert into app_setting (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
            LIMIT_KEY, limit.stripTrailingZeros().toPlainString());
        return settings();
    }

    public Map<String, Object> settings() {
        Map<String, Object> m = new LinkedHashMap<>();
        BigDecimal l = limit();
        m.put("enabled", l != null); m.put("limit", l);
        return m;
    }

    /** Whether this amount, entered by the current user, must wait for a checker. */
    public boolean needsApproval(BigDecimal amount) {
        BigDecimal l = limit();
        if (l == null || amount == null) return false;
        return amount.compareTo(l) > 0 && !"ADMIN".equals(role());
    }

    // ------------------------------------------------------------------ queue
    @Transactional
    public Map<String, Object> submitPayment(CashService.VoucherRequest r) {
        if (r.amount() == null || r.amount().signum() <= 0) throw new ApiException("Payment amount must be positive");
        if (r.partyId() == null) throw new ApiException("Pick a supplier");
        if ("BANK".equals(r.method()) && (r.bankAccountNo() == null || r.bankAccountNo().isBlank()))
            throw new ApiException("Bank account number is required for bank payments");
        LocalDate date = r.date() == null ? LocalDate.now() : r.date();
        if (date.isAfter(LocalDate.now())) throw new ApiException("A voucher can't be dated in the future");
        String party = jdbc.queryForList("select name from supplier where id = ?", String.class, r.partyId())
            .stream().findFirst().orElseThrow(() -> new ApiException("Supplier not found"));
        return queue("PAYMENT", "SUPPLIER", r.partyId(), r.amount(), date,
            "Payment to " + party + " (" + r.method() + ")", r);
    }

    @Transactional
    public Map<String, Object> submitContra(ContraService.ContraRequest r) {
        contra.validate(r);
        return queue("CONTRA", null, null, r.amount(), r.date() == null ? LocalDate.now() : r.date(),
            "Contra " + r.fromAccount() + " -> " + r.toAccount(), r);
    }

    private Map<String, Object> queue(String kind, String partyType, UUID partyId, BigDecimal amount, LocalDate date,
                                      String summary, Object payload) {
        String no = docNo.next("VR");
        UUID id = UUID.randomUUID();
        jdbc.update("""
            insert into voucher_request (id, request_no, kind, party_type, party_id, amount, voucher_date, summary, payload, requested_by)
            values (?,?,?,?,?,?,?,?,?::jsonb,?)
        """, id, no, kind, partyType, partyId, amount, date, summary, write(payload), user());
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pending", true); m.put("id", id); m.put("requestNo", no); m.put("amount", amount);
        return m;
    }

    public List<Map<String, Object>> list(String status) {
        String st = status == null || status.isBlank() ? "PENDING" : status.toUpperCase();
        return jdbc.queryForList("""
            select r.id, r.request_no, r.kind, r.party_type, r.party_id, r.amount, r.voucher_date, r.summary, r.payload::text as payload,
                   r.status, r.requested_by, r.requested_at, r.decided_by, r.decided_at, r.decision_note, r.posted_id, r.posted_no,
                   s.code as party_code, s.name as party_name, s.name_bn as party_name_bn
            from voucher_request r left join supplier s on r.party_type = 'SUPPLIER' and s.id = r.party_id
            where (? = 'ALL' or r.status = ?)
            order by r.requested_at desc limit 500
        """, st, st);
    }

    public long pendingCount() {
        Long n = jdbc.queryForObject("select count(*) from voucher_request where status = 'PENDING'", Long.class);
        return n == null ? 0 : n;
    }

    @Transactional
    public Map<String, Object> approve(UUID id, String note) {
        Map<String, Object> r = lockPending(id);
        String maker = (String) r.get("requested_by"), checker = user();
        if (checker.equals(maker)) throw new ApiException("You entered this voucher; another manager or admin must approve it");
        String postedNo;
        UUID postedId;
        if ("PAYMENT".equals(r.get("kind"))) {
            Payment p = cash.voucher(read((String) r.get("payload"), CashService.VoucherRequest.class));
            p.setRequestedBy(maker);
            p.setApprovedBy(checker);
            payments.save(p);
            postedId = p.getId(); postedNo = p.getVoucherNo();
        } else {
            Map<String, Object> c = contra.post(read((String) r.get("payload"), ContraService.ContraRequest.class), maker, checker);
            postedId = (UUID) c.get("id"); postedNo = (String) c.get("voucherNo");
        }
        jdbc.update("""
            update voucher_request set status = 'APPROVED', decided_by = ?, decided_at = now(), decision_note = ?,
                   posted_id = ?, posted_no = ? where id = ?
        """, checker, blank(note), postedId, postedNo, id);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id); m.put("status", "APPROVED"); m.put("postedId", postedId); m.put("postedNo", postedNo);
        return m;
    }

    @Transactional
    public Map<String, Object> reject(UUID id, String note) {
        lockPending(id);
        if (blank(note) == null) throw new ApiException("Give a reason for rejecting");
        jdbc.update("update voucher_request set status = 'REJECTED', decided_by = ?, decided_at = now(), decision_note = ? where id = ?",
            user(), note.trim(), id);
        return Map.of("id", id, "status", "REJECTED");
    }

    private Map<String, Object> lockPending(UUID id) {
        Map<String, Object> r = jdbc.queryForList("select id, kind, status, requested_by, payload::text as payload from voucher_request where id = ? for update", id)
            .stream().findFirst().orElseThrow(() -> new ApiException("Request not found"));
        if (!"PENDING".equals(r.get("status"))) throw new ApiException("This request is already " + String.valueOf(r.get("status")).toLowerCase());
        return r;
    }

    // ------------------------------------------------------------------ helpers
    private String write(Object o) {
        try { return json.writeValueAsString(o); }
        catch (JsonProcessingException e) { throw new ApiException("Could not store the voucher: " + e.getMessage()); }
    }

    private <T> T read(String s, Class<T> type) {
        try { return json.readValue(s, type); }
        catch (JsonProcessingException e) { throw new ApiException("Stored voucher is unreadable: " + e.getMessage()); }
    }

    private static String blank(String s) { return s == null || s.isBlank() ? null : s.trim(); }

    private static AuthPrincipal principal() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        return a != null && a.getPrincipal() instanceof AuthPrincipal p ? p : null;
    }
    private static String user() { AuthPrincipal p = principal(); return p == null ? "system" : p.username(); }
    private static String role() { AuthPrincipal p = principal(); return p == null ? null : p.role(); }
}
