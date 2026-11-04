package com.mim.erp.sales;

import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import com.mim.erp.auth.CurrentUserService;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.PdfKit;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Demo (proforma) invoice: a priced list of items handed to a customer for price comparison.
 * Items are free text, so products need not exist in the master data. Nothing is saved, no stock
 * is touched and nothing is posted to the books.
 */
@RestController
@RequestMapping("/api/sales/demo-invoice")
public class DemoInvoice {

    private final CurrentUserService currentUser;

    public DemoInvoice(CurrentUserService currentUser) { this.currentUser = currentUser; }

    public record Line(String name, String unit, BigDecimal qty, BigDecimal unitPrice, BigDecimal discount) {}
    public record Request(String customerName, String customerMobile, String customerAddress, String salesperson,
                          String note, List<Line> lines) {}

    private static final DateTimeFormatter D = DateTimeFormatter.ofPattern("dd-MM-yyyy");

    @PostMapping(value = "/pdf", produces = "application/pdf")
    public ResponseEntity<byte[]> pdf(@RequestBody Request req, @RequestParam(defaultValue = "en") String lang) {
        boolean bn = PdfKit.isBn(lang);
        return ResponseEntity.ok()
            .header("Content-Disposition", "inline; filename=\"demo-invoice" + (bn ? "-bn" : "") + ".pdf\"")
            .body(render(req, bn, salesperson(req)));
    }

    /** The name typed on the slip, else the signed-in user. */
    private String salesperson(Request r) {
        if (r != null && r.salesperson() != null && !r.salesperson().isBlank()) return r.salesperson().trim();
        var u = currentUser.me();
        return u.getFullName() != null && !u.getFullName().isBlank() ? u.getFullName() : u.getUsername();
    }

    private static String money(BigDecimal v) { return new DecimalFormat("#,##0.00").format(v); }
    private static String qty(BigDecimal v) { return v.stripTrailingZeros().toPlainString(); }
    private static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }

    static byte[] render(Request r, boolean bn, String salesperson) {
        if (r == null || r.lines() == null || r.lines().isEmpty()) throw new ApiException("Add at least one item");
        if (r.lines().size() > 200) throw new ApiException("A demo invoice can have at most 200 items");
        for (Line l : r.lines()) {
            if (l.name() == null || l.name().isBlank()) throw new ApiException("Every item needs a name");
            if (nz(l.qty()).signum() <= 0) throw new ApiException("Quantity must be positive for " + l.name());
            if (nz(l.unitPrice()).signum() < 0) throw new ApiException("Price cannot be negative for " + l.name());
            if (nz(l.discount()).signum() < 0) throw new ApiException("Discount cannot be negative for " + l.name());
        }
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
                {bn ? "তারিখ" : "Date", LocalDate.now().format(D)},
                {bn ? "গ্রাহক" : "Customer", name},
                {bn ? "মোবাইল" : "Mobile", r.customerMobile() == null || r.customerMobile().isBlank() ? "-" : r.customerMobile().trim()},
                {bn ? "ঠিকানা" : "Address", r.customerAddress() == null || r.customerAddress().isBlank() ? "-" : r.customerAddress().trim()},
                {bn ? "বিক্রয়কর্মী" : "Salesperson", salesperson},
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
