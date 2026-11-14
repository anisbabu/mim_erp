package com.mim.erp.accounting;

import com.mim.erp.auth.AuthPrincipal;
import com.mim.erp.inventory.InventoryService;
import com.mim.erp.purchase.GoodsReceipt;
import com.mim.erp.purchase.PurchaseDtos;
import com.mim.erp.purchase.PurchaseOrder;
import com.mim.erp.purchase.PurchaseReturnService;
import com.mim.erp.purchase.PurchaseService;
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
 * VAT inside selling prices goes to Output VAT, input VAT on a supplier VAT invoice to Input VAT
 * (not stock cost), returns reverse both, and tax deducted at source on vouchers lands on the
 * AIT / VDS ledgers while settling the party in full.
 */
@SpringBootTest
@Testcontainers
class VatAitTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired SalesService sales;
    @Autowired SalesReturnService salesReturns;
    @Autowired PurchaseService purchase;
    @Autowired PurchaseReturnService purchaseReturns;
    @Autowired CashService cash;
    @Autowired VatService vat;
    @Autowired LedgerService ledgers;
    @Autowired InventoryService inventory;
    @Autowired JdbcTemplate jdbc;

    private static final LocalDate TODAY = LocalDate.now();
    private UUID shop, warehouse, product15, productDefault, user;

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
        vat.save(true, new BigDecimal("5"));
        String k = UUID.randomUUID().toString().substring(0, 8);
        user = UUID.randomUUID();
        jdbc.update("insert into app_user (id, username, password_hash, role) values (?,?,?, 'ADMIN')", user, "t" + k, "x");
        shop = UUID.randomUUID();
        jdbc.update("insert into shop (id, code, name, primary_line) values (?,?,?, 'HARDWARE')", shop, "SH" + k, "Shop");
        warehouse = UUID.randomUUID();
        jdbc.update("insert into warehouse (id, code, name) values (?,?,?)", warehouse, "W" + k, "WH");
        product15 = UUID.randomUUID();
        productDefault = UUID.randomUUID();
        jdbc.update("insert into product (id, sku, name, type, tax_rate) values (?,?,?, 'HARDWARE', 15)", product15, "A" + k, "Lock");
        jdbc.update("insert into product (id, sku, name, type) values (?,?,?, 'HARDWARE')", productDefault, "B" + k, "Hinge");
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
            new AuthPrincipal(user, "t" + k, "ADMIN", "Test"), null, List.of()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        vat.save(false, new BigDecimal("5"));
    }

    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    /** Net movement (credit - debit) on a ledger for one journal source. */
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
    void saleSplitsVatOutOfThePriceAndAReturnReversesIt() {
        inventory.addLayer(product15, warehouse, null, bd("100"), bd("50"), TODAY, TODAY, "OPENING", null);
        inventory.addLayer(productDefault, warehouse, null, bd("100"), bd("50"), TODAY, TODAY, "OPENING", null);
        UUID c = customer();
        var r = sales.createOrder(new SalesDtos.CreateOrderRequest(shop, c, user, "CREDIT", List.of(
                new SalesDtos.Allocation(product15, warehouse, bd("1"), bd("115"), null),
                new SalesDtos.Allocation(productDefault, warehouse, bd("1"), bd("105"), null)),
            null, "t", "t", null, null, null));

        assertThat(net("4000", "SALES_DELIVERY", r.soId())).isEqualByComparingTo("200");
        assertThat(net("2100", "SALES_DELIVERY", r.soId())).isEqualByComparingTo("20");   // 15 + 5
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("220");

        UUID dcLine = jdbc.queryForObject("""
            select dl.id from dc_line dl join delivery_challan dc on dc.id = dl.dc_id where dc.so_id = ? and dl.product_id = ?
        """, UUID.class, r.soId(), product15);
        var ret = salesReturns.create(new SalesReturnService.CreateRequest(r.soId(), "faulty", "CREDIT_NOTE",
            List.of(new SalesReturnService.Line(dcLine, bd("1"))), TODAY, null));
        assertThat(net("2100", "SALES_RETURN", (UUID) ret.get("id"))).isEqualByComparingTo("-15");
        assertThat(net("4000", "SALES_RETURN", (UUID) ret.get("id"))).isEqualByComparingTo("-100");
    }

    @Test
    void inputVatIsClaimedNotStockedAndReturnsGiveItBack() {
        UUID s = UUID.randomUUID();
        jdbc.update("insert into supplier (id, code, name) values (?,?,?)", s, "S" + s.toString().substring(0, 8), "Supplier");
        PurchaseOrder po = purchase.createPo(new PurchaseDtos.CreatePoRequest(s, null, null,
            List.of(new PurchaseDtos.CreatePoLine(productDefault, bd("10"), bd("115"), false))));
        GoodsReceipt g = purchase.receive(po.getId(), new PurchaseDtos.ReceiveRequest(warehouse,
            List.of(new PurchaseDtos.ReceiveLine(po.getLines().get(0).getId(), bd("10"), null, null)),
            "VAT-INV-1", TODAY, null, null, null, null, bd("150")));   // 1150 incl. 150 VAT

        assertThat(net("1450", "GRN", g.getId())).isEqualByComparingTo("-150");      // debit Input VAT
        assertThat(net("1200", "GRN", g.getId())).isEqualByComparingTo("-1000");     // stock ex VAT
        assertThat(jdbc.queryForObject("select sl.unit_cost from stock_layer sl join grn_line gl on gl.id = sl.grn_line_id where gl.grn_id = ?",
            BigDecimal.class, g.getId())).isEqualByComparingTo("100");

        UUID grnLine = jdbc.queryForObject("select id from grn_line where grn_id = ?", UUID.class, g.getId());
        var r = purchaseReturns.create(new PurchaseReturnService.CreateRequest(g.getId(), "damaged", "DEBIT_NOTE",
            TODAY, null, List.of(new PurchaseReturnService.Line(grnLine, bd("2")))));
        UUID id = (UUID) r.get("id");
        assertThat(net("1450", "PURCHASE_RETURN", id)).isEqualByComparingTo("30");    // credit back 2/10 of 150
        assertThat(net("1200", "PURCHASE_RETURN", id)).isEqualByComparingTo("200");
        assertThat(net("5000", "PURCHASE_RETURN", id)).isEqualByComparingTo("0");     // 230 claimed = 200 stock + 30 VAT
    }

    @Test
    void taxDeductedAtSourceSettlesThePartyInFull() {
        UUID s = UUID.randomUUID();
        jdbc.update("insert into supplier (id, code, name) values (?,?,?)", s, "S" + s.toString().substring(0, 8), "Supplier");
        Payment pv = cash.voucher(new CashService.VoucherRequest("OUT", "SUPPLIER", s, TODAY, bd("920"), null, "CASH",
            null, null, null, null, null, null, bd("50"), bd("30")));
        assertThat(net("2120", "PAYMENT", pv.getId())).isEqualByComparingTo("50");
        assertThat(net("2110", "PAYMENT", pv.getId())).isEqualByComparingTo("30");
        assertThat(net(ledgers.supplierLedger(s).getCode(), "PAYMENT", pv.getId())).isEqualByComparingTo("-1000");

        UUID c = customer();
        Payment rv = cash.voucher(new CashService.VoucherRequest("IN", "CUSTOMER", c, TODAY, bd("970"), null, "CASH",
            null, null, null, null, null, null, bd("30"), null));
        assertThat(net("1460", "RECEIPT", rv.getId())).isEqualByComparingTo("-30");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("-1000");
    }
}
