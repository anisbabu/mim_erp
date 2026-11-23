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
 * The delivery is the invoice: a sales order is CLOSED once everything is delivered and every invoice on it
 * is settled, and goes back to DELIVERED / INVOICED when a receipt match is undone.
 */
@SpringBootTest
@Testcontainers
class SalesPaymentFlowTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired SalesService sales;
    @Autowired SalesReturnService returns;
    @Autowired InventoryService inventory;
    @Autowired LedgerService ledgers;
    @Autowired BillService bills;
    @Autowired JdbcTemplate jdbc;
    @Autowired SoStatusService soStatus;
    @Autowired com.mim.erp.accounting.CashService cash;

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

    private void receive(UUID customer, String amount) {
        cash.voucher(new com.mim.erp.accounting.CashService.VoucherRequest("IN", "CUSTOMER", customer, TODAY, bd(amount), null,
            "CASH", null, null, null, null, null, null, null, null));
    }

    private String status(UUID soId) { return jdbc.queryForObject("select status from sales_order where id = ?", String.class, soId); }
    private Map<String, Object> progress(UUID soId) { return soStatus.progress(List.of(soId)).get(soId); }

    @Test
    void creditOrderClosesWhenFullyPaidAndReopensWhenUnmatched() {
        UUID c = customer();
        var r = order(c, "CREDIT", null, now("10", "100", null));
        assertThat(status(r.soId())).isEqualTo("DELIVERED");
        assertThat(progress(r.soId()).get("payStatus")).isEqualTo("UNPAID");
        assertThat((BigDecimal) progress(r.soId()).get("invoiced")).isEqualByComparingTo("1000");

        receive(c, "400");
        assertThat(progress(r.soId()).get("payStatus")).isEqualTo("PARTIAL");
        assertThat((BigDecimal) progress(r.soId()).get("remaining")).isEqualByComparingTo("600");
        assertThat(status(r.soId())).isEqualTo("DELIVERED");

        receive(c, "600");
        assertThat(progress(r.soId()).get("payStatus")).isEqualTo("PAID");
        assertThat(status(r.soId())).isEqualTo("CLOSED");

        assertThat(soStatus.invoices(c)).singleElement()
            .satisfies(i -> assertThat(i.get("pay_status")).isEqualTo("PAID"));

        UUID item = jdbc.queryForObject("select item_id from customer_invoice where so_id = ?", UUID.class, r.soId());
        bills.unmatch(item);
        assertThat(status(r.soId())).isEqualTo("DELIVERED");
    }

    @Test
    void cashOrderDeliveredInFullClosesAtOnce() {
        UUID c = customer();
        var r = order(c, "CASH", null, now("3", "100", null));
        assertThat(status(r.soId())).isEqualTo("CLOSED");
        assertThat(progress(r.soId()).get("payStatus")).isEqualTo("PAID");
    }

    @Test
    void paidForWhatIsDeliveredButNotAllDeliveredStaysOpen() {
        UUID c = customer();
        var r = order(c, "CREDIT", null, now("4", "100", null), later("6", "100", null));
        receive(c, "400");
        assertThat(progress(r.soId()).get("deliveryStatus")).isEqualTo("PARTIAL");
        assertThat(status(r.soId())).isEqualTo("PARTIALLY_DELIVERED");

        fulfil(r.soId(), "6");
        assertThat(status(r.soId())).isEqualTo("DELIVERED");      // the last 600 is not paid yet
        receive(c, "600");
        assertThat(status(r.soId())).isEqualTo("CLOSED");
    }

    @Test
    void dayEndInvoiceClosesWhenPaidAndReopensAsInvoiced() {
        UUID c = customer();
        sales.issueChallan(new SalesDtos.IssueChallanRequest(shop, c, user, warehouse, List.of(now("5", "100", null)), "test", null));
        var inv = sales.consolidate(new SalesDtos.ConsolidateRequest(c, "CREDIT", null, null, null, bd("20"), null));
        assertThat(status(inv.soId())).isEqualTo("INVOICED");
        assertThat((BigDecimal) progress(inv.soId()).get("invoiced")).isEqualByComparingTo("520");

        receive(c, "520");
        assertThat(status(inv.soId())).isEqualTo("CLOSED");
        UUID item = jdbc.queryForObject("select item_id from customer_invoice where so_id = ? order by amount desc limit 1", UUID.class, inv.soId());
        bills.unmatch(item);
        assertThat(status(inv.soId())).isEqualTo("INVOICED");
    }

    @Test
    void cashDayEndInvoiceClosesAtOnce() {
        UUID c = customer();
        sales.issueChallan(new SalesDtos.IssueChallanRequest(shop, c, user, warehouse, List.of(now("2", "100", null)), "test", null));
        var inv = sales.consolidate(new SalesDtos.ConsolidateRequest(c, "CASH", null, null, null, null, null));
        assertThat(status(inv.soId())).isEqualTo("CLOSED");
    }
}
