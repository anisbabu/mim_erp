package com.mim.erp.accounting;

import com.mim.erp.accounting.AccountingService.Leg;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
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
 * Bill-wise party sub-ledger against a real PostgreSQL 16: invoices open bills, receipts settle them
 * oldest-first or as picked, leftovers are advances, reversals re-open bills, and the party ledger
 * balance always equals open bills minus advances.
 */
@SpringBootTest
@Testcontainers
class BillWiseTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    @Autowired AccountingService accounting;
    @Autowired CashService cash;
    @Autowired BillService bills;
    @Autowired LedgerService ledgers;
    @Autowired ReportService reports;
    @Autowired JdbcTemplate jdbc;

    private static final LocalDate TODAY = LocalDate.now();

    /** Ledger balances count the current financial year only: make sure it covers today. */
    @org.junit.jupiter.api.BeforeEach
    void currentYearCoversToday() {
        Integer n = jdbc.queryForObject("select count(*) from financial_year where is_current and ?::date between start_date and end_date",
            Integer.class, TODAY.toString());
        if (n != null && n > 0) return;
        int y = TODAY.getMonthValue() >= 7 ? TODAY.getYear() : TODAY.getYear() - 1;
        jdbc.update("update financial_year set is_current = false");
        jdbc.update("insert into financial_year (name, start_date, end_date, is_current) values (?,?,?,true) "
            + "on conflict (name) do update set is_current = true",
            y + "-" + (y + 1), LocalDate.of(y, 7, 1), LocalDate.of(y + 1, 6, 30));
    }

    private UUID customer(int creditDays) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into customer (id, code, name, type, credit_days) values (?,?,?,?,?)",
            id, "T" + id.toString().substring(0, 8), "Test customer", "PARTY", creditDays);
        return id;
    }

    private UUID supplier() {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into supplier (id, code, name) values (?,?,?)", id, "S" + id.toString().substring(0, 8), "Test supplier");
        return id;
    }

    /** A credit sale without the sales module: Dr customer / Cr Sales. */
    private JournalEntry invoice(UUID customerId, LocalDate date, String amount) {
        return accounting.post(date, "Test invoice", "JOURNAL", null, List.of(
            Leg.debit(ledgers.customerLedger(customerId).getCode(), new BigDecimal(amount)),
            Leg.credit("4000", new BigDecimal(amount))));
    }

    private CashService.VoucherRequest receipt(UUID customerId, String amount, String discount, List<BillService.Alloc> picks) {
        return new CashService.VoucherRequest("IN", "CUSTOMER", customerId, TODAY, new BigDecimal(amount),
            discount == null ? null : new BigDecimal(discount), "CASH", null, null, null, "MR-1", null, picks, null, null);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> openBills(UUID customerId) {
        return (List<Map<String, Object>>) bills.openItems("CUSTOMER", customerId).get("bills");
    }

    private BigDecimal itemBalance(String type, UUID id) {
        return (BigDecimal) bills.openItems(type, id).get("balance");
    }

    private static BigDecimal bd(String s) { return new BigDecimal(s); }

    @Test
    void receiptSettlesOldestBillFirstAndLeavesAdvance() {
        UUID c = customer(30);
        invoice(c, TODAY.minusDays(40), "1000");
        invoice(c, TODAY.minusDays(5), "500");

        Payment p = cash.voucher(receipt(c, "1200", null, null));
        assertThat(p.getVoucherNo()).startsWith("RV-");

        List<Map<String, Object>> open = openBills(c);
        assertThat(open).hasSize(1);
        assertThat((BigDecimal) open.get(0).get("open")).isEqualByComparingTo("300");   // older bill paid, newer part
        assertThat(open.get(0).get("status")).isEqualTo("PART");
        assertThat(open.get(0).get("dueDate")).isEqualTo(TODAY.minusDays(5).plusDays(30).toString());

        cash.voucher(receipt(c, "500", null, null));                 // 300 settles, 200 advance
        Map<String, Object> items = bills.openItems("CUSTOMER", c);
        assertThat((List<?>) items.get("bills")).isEmpty();
        assertThat((BigDecimal) items.get("advanceTotal")).isEqualByComparingTo("200");
        assertThat(itemBalance("CUSTOMER", c)).isEqualByComparingTo(ledgers.customerBalance(c));

        invoice(c, TODAY, "250");                                    // the advance is used on the next bill
        assertThat((BigDecimal) openBills(c).get(0).get("open")).isEqualByComparingTo("50");
        assertThat(itemBalance("CUSTOMER", c)).isEqualByComparingTo(ledgers.customerBalance(c));
    }

    @Test
    void pickedBillsAreHonouredAndDiscountSettlesToo() {
        UUID c = customer(0);
        invoice(c, TODAY.minusDays(20), "1000");
        JournalEntry newer = invoice(c, TODAY.minusDays(1), "800");
        UUID newerBill = jdbc.queryForObject("select id from party_item where journal_id = ?", UUID.class, newer.getId());

        cash.voucher(receipt(c, "780", "20", List.of(new BillService.Alloc(newerBill, bd("800")))));

        List<Map<String, Object>> open = openBills(c);
        assertThat(open).hasSize(1);                                  // the older bill is untouched
        assertThat((BigDecimal) open.get(0).get("open")).isEqualByComparingTo("1000");
        assertThat(ledgers.customerBalance(c)).isEqualByComparingTo("1000");
        BigDecimal discount = jdbc.queryForObject(
            "select coalesce(sum(jl.debit),0) from journal_line jl join account a on a.id = jl.account_id where a.code = '5500'",
            BigDecimal.class);
        assertThat(discount).isGreaterThanOrEqualTo(bd("20"));
    }

    @Test
    void overAllocationIsRefused() {
        UUID c = customer(0);
        JournalEntry inv = invoice(c, TODAY, "100");
        UUID bill = jdbc.queryForObject("select id from party_item where journal_id = ?", UUID.class, inv.getId());
        assertThatThrownBy(() -> cash.voucher(receipt(c, "500", null, List.of(new BillService.Alloc(bill, bd("200"))))))
            .hasMessageContaining("open");
    }

    @Test
    void reversingAReceiptReopensTheBill() {
        UUID c = customer(0);
        invoice(c, TODAY, "600");
        Payment p = cash.voucher(receipt(c, "600", null, null));
        assertThat(openBills(c)).isEmpty();

        UUID journal = jdbc.queryForObject("select id from journal_entry where source_id = ?", UUID.class, p.getId());
        accounting.reverse(journal, "entered twice", TODAY);

        assertThat((BigDecimal) openBills(c).get(0).get("open")).isEqualByComparingTo("600");
        assertThat((BigDecimal) bills.openItems("CUSTOMER", c).get("advanceTotal")).isEqualByComparingTo("0");
        assertThat(itemBalance("CUSTOMER", c)).isEqualByComparingTo(ledgers.customerBalance(c));
    }

    @Test
    void supplierPaymentSettlesSupplierBills() {
        UUID s = supplier();
        String ap = ledgers.supplierLedger(s).getCode();
        accounting.post(TODAY.minusDays(3), "Test GRN", "JOURNAL", null,
            List.of(Leg.debit("1200", bd("900")), Leg.credit(ap, bd("900"))));
        Payment p = cash.voucher(new CashService.VoucherRequest("OUT", "SUPPLIER", s, TODAY, bd("880"), bd("20"),
            "CASH", null, null, null, null, null, null, null, null));
        assertThat(p.getVoucherNo()).startsWith("PV-");
        assertThat(itemBalance("SUPPLIER", s)).isEqualByComparingTo("0");
    }

    @Test
    void openingBalanceBecomesOldestBill() {
        UUID c = customer(0);
        UUID acct = ledgers.customerLedger(c).getId();
        UUID fy = jdbc.queryForObject("select id from financial_year order by start_date limit 1", UUID.class);
        jdbc.update("insert into opening_balance (financial_year_id, account_id, debit, credit) values (?,?,?,0)", fy, acct, bd("400"));
        bills.syncOpenings();
        invoice(c, TODAY, "100");
        cash.voucher(receipt(c, "400", null, null));
        List<Map<String, Object>> open = openBills(c);
        assertThat(open).hasSize(1);
        assertThat(open.get(0).get("sourceType")).isEqualTo("JOURNAL");   // opening paid first
    }

    @Test
    void agingTotalsMatchOpenItems() {
        UUID c = customer(0);
        invoice(c, TODAY.minusDays(100), "700");
        invoice(c, TODAY.minusDays(10), "300");
        cash.voucher(receipt(c, "200", null, null));
        Map<String, Object> rep = reports.aging("CUSTOMER", TODAY);
        @SuppressWarnings("unchecked")
        Map<String, Object> row = ((List<Map<String, Object>>) rep.get("rows")).stream()
            .filter(r -> r.get("accountId").equals(ledgers.customerLedger(c).getId())).findFirst().orElseThrow();
        assertThat((BigDecimal) row.get("over90")).isEqualByComparingTo("500");
        assertThat((BigDecimal) row.get("current")).isEqualByComparingTo("300");
        assertThat((BigDecimal) row.get("total")).isEqualByComparingTo("800");
    }
}
