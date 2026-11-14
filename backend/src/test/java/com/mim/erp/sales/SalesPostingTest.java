package com.mim.erp.sales;

import com.mim.erp.accounting.BillService;
import com.mim.erp.accounting.LedgerService;
import com.mim.erp.auth.AuthPrincipal;
import com.mim.erp.common.ApiException;
import com.mim.erp.inventory.InventoryService;
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

/**
 * Revenue is earned when goods leave: an order books only what is delivered now, each later delivery
 * books its own part, a challan books its sale on the challan date, and the consolidated invoice adds
 * only transport / price changes. Sales returns take their own date and refund ledger.
 */
@SpringBootTest
@Testcontainers
class SalesPostingTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired SalesService sales;
    @Autowired SalesReturnService returns;
    @Autowired InventoryService inventory;
    @Autowired LedgerService ledgers;
    @Autowired BillService bills;
    @Autowired JdbcTemplate jdbc;

    private static final LocalDate TODAY = LocalDate.now();
    private UUID shop, warehouse, product, user;

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
        String k = UUID.randomUUID().toString().substring(0, 8);
        user = UUID.randomUUID();
        jdbc.update("insert into app_user (id, username, password_hash, role) values (?,?,?, 'ADMIN')", user, "t" + k, "x");
        shop = UUID.randomUUID();
        jdbc.update("insert into shop (id, code, name, primary_line) values (?,?,?, 'HARDWARE')", shop, "SH" + k, "Test shop");
        warehouse = UUID.randomUUID();
        jdbc.update("insert into warehouse (id, code, name) values (?,?,?)", warehouse, "W" + k, "TEST WH");
        product = UUID.randomUUID();
        jdbc.update("insert into product (id, sku, name, type) values (?,?,?, 'HARDWARE')", product, "P" + k, "Test hinge");
        inventory.addLayer(product, warehouse, null, new BigDecimal("1000"), new BigDecimal("60"), TODAY, TODAY, "OPENING", null);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
            new AuthPrincipal(user, "t" + k, "ADMIN", "Test"), null, List.of()));
    }

    @AfterEach
    void clearAuth() { SecurityContextHolder.clearContext(); }

    private UUID customer() {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into customer (id, code, name, type, credit_days, credit_limit) values (?,?,?, 'PARTY', 0, 1000000)",
            id, "C" + id.toString().substring(0, 8), "Test customer");
        return id;
    }

    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    private SalesDtos.Allocation now(String qty, String price, String disc) {
        return new SalesDtos.Allocation(product, warehouse, bd(qty), bd(price), disc == null ? null : bd(disc));
    }

    private SalesDtos.Allocation later(String qty, String price, String disc) {
        return new SalesDtos.Allocation(product, null, bd(qty), bd(price), disc == null ? null : bd(disc));
    }

    private SalesDtos.OrderResult order(UUID customer, String mode, String transport, SalesDtos.Allocation... a) {
        return sales.createOrder(new SalesDtos.CreateOrderRequest(shop, customer, user, mode, List.of(a),
            null, "test", "test", transport == null ? null : bd(transport), null, null));
    }

    private void fulfil(UUID soId, String qty) {
        UUID line = jdbc.queryForObject("select id from so_line where so_id = ? and qty_pending > 0 order by line_no limit 1",
            UUID.class, soId);
        sales.fulfillOrder(soId, new SalesDtos.FulfillRequest(List.of(new SalesDtos.FulfillLine(line, warehouse, bd(qty)))));
    }

    /** Revenue (ledger 4000, net credit) booked for one order and its challans. */
    private BigDecimal revenue(UUID soId) {
        return jdbc.queryForObject("""
            select coalesce(sum(jl.credit - jl.debit), 0) from journal_line jl
            join journal_entry je on je.id = jl.journal_id join account a on a.id = jl.account_id
            where a.code in ('4000', '4010', '4400') and (je.source_id = ? or je.source_id in (select id from delivery_challan where so_id = ?))
        """, BigDecimal.class, soId, soId);
    }

    private void assertBillsMatchLedger(UUID customer) {
        Map<String, Object> open = bills.openItems("CUSTOMER", customer);
        assertThat((BigDecimal) open.get("balance")).isEqualByComparingTo(ledgers.customerBalance(customer));
    }

    @Test
    void creditOrderBooksOnlyWhatIsDeliveredThenEachDelivery() {
        UUID c = customer();
        var r = order(c, "CREDIT", "50", now("4", "100", null), later("6", "100", null));

        // order: 4 delivered + transport; the 6 pending are not revenue yet, but count against the credit limit
        assertThat(revenue(r.soId())).isEqualByComparingTo("450");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("450");
        assertThat(ledgers.undeliveredCreditOrders(c)).isEqualByComparingTo("600");

        fulfil(r.soId(), "6");
        assertThat(revenue(r.soId())).isEqualByComparingTo("1050");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("1050");
        assertThat(ledgers.undeliveredCreditOrders(c)).isEqualByComparingTo("0");
        assertBillsMatchLedger(c);
    }

    @Test
    void pendingCreditOrdersCountAgainstTheLimit() {
        UUID c = customer();
        jdbc.update("update customer set credit_limit = 1000 where id = ?", c);
        order(c, "CREDIT", null, later("8", "100", null));          // nothing delivered: 800 still owed on order
        assertThatThrownBy(() -> sales.createOrder(new SalesDtos.CreateOrderRequest(shop, c, user, "CREDIT",
                List.of(later("3", "100", null)), null, "test", "test", null, null, null)))
            .isInstanceOf(ApiException.class).hasMessageContaining("Credit limit exceeded");
    }

    @Test
    void cashTakenForPendingGoodsIsAnAdvanceSettledByDelivery() {
        UUID c = customer();
        var r = order(c, "CASH", null, now("3", "100", null), later("7", "100", null));

        assertThat(revenue(r.soId())).isEqualByComparingTo("300");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("-700");   // advance held for the 7 to come

        fulfil(r.soId(), "7");
        assertThat(revenue(r.soId())).isEqualByComparingTo("1000");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("0");
        Map<String, Object> open = bills.openItems("CUSTOMER", c);
        assertThat((List<?>) open.get("bills")).isEmpty();
        assertThat((List<?>) open.get("advances")).isEmpty();
    }

    @Test
    void lastDeliveryBooksTheDiscountRoundingRemainder() {
        UUID c = customer();
        var r = order(c, "CREDIT", null, later("3", "100", "10"));    // net 290
        assertThat(revenue(r.soId())).isEqualByComparingTo("0");
        fulfil(r.soId(), "1");                                        // 100 - 3.33
        assertThat(revenue(r.soId())).isEqualByComparingTo("96.67");
        fulfil(r.soId(), "2");
        assertThat(revenue(r.soId())).isEqualByComparingTo("290");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("290");
    }

    @Test
    void challanBooksItsSaleAndCashInvoiceOnlyAddsTransport() {
        UUID c = customer();
        DeliveryChallan dc = sales.issueChallan(new SalesDtos.IssueChallanRequest(shop, c, user, warehouse,
            List.of(now("5", "100", null)), "test", null));
        BigDecimal booked = jdbc.queryForObject("""
            select coalesce(sum(jl.credit - jl.debit), 0) from journal_line jl join journal_entry je on je.id = jl.journal_id
            join account a on a.id = jl.account_id where a.code in ('4000', '4010', '4400') and je.source_id = ? and je.entry_date = ?
        """, BigDecimal.class, dc.getId(), dc.getChallanDate());
        assertThat(booked).isEqualByComparingTo("500");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("500");

        var inv = sales.consolidate(new SalesDtos.ConsolidateRequest(c, "CASH", null, null, null, bd("20"), null));
        assertThat(revenue(inv.soId())).isEqualByComparingTo("520");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("0");
        Map<String, Object> open = bills.openItems("CUSTOMER", c);
        assertThat((List<?>) open.get("bills")).isEmpty();
        assertThat((List<?>) open.get("advances")).isEmpty();
    }

    @Test
    void returnTakesItsOwnDateAndRefundLedger() {
        UUID c = customer();
        var r = order(c, "CASH", null, now("4", "100", null));
        jdbc.update("update sales_order set order_date = ? where id = ?", TODAY.minusDays(5), r.soId());
        UUID dcLine = jdbc.queryForObject(
            "select dl.id from dc_line dl join delivery_challan dc on dc.id = dl.dc_id where dc.so_id = ? limit 1", UUID.class, r.soId());

        assertThatThrownBy(() -> returns.create(new SalesReturnService.CreateRequest(r.soId(), "damaged", "CASH_REFUND",
                List.of(new SalesReturnService.Line(dcLine, bd("1"))), TODAY.plusDays(1), null)))
            .isInstanceOf(ApiException.class).hasMessageContaining("future");
        assertThatThrownBy(() -> returns.create(new SalesReturnService.CreateRequest(r.soId(), "damaged", "CASH_REFUND",
                List.of(new SalesReturnService.Line(dcLine, bd("1"))), TODAY, "1200")))
            .isInstanceOf(ApiException.class).hasMessageContaining("bank ledger");

        LocalDate back = TODAY.minusDays(2);
        Map<String, Object> res = returns.create(new SalesReturnService.CreateRequest(r.soId(), "damaged", "CASH_REFUND",
            List.of(new SalesReturnService.Line(dcLine, bd("1"))), back, "1010"));
        Map<String, Object> je = jdbc.queryForMap("""
            select je.entry_date, (select sum(jl.credit) from journal_line jl join account a on a.id = jl.account_id
                                   where jl.journal_id = je.id and a.code = '1010') as bank_credit
            from journal_entry je where je.source_type = 'SALES_RETURN' and je.source_id = ?
        """, res.get("id"));
        assertThat(((java.sql.Date) je.get("entry_date")).toLocalDate()).isEqualTo(back);
        assertThat((BigDecimal) je.get("bank_credit")).isEqualByComparingTo("100");
        assertThat(jdbc.queryForObject("select return_date from sales_return where id = ?", LocalDate.class, res.get("id")))
            .isEqualTo(back);
    }
}
