package com.mim.erp.accounting;

import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.auth.AuthPrincipal;
import com.mim.erp.common.ApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Maker-checker approval, contra vouchers, and hand matching that survives a rebuild. */
@SpringBootTest
@Testcontainers
class ControlsTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired ApprovalService approvals;
    @Autowired ContraService contra;
    @Autowired CashService cash;
    @Autowired BillService bills;
    @Autowired AccountingService accounting;
    @Autowired LedgerService ledgers;
    @Autowired JdbcTemplate jdbc;

    private static final LocalDate TODAY = LocalDate.now();

    @BeforeEach
    void setUp() {
        Integer fy = jdbc.queryForObject("select count(*) from financial_year where is_current and ?::date between start_date and end_date",
            Integer.class, TODAY.toString());
        if (fy == null || fy == 0) {
            int y = TODAY.getMonthValue() >= 7 ? TODAY.getYear() : TODAY.getYear() - 1;
            jdbc.update("update financial_year set is_current = false");
            jdbc.update("insert into financial_year (name, start_date, end_date, is_current) values (?,?,?,true) "
                + "on conflict (name) do update set is_current = true", y + "-" + (y + 1), LocalDate.of(y, 7, 1), LocalDate.of(y + 1, 6, 30));
        }
        as("ADMIN");
    }

    @AfterEach
    void tearDown() {
        as("ADMIN");
        approvals.saveLimit(null);
        SecurityContextHolder.clearContext();
    }

    private void as(String role) { as(role, role.toLowerCase()); }

    private void as(String role, String username) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
            new AuthPrincipal(UUID.randomUUID(), username, role, username), null, List.of()));
    }

    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    private BigDecimal net(String code, String sourceType, UUID sourceId) {
        return jdbc.queryForObject("""
            select coalesce(sum(jl.credit - jl.debit), 0) from journal_line jl join journal_entry je on je.id = jl.journal_id
            join account a on a.id = jl.account_id where a.code = ? and je.source_type = ? and je.source_id = ?
        """, BigDecimal.class, code, sourceType, sourceId);
    }

    private UUID supplier() {
        UUID s = UUID.randomUUID();
        jdbc.update("insert into supplier (id, code, name) values (?,?,?)", s, "S" + s.toString().substring(0, 8), "Supplier");
        return s;
    }

    private CashService.VoucherRequest pay(UUID supplier, String amount) {
        return new CashService.VoucherRequest("OUT", "SUPPLIER", supplier, TODAY, bd(amount), null, "CASH",
            null, null, null, null, "test", null, null, null);
    }

    @Test
    void paymentAboveTheLimitWaitsForAnotherManager() {
        approvals.saveLimit(bd("1000"));
        UUID s = supplier();

        as("ACCOUNTANT", "maker");
        assertThat(approvals.needsApproval(bd("1000"))).isFalse();
        assertThat(approvals.needsApproval(bd("1000.01"))).isTrue();
        Map<String, Object> q = approvals.submitPayment(pay(s, "5000"));
        UUID req = (UUID) q.get("id");
        assertThat(jdbc.queryForObject("select count(*) from payment where party_id = ?", Integer.class, s)).isZero();   // nothing posted yet
        assertThatThrownBy(() -> approvals.approve(req, null)).isInstanceOf(ApiException.class)
            .hasMessageContaining("another");

        as("MANAGER", "checker");
        Map<String, Object> done = approvals.approve(req, "ok");
        UUID paymentId = (UUID) done.get("postedId");
        assertThat(jdbc.queryForMap("select requested_by, approved_by from payment where id = ?", paymentId))
            .containsEntry("requested_by", "maker").containsEntry("approved_by", "checker");
        assertThat(net(ledgers.supplierLedger(s).getCode(), "PAYMENT", paymentId)).isEqualByComparingTo("-5000");
        assertThatThrownBy(() -> approvals.approve(req, null)).hasMessageContaining("already approved");

        as("ACCOUNTANT", "maker");
        UUID second = (UUID) approvals.submitPayment(pay(s, "2000")).get("id");
        as("ADMIN", "boss");
        assertThat(approvals.needsApproval(bd("99999"))).isFalse();                     // admins are not queued
        assertThatThrownBy(() -> approvals.reject(second, " ")).hasMessageContaining("reason");
        approvals.reject(second, "wrong supplier");
        assertThat(jdbc.queryForObject("select status from voucher_request where id = ?", String.class, second)).isEqualTo("REJECTED");
    }

    @Test
    void contraMovesMoneyBetweenCashAndBank() {
        Map<String, Object> cv = contra.post(new ContraService.ContraRequest(TODAY, "1000", "1010", bd("2500"), "slip 7", "deposit"), null, null);
        UUID id = (UUID) cv.get("id");
        assertThat((String) cv.get("voucherNo")).startsWith("CV-");
        assertThat(net("1000", "CONTRA", id)).isEqualByComparingTo("2500");    // credit cash
        assertThat(net("1010", "CONTRA", id)).isEqualByComparingTo("-2500");   // debit bank
        assertThatThrownBy(() -> contra.post(new ContraService.ContraRequest(TODAY, "1000", "1000", bd("1"), null, null), null, null))
            .hasMessageContaining("different");
        assertThatThrownBy(() -> contra.post(new ContraService.ContraRequest(TODAY, "1000", "4000", bd("1"), null, null), null, null))
            .hasMessageContaining("cash and bank");
    }

    @Test
    void handMatchingIsKeptWhenBillsAreRebuilt() {
        UUID c = UUID.randomUUID();
        jdbc.update("insert into customer (id, code, name, type, credit_limit) values (?,?,?, 'PARTY', 0)",
            c, "C" + c.toString().substring(0, 8), "Customer");
        String ar = ledgers.customerLedger(c).getCode();
        accounting.post(TODAY.minusDays(2), "bill A", "TEST", UUID.randomUUID(), List.of(Leg.debit(ar, bd("100")), Leg.credit("4000", bd("100"))));
        accounting.post(TODAY.minusDays(1), "bill B", "TEST", UUID.randomUUID(), List.of(Leg.debit(ar, bd("100")), Leg.credit("4000", bd("100"))));
        Payment rv = cash.voucher(new CashService.VoucherRequest("IN", "CUSTOMER", c, TODAY, bd("100"), null, "CASH",
            null, null, null, null, null, null, null, null));

        UUID receipt = item("RECEIPT", rv.getId());
        UUID billA = itemByNarration("bill A"), billB = itemByNarration("bill B");
        assertThat(openOf(billA)).isEqualByComparingTo("0");                 // oldest-first took A

        bills.unmatch(receipt);
        bills.match(receipt, List.of(new BillService.Alloc(billB, bd("100"))));
        assertThat(openOf(billA)).isEqualByComparingTo("100");
        assertThat(openOf(billB)).isEqualByComparingTo("0");
        assertThatThrownBy(() -> bills.match(receipt, List.of(new BillService.Alloc(billA, bd("1")))))
            .hasMessageContaining("unmatched");

        bills.rebuild();
        UUID a2 = itemByNarration("bill A"), b2 = itemByNarration("bill B");
        assertThat(openOf(a2)).isEqualByComparingTo("100");
        assertThat(openOf(b2)).isEqualByComparingTo("0");
    }

    private UUID item(String sourceType, UUID sourceId) {
        return jdbc.queryForObject("""
            select i.id from party_item i join journal_entry je on je.id = i.journal_id where je.source_type = ? and je.source_id = ?
        """, UUID.class, sourceType, sourceId);
    }

    private UUID itemByNarration(String narration) {
        return jdbc.queryForObject("""
            select i.id from party_item i join journal_entry je on je.id = i.journal_id where je.narration = ? order by je.created_at desc limit 1
        """, UUID.class, narration);
    }

    private BigDecimal openOf(UUID item) {
        return jdbc.queryForObject("""
            select i.amount - coalesce((select sum(x.amount) from bill_allocation x where x.bill_id = i.id or x.credit_id = i.id), 0)
            from party_item i where i.id = ?
        """, BigDecimal.class, item);
    }
}
