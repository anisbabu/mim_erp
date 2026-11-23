package com.mim.erp.purchase;

import com.mim.erp.accounting.BillService;
import com.mim.erp.accounting.CashService;
import com.mim.erp.accounting.ControlService;
import com.mim.erp.accounting.Payment;
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

/**
 * 3-way match: PO -> GRN (stock, 2010) -> supplier bill (payable) -> payment.
 * The PO closes only once everything is received, billed and paid.
 */
@SpringBootTest
@Testcontainers
class SupplierBillFlowTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired PurchaseService purchase;
    @Autowired PurchaseReturnService returns;
    @Autowired SupplierBillService supplierBills;
    @Autowired PoStatusService poStatus;
    @Autowired CashService cash;
    @Autowired BillService bills;
    @Autowired ControlService controls;
    @Autowired JdbcTemplate jdbc;

    private static final LocalDate TODAY = LocalDate.now();
    private UUID supplier, warehouse, product;

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
        supplier = UUID.randomUUID();
        jdbc.update("insert into supplier (id, code, name, credit_days) values (?,?,?,15)", supplier, "S" + k, "Bill supplier");
        warehouse = UUID.randomUUID();
        jdbc.update("insert into warehouse (id, code, name) values (?,?,?)", warehouse, "W" + k, "TEST WH");
        product = UUID.randomUUID();
        jdbc.update("insert into product (id, sku, name, type) values (?,?,?, 'HARDWARE')", product, "P" + k, "Board");
        UUID user = UUID.randomUUID();
        jdbc.update("insert into app_user (id, username, password_hash, role) values (?,?,?, 'ADMIN')", user, "t" + k, "x");
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
            new AuthPrincipal(user, "t" + k, "ADMIN", "Test"), null, List.of()));
    }

    @AfterEach
    void clearAuth() { SecurityContextHolder.clearContext(); }

    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    /** PO: 10 x @ 100 = 1000. */
    private PurchaseOrder po() {
        return purchase.createPo(new PurchaseDtos.CreatePoRequest(supplier, null, null, List.of(
            new PurchaseDtos.CreatePoLine(product, bd("10"), bd("100"), false))));
    }

    private GoodsReceipt receive(PurchaseOrder po, String qty) {
        return purchase.receive(po.getId(), new PurchaseDtos.ReceiveRequest(warehouse,
            List.of(new PurchaseDtos.ReceiveLine(po.getLines().get(0).getId(), bd(qty), null, null)),
            null, null, null, null, null, null, null, null));
    }

    private Map<String, Object> bill(GoodsReceipt g, String invoice, String amount) {
        return supplierBills.create(new SupplierBillService.CreateRequest(invoice, TODAY, null, null,
            List.of(new SupplierBillService.Line(g.getId(), amount == null ? null : bd(amount)))));
    }

    private Payment pay(String amount) {
        return cash.voucher(new CashService.VoucherRequest("OUT", "SUPPLIER", supplier, TODAY, bd(amount), null, "CASH",
            null, null, null, null, null, null, null, null));
    }

    private BigDecimal owed() {
        return jdbc.queryForObject("""
            select coalesce(sum(jl.credit - jl.debit), 0) from journal_line jl join account a on a.id = jl.account_id
            where a.party_type = 'SUPPLIER' and a.party_id = ?
        """, BigDecimal.class, supplier);
    }

    /** 2010 movement on this test's receipts and bills only. */
    private BigDecimal grni(PurchaseOrder po) {
        return jdbc.queryForObject("""
            select coalesce(sum(jl.credit - jl.debit), 0) from journal_line jl join account a on a.id = jl.account_id and a.code = '2010'
            join journal_entry je on je.id = jl.journal_id
            where (je.source_type = 'GRN' and je.source_id in (select id from goods_receipt where po_id = ?))
               or (je.source_type = 'SUPPLIER_BILL' and je.source_id in (select id from supplier_bill where po_id = ?))
               or (je.source_type = 'PURCHASE_RETURN' and je.source_id in
                     (select r.id from purchase_return r join goods_receipt g on g.id = r.grn_id where g.po_id = ?))
               or je.reversal_of in (select journal_id from supplier_bill where po_id = ?)
        """, BigDecimal.class, po.getId(), po.getId(), po.getId(), po.getId());
    }

    private String status(PurchaseOrder po) {
        return jdbc.queryForObject("select status from purchase_order where id = ?", String.class, po.getId());
    }

    private Map<String, Object> progress(PurchaseOrder po) { return poStatus.progress(List.of(po.getId())).get(po.getId()); }

    @Test
    void receiveBillPayInPartsThenThePoCloses() {
        PurchaseOrder po = po();
        GoodsReceipt g1 = receive(po, "6");
        assertThat(grni(po)).isEqualByComparingTo("600");
        assertThat(owed()).isEqualByComparingTo("0");
        assertThat(status(po)).isEqualTo("OPEN");
        assertThat(progress(po).get("billStatus")).isEqualTo("NONE");

        Map<String, Object> b1 = bill(g1, "INV-1", null);
        assertThat(grni(po)).isEqualByComparingTo("0");
        assertThat(owed()).isEqualByComparingTo("600");
        assertThat(((java.sql.Date) jdbc.queryForObject("select due_date from supplier_bill where id = ?", java.sql.Date.class, b1.get("id")))
            .toLocalDate()).isEqualTo(TODAY.plusDays(15));
        assertThatThrownBy(() -> bill(g1, "INV-1b", null)).isInstanceOf(ApiException.class).hasMessageContaining("already billed");

        pay("400");
        Map<String, Object> p = progress(po);
        assertThat(p.get("payStatus")).isEqualTo("PARTIAL");
        assertThat((BigDecimal) p.get("paid")).isEqualByComparingTo("400");
        assertThat((BigDecimal) p.get("remaining")).isEqualByComparingTo("200");
        assertThat(p.get("receiptStatus")).isEqualTo("PARTIAL");

        GoodsReceipt g2 = receive(po, "4");
        assertThat(progress(po).get("receiptStatus")).isEqualTo("DONE");
        assertThat(progress(po).get("billStatus")).isEqualTo("PARTIAL");
        assertThat(status(po)).isEqualTo("OPEN");                // all received, not all billed
        assertThat(purchase.openOrders()).noneMatch(o -> o.getId().equals(po.getId()));   // nothing left to receive

        bill(g2, "INV-2", null);
        assertThat(status(po)).isEqualTo("OPEN");                // billed, not paid
        pay("600");
        assertThat(progress(po).get("payStatus")).isEqualTo("PAID");
        assertThat(status(po)).isEqualTo("CLOSED");

        // undoing a payment match opens the PO again
        UUID item = jdbc.queryForObject("""
            select i.id from party_item i where i.source_type = 'SUPPLIER_BILL' and i.source_id = ?
        """, UUID.class, b1.get("id"));
        bills.unmatch(item);
        assertThat(status(po)).isEqualTo("OPEN");
    }

    @Test
    void billedAboveTheReceiptPostsAPriceVariance() {
        PurchaseOrder po = po();
        GoodsReceipt g = receive(po, "6");
        Map<String, Object> b = bill(g, "INV-V", "610");
        assertThat((BigDecimal) b.get("variance")).isEqualByComparingTo("10");
        assertThat(grni(po)).isEqualByComparingTo("0");
        assertThat(owed()).isEqualByComparingTo("610");
        BigDecimal variance = jdbc.queryForObject("""
            select sum(jl.debit - jl.credit) from journal_line jl join account a on a.id = jl.account_id and a.code = '5000'
            join journal_entry je on je.id = jl.journal_id where je.source_type = 'SUPPLIER_BILL' and je.source_id = ?
        """, BigDecimal.class, b.get("id"));
        assertThat(variance).isEqualByComparingTo("10");
    }

    @Test
    void returnBeforeTheBillLowersWhatIsToBeBilled() {
        PurchaseOrder po = po();
        GoodsReceipt g = receive(po, "10");
        UUID grnLine = jdbc.queryForObject("select id from grn_line where grn_id = ?", UUID.class, g.getId());
        returns.create(new PurchaseReturnService.CreateRequest(g.getId(), "damaged", "DEBIT_NOTE", TODAY, null,
            List.of(new PurchaseReturnService.Line(grnLine, bd("2")))));
        assertThat(owed()).isEqualByComparingTo("0");             // the supplier is not touched
        assertThat(grni(po)).isEqualByComparingTo("800");
        assertThat(supplierBills.unbilled(supplier)).singleElement()
            .satisfies(r -> assertThat((BigDecimal) r.get("to_bill")).isEqualByComparingTo("800"));

        bill(g, "INV-K", null);
        assertThat(owed()).isEqualByComparingTo("800");
        assertThat(grni(po)).isEqualByComparingTo("0");
    }

    @Test
    void returnAfterTheBillIsADebitNoteAgainstThatBill() {
        PurchaseOrder po = po();
        GoodsReceipt g = receive(po, "10");
        bill(g, "INV-D", null);
        UUID grnLine = jdbc.queryForObject("select id from grn_line where grn_id = ?", UUID.class, g.getId());
        returns.create(new PurchaseReturnService.CreateRequest(g.getId(), "damaged", "DEBIT_NOTE", TODAY, null,
            List.of(new PurchaseReturnService.Line(grnLine, bd("3")))));
        assertThat(owed()).isEqualByComparingTo("700");
        assertThat((BigDecimal) progress(po).get("remaining")).isEqualByComparingTo("700");
        pay("700");
        assertThat(status(po)).isEqualTo("CLOSED");
    }

    @Test
    void anUnpaidBillCanBeCancelledAndBilledAgain() {
        PurchaseOrder po = po();
        GoodsReceipt g = receive(po, "5");
        Map<String, Object> b = bill(g, "INV-X", null);
        assertThatThrownBy(() -> supplierBills.cancel((UUID) b.get("id"), new SupplierBillService.CancelRequest(" ")))
            .isInstanceOf(ApiException.class).hasMessageContaining("reason");
        supplierBills.cancel((UUID) b.get("id"), new SupplierBillService.CancelRequest("wrong invoice"));
        assertThat(owed()).isEqualByComparingTo("0");
        assertThat(grni(po)).isEqualByComparingTo("500");
        bill(g, "INV-Y", null);
        assertThat(owed()).isEqualByComparingTo("500");

        pay("100");
        UUID b2 = jdbc.queryForObject("select id from supplier_bill where supplier_invoice_no = 'INV-Y' and po_id = ?", UUID.class, po.getId());
        assertThatThrownBy(() -> supplierBills.cancel(b2, new SupplierBillService.CancelRequest("oops")))
            .isInstanceOf(ApiException.class).hasMessageContaining("matched");
    }

    @Test
    void billNoOnTheReceiveFormPostsTheBillWithTheGoods() {
        PurchaseOrder po = po();
        purchase.receive(po.getId(), new PurchaseDtos.ReceiveRequest(warehouse,
            List.of(new PurchaseDtos.ReceiveLine(po.getLines().get(0).getId(), bd("10"), null, null)),
            "INV-NOW", TODAY, null, null, null, null, null, null));
        assertThat(owed()).isEqualByComparingTo("1000");
        assertThat(grni(po)).isEqualByComparingTo("0");
        assertThat(progress(po).get("billStatus")).isEqualTo("BILLED");

        PurchaseOrder po2 = po();
        purchase.receive(po2.getId(), new PurchaseDtos.ReceiveRequest(warehouse,
            List.of(new PurchaseDtos.ReceiveLine(po2.getLines().get(0).getId(), bd("10"), null, null)),
            "INV-LATER", TODAY, null, null, null, null, null, null, false));   // bill keyed, not posted yet
        assertThat(grni(po2)).isEqualByComparingTo("1000");
    }

    @Test
    void goodsReceivedNotBilledControlAgrees() {
        PurchaseOrder po = po();
        receive(po, "3");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> checks = (List<Map<String, Object>>) controls.checks().get("checks");
        assertThat(checks).filteredOn(c -> "GRNI".equals(c.get("code"))).singleElement()
            .satisfies(c -> assertThat(c.get("status")).isEqualTo("OK"));
    }
}
