package com.mim.erp.sales;

import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import com.mim.erp.auth.CurrentUserService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import com.mim.erp.common.PdfKit;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Demo (proforma) invoice: a priced list of items handed to a customer for price comparison.
 * Items are free text, so products need not exist in the master data. Nothing is saved, no stock
 * is touched and nothing is posted to the books.
 */
@RestController
@RequestMapping("/api/sales/demo-invoice")
public class DemoInvoice {

    private final CurrentUserService currentUser;
    private final JdbcTemplate jdbc;
    private final DocNumberService docNo;
    private final ObjectMapper json = new ObjectMapper();

    public DemoInvoice(CurrentUserService currentUser, JdbcTemplate jdbc, DocNumberService docNo) {
        this.currentUser = currentUser; this.jdbc = jdbc; this.docNo = docNo;
    }

    public record Line(UUID productId, String name, String unit, BigDecimal qty, BigDecimal unitPrice, BigDecimal discount) {}
    public record Request(UUID customerId, String customerName, String customerMobile, String customerAddress, String salesperson,
                          String salespersonBn, String note, List<Line> lines) {}

    private static final DateTimeFormatter D = DateTimeFormatter.ofPattern("dd-MM-yyyy");

    /** Save a demo invoice and give it a unique code (DEMO-yyyy-nnnnnn). */
    @PostMapping
    public Map<String, Object> save(@RequestBody Request req) {
        var u = currentUser.me();
        boolean blank = req != null && (req.salesperson() == null || req.salesperson().isBlank());
        Request r = blank ? new Request(req.customerId(), req.customerName(), req.customerMobile(), req.customerAddress(),
            u.getFullName() != null && !u.getFullName().isBlank() ? u.getFullName() : u.getUsername(),
            u.getFullNameBn(), req.note(), req.lines()) : req;
        BigDecimal total = validate(r);
        String code = docNo.next("DEMO");
        try {
            UUID id = jdbc.queryForObject(
                "INSERT INTO demo_invoice (code, customer_name, customer_mobile, salesperson, total, payload, created_by) "
                + "VALUES (?,?,?,?,?,?::jsonb,?) RETURNING id", UUID.class,
                code, trim(r.customerName()), trim(r.customerMobile()), trim(r.salesperson()), total,
                json.writeValueAsString(r), u.getId());
            return Map.of("id", id, "code", code, "total", total);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new ApiException("Could not save the demo invoice");
        }
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return jdbc.queryForList(
            "SELECT id, code, demo_date, customer_name, customer_mobile, salesperson, total, so_id, so_no, created_at "
            + "FROM demo_invoice ORDER BY created_at DESC LIMIT 300");
    }

    /** The saved request, so the page can reopen it for editing or copy it into a sales order. */
    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable UUID id) {
        var row = load(id);
        try {
            return Map.of("id", id, "code", row.get("code"), "demoDate", row.get("demo_date").toString(),
                "request", json.readTree(row.get("payload").toString()));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new ApiException("Saved demo invoice is unreadable");
        }
    }

    @GetMapping(value = "/{id}/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> pdf(@PathVariable UUID id, @RequestParam(defaultValue = "en") String lang) {
        boolean bn = PdfKit.isBn(lang);
        var row = load(id);
        try {
            Request r = json.readValue(row.get("payload").toString(), Request.class);
            String code = (String) row.get("code");
            LocalDate date = ((java.sql.Date) row.get("demo_date")).toLocalDate();
            return ResponseEntity.ok()
                .header("Content-Disposition", "inline; filename=\"" + code + (bn ? "-bn" : "") + ".pdf\"")
                .body(render(r, bn, salesperson(r), code, date));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new ApiException("Saved demo invoice is unreadable");
        }
    }

    public record LinkRequest(UUID soId) {}

    /** Record that this slip became a sales order. */
    @PostMapping("/{id}/link")
    public Map<String, Object> link(@PathVariable UUID id, @RequestBody LinkRequest req) {
        load(id);
        var no = jdbc.queryForList("SELECT so_no FROM sales_order WHERE id = ?", String.class, req.soId());
        if (no.isEmpty()) throw new ApiException("Sales order not found");
        jdbc.update("UPDATE demo_invoice SET so_id = ?, so_no = ? WHERE id = ?", req.soId(), no.get(0), id);
        return Map.of("soNo", no.get(0));
    }

    private Map<String, Object> load(UUID id) {
        var rows = jdbc.queryForList("SELECT code, demo_date, payload::text AS payload FROM demo_invoice WHERE id = ?", id);
        if (rows.isEmpty()) throw new ApiException("Demo invoice not found");
        return rows.get(0);
    }

    private static String trim(String s) { return s == null || s.isBlank() ? null : s.trim(); }

    /** The name on the slip, else the signed-in user. */
    private String salesperson(Request r) {
        if (r != null && r.salesperson() != null && !r.salesperson().isBlank()) return r.salesperson().trim();
        var u = currentUser.me();
        return u.getFullName() != null && !u.getFullName().isBlank() ? u.getFullName() : u.getUsername();
    }

    /** "English / বাংলা" - both names whenever a Bangla name exists. */
    private static String bothNames(String en, String bn) {
        if (bn == null || bn.isBlank() || bn.trim().equalsIgnoreCase(en)) return en;
        return en + " / " + bn.trim();
    }

    private static String money(BigDecimal v) { return new DecimalFormat("#,##0.00").format(v); }
    private static String qty(BigDecimal v) { return v.stripTrailingZeros().toPlainString(); }
    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }

    private static BigDecimal validate(Request r) {
        if (r == null || r.lines() == null || r.lines().isEmpty()) throw new ApiException("Add at least one item");
        if (r.lines().size() > 200) throw new ApiException("A demo invoice can have at most 200 items");
        for (Line l : r.lines()) {
            if (l.name() == null || l.name().isBlank()) throw new ApiException("Every item needs a name");
            if (nz(l.qty()).signum() <= 0) throw new ApiException("Quantity must be positive for " + l.name());
            if (nz(l.unitPrice()).signum() < 0) throw new ApiException("Price cannot be negative for " + l.name());
            if (nz(l.discount()).signum() < 0) throw new ApiException("Discount cannot be negative for " + l.name());
        }
        BigDecimal total = BigDecimal.ZERO;
        for (Line l : r.lines()) {
            BigDecimal g = l.qty().multiply(nz(l.unitPrice()));
            total = total.add(g.subtract(nz(l.discount()).min(g)));
        }
        return total.setScale(2, RoundingMode.HALF_UP);
    }

    static byte[] render(Request r, boolean bn, String salesperson, String code, LocalDate date) {
        validate(r);
        try {
            Document doc = new Document(new Rectangle(396f, 612f), 24, 24, 30, 36);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfWriter writer = PdfWriter.getInstance(doc, out);
            doc.open();
            PdfKit k = new PdfKit(bn, doc, writer);

            doc.add(k.para("MIM ENTERPRISE", true, false, 18, Color.BLACK, Element.ALIGN_CENTER, 0, 2));
            doc.add(k.para(bn ? "ডেমো ইনভয়েস" : "DEMO INVOICE", true, false, 13, Color.BLACK, Element.ALIGN_CENTER, 0, 2));
            doc.add(k.para(bn ? "শুধু মূল্য তুলনার জন্য - এটি কর ইনভয়েস নয়" : "For price comparison only - not a tax invoice",
                false, true, 8, Color.DARK_GRAY, Element.ALIGN_CENTER, 0, 8));

            String name = r.customerName() == null || r.customerName().isBlank() ? "-" : r.customerName().trim();
            String[][] meta = {
                {bn ? "ডেমো নং" : "Demo no.", code},
                {bn ? "তারিখ" : "Date", date.format(D)},
                {bn ? "গ্রাহক" : "Customer", name},
                {bn ? "মোবাইল" : "Mobile", r.customerMobile() == null || r.customerMobile().isBlank() ? "-" : r.customerMobile().trim()},
                {bn ? "ঠিকানা" : "Address", r.customerAddress() == null || r.customerAddress().isBlank() ? "-" : r.customerAddress().trim()},
                {bn ? "বিক্রয়কর্মী" : "Salesperson", bothNames(salesperson, r.salespersonBn())},
            };
            float[] mw = k.cols(1f, 3.4f);
            PdfPTable m = new PdfPTable(new float[]{1f, 3.4f});
            m.setWidthPercentage(100);
            for (String[] row : meta) {
                PdfPCell a = k.cell(row[0], true, 8.5f, Color.BLACK, Element.ALIGN_LEFT, mw[0], 2);
                PdfPCell b = k.cell(row[1], false, 8.5f, Color.BLACK, Element.ALIGN_LEFT, mw[1], 2);
                a.setBorder(Rectangle.NO_BORDER);
                b.setBorder(Rectangle.NO_BORDER);
                m.addCell(a);
                m.addCell(b);
            }
            doc.add(m);

            float[] ratio = {0.5f, 3.6f, 1.2f, 1.5f, 1.7f};
            float[] w = k.cols(ratio);
            PdfPTable t = new PdfPTable(ratio);
            t.setWidthPercentage(100);
            t.setSpacingBefore(8);
            t.setHeaderRows(1);
            String[] heads = bn ? new String[]{"#", "পণ্য", "পরিমাণ", "একক দাম", "টাকা"} : new String[]{"#", "Item", "Qty", "Unit price", "Amount"};
            for (int i = 0; i < 5; i++) {
                PdfPCell c = k.cell(heads[i], true, 8, Color.BLACK, i < 2 ? Element.ALIGN_LEFT : Element.ALIGN_RIGHT, w[i], 4);
                c.setBackgroundColor(new Color(240, 240, 240));
                t.addCell(c);
            }
            BigDecimal gross = BigDecimal.ZERO, disc = BigDecimal.ZERO;
            int n = 1;
            for (Line l : r.lines()) {
                BigDecimal g = l.qty().multiply(nz(l.unitPrice())).setScale(2, RoundingMode.HALF_UP);
                BigDecimal d = nz(l.discount()).min(g).setScale(2, RoundingMode.HALF_UP);
                gross = gross.add(g);
                disc = disc.add(d);
                String unit = l.unit() == null || l.unit().isBlank() ? "" : " " + l.unit().trim();
                t.addCell(k.cell(String.valueOf(n++), false, 8.5f, Color.BLACK, Element.ALIGN_LEFT, w[0], 3));
                t.addCell(k.cell(l.name().trim(), false, 8.5f, Color.BLACK, Element.ALIGN_LEFT, w[1], 3));
                t.addCell(k.cell(qty(l.qty()) + unit, false, 8.5f, Color.BLACK, Element.ALIGN_RIGHT, w[2], 3));
                t.addCell(k.cell(money(nz(l.unitPrice())), false, 8.5f, Color.BLACK, Element.ALIGN_RIGHT, w[3], 3));
                t.addCell(k.cell(money(g.subtract(d)), false, 8.5f, Color.BLACK, Element.ALIGN_RIGHT, w[4], 3));
            }
            float lab = w[0] + w[1] + w[2] + w[3];
            String[][] totals = disc.signum() > 0
                ? new String[][]{{bn ? "মোট (ছাড়ের আগে)" : "Subtotal", money(gross), "0"},
                                 {bn ? "ছাড়" : "Discount", "- " + money(disc), "0"},
                                 {bn ? "সর্বমোট" : "Total", money(gross.subtract(disc)), "1"}}
                : new String[][]{{bn ? "সর্বমোট" : "Total", money(gross), "1"}};
            for (String[] row : totals) {
                boolean strong = "1".equals(row[2]);
                PdfPCell a = k.cell(row[0], strong, 9, Color.BLACK, Element.ALIGN_RIGHT, lab, 3);
                a.setColspan(4);
                t.addCell(a);
                t.addCell(k.cell(row[1], strong, 9, Color.BLACK, Element.ALIGN_RIGHT, w[4], 3));
            }
            doc.add(t);

            if (r.note() != null && !r.note().isBlank())
                doc.add(k.para(r.note().trim(), false, true, 8, Color.DARK_GRAY, Element.ALIGN_LEFT, 8, 0));
            doc.add(k.para(bn ? "এটি একটি ডেমো ইনভয়েস। কোনো বিক্রয় বা স্টক লেনদেন করা হয়নি।"
                              : "This is a demo invoice. No sale or stock movement has been recorded.",
                false, true, 7.5f, Color.GRAY, Element.ALIGN_LEFT, 10, 0));
            doc.close();
            return out.toByteArray();
        } catch (DocumentException e) {
            throw new ApiException("Failed to generate the demo invoice");
        }
    }
}
