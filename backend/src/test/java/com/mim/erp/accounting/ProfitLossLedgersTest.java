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
import java.util.Map;
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
    @Autowired AccountingService accounting;
    @Autowired ReclassService reclass;
    @Autowired ReportService reports;
    @Autowired ContraService contra;
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

    @Test
    void bouncingAPostedChequeReopensTheBillItPaid() {
        UUID c = customer();
        String ar = ledgers.customerLedger(c).getCode();
        accounting.post(TODAY.minusDays(3), "bill for bounce", "TEST", UUID.randomUUID(),
            List.of(AccountingService.Leg.debit(ar, bd("500")), AccountingService.Leg.credit("4000", bd("500"))));
        UUID bill = jdbc.queryForObject("""
            select i.id from party_item i join journal_entry je on je.id = i.journal_id where je.narration = 'bill for bounce'
        """, UUID.class);

        Cheque q = cheques.record(c, bd("500"), "CHQ-X-" + c.toString().substring(0, 6), "Bank", "Main", TODAY, null);
        cheques.markCashed(q.getId(), null);
        q = cheques.post(q.getId(), null, null);
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("0");
        assertThat(openOf(bill)).isEqualByComparingTo("0");                       // cheque settled the bill

        cheques.markBounced(q.getId(), "INSUFFICIENT_FUNDS", null);
        assertThat(net(ar, "CHEQUE_BOUNCE", q.getId())).isEqualByComparingTo("-500");          // customer debited again
        assertThat(net(q.getDepositAccount(), "CHEQUE_BOUNCE", q.getId())).isEqualByComparingTo("500");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("500");
        assertThat(openOf(bill)).isEqualByComparingTo("500");                     // the bill is unpaid again
        assertThat(jdbc.queryForObject("""
            select count(*) from party_item i join journal_entry je on je.id = i.journal_id
            where je.source_type = 'CHEQUE_BOUNCE' and je.source_id = ?
              and i.amount - coalesce((select sum(x.amount) from bill_allocation x where x.bill_id = i.id or x.credit_id = i.id), 0) > 0
        """, Integer.class, q.getId())).isZero();                                // bounce item paired off with the receipt

        // a bounce before posting moves no money, and a resubmitted cheque goes back to pending
        Cheque p = cheques.record(c, bd("200"), "CHQ-Y-" + c.toString().substring(0, 6), "Bank", "Main", TODAY, null);
        cheques.markBounced(p.getId(), "SIGNATURE_MISMATCH", null);
        assertThat(jdbc.queryForObject("select count(*) from journal_entry where source_id = ?", Integer.class, p.getId())).isZero();
        assertThat(cheques.resubmit(p.getId(), TODAY.plusDays(7), null).getStatus()).isEqualTo("PENDING");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("500");
    }

    private BigDecimal openOf(UUID item) {
        return jdbc.queryForObject("""
            select i.amount - coalesce((select sum(x.amount) from bill_allocation x where x.bill_id = i.id or x.credit_id = i.id), 0)
            from party_item i where i.id = ?
        """, BigDecimal.class, item);
    }

    @Test
    void oldSalesAreSplitOnceAndDiscountIsReportedBySalesperson() {
        inventory.addLayer(product, warehouse, null, bd("100"), bd("50"), TODAY, TODAY, "OPENING", null);
        UUID c = customer();
        var r = sales.createOrder(new SalesDtos.CreateOrderRequest(shop, c, user, "CREDIT", List.of(
                new SalesDtos.Allocation(product, warehouse, bd("10"), bd("100"), bd("80"))),
            null, "t", "t", bd("120"), null, null));
        // make it look like a sale booked before 4010 / 4400 existed: everything on Sales 4000
        // posted lines can't be edited, so fold the split back into Sales with a journal of the same source
        accounting.post(TODAY, "legacy", "SALES_DELIVERY", r.soId(), List.of(
            AccountingService.Leg.debit("4400", bd("120")), AccountingService.Leg.credit("4000", bd("120")),
            AccountingService.Leg.debit("4000", bd("80")), AccountingService.Leg.credit("4010", bd("80"))));
        assertThat(net("4000", "SALES_DELIVERY", r.soId())).isEqualByComparingTo("1040");

        Map<String, Object> first = reclass.reclassifySales();
        assertThat(net("4000", "RECLASS", r.soId())).isEqualByComparingTo("-40");    // -120 transport out, +80 discount in
        assertThat(net("4400", "RECLASS", r.soId())).isEqualByComparingTo("120");
        assertThat(net("4010", "RECLASS", r.soId())).isEqualByComparingTo("-80");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("1040");          // party untouched
        assertThat((List<?>) first.get("documents")).isNotEmpty();

        reclass.reclassifySales();                                                    // second run changes nothing
        assertThat(jdbc.queryForObject("select count(*) from journal_entry where source_type = 'RECLASS' and source_id = ?",
            Integer.class, r.soId())).isEqualTo(1);

        Map<String, Object> rep = reports.discountBySalesperson(TODAY.minusDays(1), TODAY);
        BigDecimal mine = ((List<Map<String, Object>>) rep.get("rows")).stream()
            .filter(x -> user.equals(x.get("user_id"))).map(x -> (BigDecimal) x.get("discount")).findFirst().orElseThrow();
        assertThat(mine).isEqualByComparingTo("80");
    }

    @Test
    void contraVoucherPrints() {
        Map<String, Object> cv = contra.post(new ContraService.ContraRequest(TODAY, "1000", "1010", bd("750"), "slip 1", null), null, null);
        byte[] en = contra.pdf((UUID) cv.get("id"), false), bn = contra.pdf((UUID) cv.get("id"), true);
        assertThat(new String(en, 0, 4)).isEqualTo("%PDF");
        assertThat(new String(bn, 0, 4)).isEqualTo("%PDF");
    }
}
