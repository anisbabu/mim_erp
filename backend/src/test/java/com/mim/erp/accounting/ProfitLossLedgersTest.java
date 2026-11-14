package com.mim.erp.accounting;

import com.mim.erp.auth.AuthPrincipal;
import com.mim.erp.inventory.InventoryService;
import com.mim.erp.sales.SalesDtos;
import com.mim.erp.sales.SalesReturnService;
import com.mim.erp.sales.SalesService;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Sales are booked at list price with trade discount and transport on their own ledgers, a return gives
 * back its share of the discount, and a bounced cheque's bank fee lands on Bank Charges or the customer.
 */
@SpringBootTest
@Testcontainers
class ProfitLossLedgersTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired SalesService sales;
    @Autowired SalesReturnService salesReturns;
    @Autowired ChequeService cheques;
    @Autowired LedgerService ledgers;
    @Autowired InventoryService inventory;
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
        jdbc.update("insert into shop (id, code, name, primary_line) values (?,?,?, 'HARDWARE')", shop, "SH" + k, "Shop");
        warehouse = UUID.randomUUID();
        jdbc.update("insert into warehouse (id, code, name) values (?,?,?)", warehouse, "W" + k, "WH");
        product = UUID.randomUUID();
        jdbc.update("insert into product (id, sku, name, type) values (?,?,?, 'HARDWARE')", product, "P" + k, "Lock");
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
            new AuthPrincipal(user, "t" + k, "ADMIN", "Test"), null, List.of()));
    }

    @AfterEach
    void tearDown() { SecurityContextHolder.clearContext(); }

    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    private BigDecimal net(String code, String sourceType, UUID sourceId) {
        return jdbc.queryForObject("""
            select coalesce(sum(jl.credit - jl.debit), 0) from journal_line jl join journal_entry je on je.id = jl.journal_id
            join account a on a.id = jl.account_id where a.code = ? and je.source_type = ? and je.source_id = ?
        """, BigDecimal.class, code, sourceType, sourceId);
    }

    private UUID customer() {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into customer (id, code, name, type, credit_limit) values (?,?,?, 'PARTY', 1000000)",
            id, "C" + id.toString().substring(0, 8), "Customer");
        return id;
    }

    @Test
    void discountAndTransportGetTheirOwnLedgersAndAReturnGivesTheDiscountBack() {
        inventory.addLayer(product, warehouse, null, bd("100"), bd("50"), TODAY, TODAY, "OPENING", null);
        UUID c = customer();
        // 10 x 100 = 1000 list, 80 discount, 120 transport -> customer owes 1040
        var r = sales.createOrder(new SalesDtos.CreateOrderRequest(shop, c, user, "CREDIT", List.of(
                new SalesDtos.Allocation(product, warehouse, bd("10"), bd("100"), bd("80"))),
            null, "t", "t", bd("120"), null, null));

        assertThat(net("4000", "SALES_DELIVERY", r.soId())).isEqualByComparingTo("1000");
        assertThat(net("4010", "SALES_DELIVERY", r.soId())).isEqualByComparingTo("-80");
        assertThat(net("4400", "SALES_DELIVERY", r.soId())).isEqualByComparingTo("120");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("1040");

        UUID dcLine = jdbc.queryForObject("""
            select dl.id from dc_line dl join delivery_challan dc on dc.id = dl.dc_id where dc.so_id = ?
        """, UUID.class, r.soId());
        var ret = salesReturns.create(new SalesReturnService.CreateRequest(r.soId(), "faulty", "CREDIT_NOTE",
            List.of(new SalesReturnService.Line(dcLine, bd("2"))), TODAY, null));
        UUID id = (UUID) ret.get("id");
        assertThat(net("4000", "SALES_RETURN", id)).isEqualByComparingTo("-200");   // 2 x 100 list
        assertThat(net("4010", "SALES_RETURN", id)).isEqualByComparingTo("16");     // 2/10 of the 80 discount
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("856");         // 1040 - 184
    }

    @Test
    void bouncedChequeFeeGoesToBankChargesOrToTheCustomer() {
        UUID c = customer();
        Cheque a = cheques.record(c, bd("500"), "CHQ-A-" + c.toString().substring(0, 6), "Bank", "Main", TODAY, null);
        cheques.markCashed(a.getId(), null);
        a = cheques.post(a.getId(), null, null);
        cheques.markBounced(a.getId(), "INSUFFICIENT_FUNDS", null, bd("115"), false);
        assertThat(net("5600", "CHEQUE_CHARGE", a.getId())).isEqualByComparingTo("-115");
        assertThat(net(a.getDepositAccount(), "CHEQUE_CHARGE", a.getId())).isEqualByComparingTo("115");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("0");           // receipt undone, fee is ours

        Cheque b = cheques.record(c, bd("300"), "CHQ-B-" + c.toString().substring(0, 6), "Bank", "Main", TODAY, null);
        cheques.markBounced(b.getId(), "SIGNATURE_MISMATCH", null, bd("50"), true);
        assertThat(net("5600", "CHEQUE_CHARGE", b.getId())).isEqualByComparingTo("0");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("50");          // customer bears the fee
        assertThat(jdbc.queryForObject("select bounce_charge from cheque where id = ?", BigDecimal.class, b.getId()))
            .isEqualByComparingTo("50");
    }
}
