package com.mim.erp.purchase;

import com.mim.erp.accounting.BillService;
import com.mim.erp.accounting.LedgerService;
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
 * Supplier bill on the goods receipt (bill no., due date from supplier terms, approved price change,
 * freight as landed cost) and purchase returns settled by debit note or refund.
 */
@SpringBootTest
@Testcontainers
class PurchaseBillTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired PurchaseService purchase;
    @Autowired PurchaseReturnService returns;
    @Autowired LedgerService ledgers;
    @Autowired BillService bills;
    @Autowired JdbcTemplate jdbc;

    private static final LocalDate TODAY = LocalDate.now();
    private UUID supplier, warehouse, productA, productB;

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
        jdbc.update("insert into supplier (id, code, name, credit_days) values (?,?,?,30)", supplier, "S" + k, "Test supplier");
        warehouse = UUID.randomUUID();
        jdbc.update("insert into warehouse (id, code, name) values (?,?,?)", warehouse, "W" + k, "TEST WH");
        productA = UUID.randomUUID();
        productB = UUID.randomUUID();
        jdbc.update("insert into product (id, sku, name, type) values (?,?,?, 'HARDWARE')", productA, "A" + k, "Hinge");
        jdbc.update("insert into product (id, sku, name, type) values (?,?,?, 'HARDWARE')", productB, "B" + k, "Handle");
        UUID user = UUID.randomUUID();
        jdbc.update("insert into app_user (id, username, password_hash, role) values (?,?,?, 'ADMIN')", user, "t" + k, "x");
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
            new AuthPrincipal(user, "t" + k, "ADMIN", "Test"), null, List.of()));
    }

    @AfterEach
    void clearAuth() { SecurityContextHolder.clearContext(); }

    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    /** PO: 10 x A @ 100, 10 x B @ 50. */
    private PurchaseOrder po() {
        return purchase.createPo(new PurchaseDtos.CreatePoRequest(supplier, null, null, List.of(
            new PurchaseDtos.CreatePoLine(productA, bd("10"), bd("100"), false),
            new PurchaseDtos.CreatePoLine(productB, bd("10"), bd("50"), false))));
    }

    private UUID line(PurchaseOrder po, UUID product) {
        return po.getLines().stream().filter(l -> l.getProductId().equals(product)).findFirst().orElseThrow().getId();
    }

    private BigDecimal supplierBalance() {
        return jdbc.queryForObject("""
            select coalesce(sum(jl.credit - jl.debit), 0) from journal_line jl join account a on a.id = jl.account_id
            where a.party_type = 'SUPPLIER' and a.party_id = ?
        """, BigDecimal.class, supplier);
    }

    private BigDecimal layerCost(UUID grnId, UUID product) {
        return jdbc.queryForObject("""
            select sl.unit_cost from stock_layer sl join grn_line gl on gl.id = sl.grn_line_id
            where gl.grn_id = ? and gl.received_product_id = ?
        """, BigDecimal.class, grnId, product);
    }

    @Test
    void billWithFreightAndApprovedPriceBecomesLandedCostAndDueBySupplierTerms() {
        PurchaseOrder po = po();
        LocalDate billDate = TODAY.minusDays(3);
        var lines = List.of(
            new PurchaseDtos.ReceiveLine(line(po, productA), bd("10"), null, bd("110")),   // billed above PO
            new PurchaseDtos.ReceiveLine(line(po, productB), bd("10"), null, null));

        assertThatThrownBy(() -> purchase.receive(po.getId(), new PurchaseDtos.ReceiveRequest(warehouse, lines,
                "INV-77", billDate, null, bd("160"), true, null, null)))
            .isInstanceOf(ApiException.class).hasMessageContaining("approved");

        GoodsReceipt g = purchase.receive(po.getId(), new PurchaseDtos.ReceiveRequest(warehouse, lines,
            "INV-77", billDate, null, bd("160"), true, "Manager", null));

        // goods 1100 + 500 = 1600, freight 160 on the bill: supplier owed 1760, stock carries 1760
        assertThat(supplierBalance()).isEqualByComparingTo("1760");
        assertThat(layerCost(g.getId(), productA)).isEqualByComparingTo("121");   // 110 + 110/1600*160 per unit
        assertThat(layerCost(g.getId(), productB)).isEqualByComparingTo("55");
        Map<String, Object> bill = jdbc.queryForMap(
            "select doc_no, due_date from party_item where source_type = 'GRN' and source_id = ?", g.getId());
        assertThat((String) bill.get("doc_no")).startsWith("INV-77");
        assertThat(((java.sql.Date) bill.get("due_date")).toLocalDate()).isEqualTo(billDate.plusDays(30));
    }

    @Test
    void freightPaidToCarrierInCashIsNotOwedToSupplier() {
        PurchaseOrder po = po();
        purchase.receive(po.getId(), new PurchaseDtos.ReceiveRequest(warehouse,
            List.of(new PurchaseDtos.ReceiveLine(line(po, productA), bd("10"), null, null)),
            null, null, null, bd("100"), false, null, null));
        assertThat(supplierBalance()).isEqualByComparingTo("1000");
    }

    @Test
    void billKeyedLaterRetagsTheOpenBill() {
        PurchaseOrder po = po();
        GoodsReceipt g = purchase.receive(po.getId(), new PurchaseDtos.ReceiveRequest(warehouse,
            List.of(new PurchaseDtos.ReceiveLine(line(po, productA), bd("5"), null, null)), null, null, null, null, null, null, null));
        purchase.updateBill(g.getId(), new PurchaseDtos.BillDetails("SUP-INV-9", TODAY.minusDays(1), TODAY.plusDays(45)));
        Map<String, Object> bill = jdbc.queryForMap(
            "select doc_no, due_date from party_item where source_type = 'GRN' and source_id = ?", g.getId());
        assertThat((String) bill.get("doc_no")).startsWith("SUP-INV-9");
        assertThat(((java.sql.Date) bill.get("due_date")).toLocalDate()).isEqualTo(TODAY.plusDays(45));
    }

    @Test
    void debitNoteReducesWhatWeOweAndSettlesItsOwnBill() {
        PurchaseOrder po = po();
        GoodsReceipt g = purchase.receive(po.getId(), new PurchaseDtos.ReceiveRequest(warehouse, List.of(
                new PurchaseDtos.ReceiveLine(line(po, productA), bd("10"), null, null)),
            "INV-1", TODAY, null, bd("100"), true, null, null));       // owed 1100, landed 110/unit
        UUID grnLine = jdbc.queryForObject("select id from grn_line where grn_id = ?", UUID.class, g.getId());

        assertThatThrownBy(() -> returns.create(new PurchaseReturnService.CreateRequest(g.getId(), "damaged", "DEBIT_NOTE",
                TODAY, null, List.of(new PurchaseReturnService.Line(grnLine, bd("11"))))))
            .isInstanceOf(ApiException.class).hasMessageContaining("can go back");

        Map<String, Object> r = returns.create(new PurchaseReturnService.CreateRequest(g.getId(), "damaged", "DEBIT_NOTE",
            TODAY, null, List.of(new PurchaseReturnService.Line(grnLine, bd("2")))));
        // supplier credits the billed 2 x 100; stock leaves at landed 2 x 110; the 20 freight not refunded is a cost
        assertThat((BigDecimal) r.get("goodsValue")).isEqualByComparingTo("200");
        assertThat((BigDecimal) r.get("costValue")).isEqualByComparingTo("220");
        assertThat(supplierBalance()).isEqualByComparingTo("900");
        assertThat(jdbc.queryForObject("select qty_remaining from stock_layer where grn_line_id = ?", BigDecimal.class, grnLine))
            .isEqualByComparingTo("8");
        Map<String, Object> open = bills.openItems("SUPPLIER", supplier);
        assertThat((BigDecimal) open.get("balance")).isEqualByComparingTo("900");
        assertThat((List<?>) open.get("advances")).isEmpty();
        assertThat((List<?>) open.get("bills")).hasSize(1);
    }

    @Test
    void refundFromSupplierGoesToTheChosenBank() {
        PurchaseOrder po = po();
        GoodsReceipt g = purchase.receive(po.getId(), new PurchaseDtos.ReceiveRequest(warehouse, List.of(
                new PurchaseDtos.ReceiveLine(line(po, productB), bd("10"), null, null)), null, null, null, null, null, null, null));
        UUID grnLine = jdbc.queryForObject("select id from grn_line where grn_id = ?", UUID.class, g.getId());
        Map<String, Object> r = returns.create(new PurchaseReturnService.CreateRequest(g.getId(), "wrong colour", "CASH_REFUND",
            TODAY, "1010", List.of(new PurchaseReturnService.Line(grnLine, bd("4")))));
        BigDecimal bank = jdbc.queryForObject("""
            select sum(jl.debit) from journal_line jl join journal_entry je on je.id = jl.journal_id join account a on a.id = jl.account_id
            where je.source_type = 'PURCHASE_RETURN' and je.source_id = ? and a.code = '1010'
        """, BigDecimal.class, r.get("id"));
        assertThat(bank).isEqualByComparingTo("200");
        assertThat(supplierBalance()).isEqualByComparingTo("500");   // the bill itself is untouched
    }
}
