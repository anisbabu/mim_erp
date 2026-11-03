package com.mim.erp.accounting;

import com.lowagie.text.Document;
import com.lowagie.text.Element;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.BaseFont;
import com.lowagie.text.pdf.PdfContentByte;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfPageEventHelper;
import com.lowagie.text.pdf.PdfWriter;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.PdfKit;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * PDF versions of the financial statements and the trial balance, in English or Bangla.
 * They render the same row lists the screen shows, so the two can never disagree.
 */
final class StatementPdf {

    private static final DateTimeFormatter D = DateTimeFormatter.ofPattern("dd-MM-yyyy");
    private static final NumberFormat MONEY = NumberFormat.getNumberInstance(new Locale("en", "IN"));
    static {
        MONEY.setMinimumFractionDigits(2);
        MONEY.setMaximumFractionDigits(2);
    }

    private static final List<String[]> POLICIES = List.of(
        new String[]{"Basis of preparation: these statements are prepared on the accrual basis in accordance with IFRS presentation requirements (IAS 1) and a double-entry ledger.",
                     "প্রস্তুতির ভিত্তি: এই বিবরণী আইএফআরএস উপস্থাপনা (আইএএস ১) অনুসারে এবং দ্বি-এন্ট্রি খতিয়ানের ভিত্তিতে প্রস্তুত।"},
        new String[]{"Inventories are measured at cost on a first-in, first-out (FIFO) basis (IAS 2).",
                     "মজুদ পণ্য ফিফো ভিত্তিতে ক্রয়মূল্যে পরিমাপ করা হয় (আইএএস ২)।"},
        new String[]{"Property, plant and equipment is carried at cost less accumulated depreciation; depreciation is straight-line over the useful life (IAS 16).",
                     "সম্পত্তি, স্থাপনা ও যন্ত্রপাতি ক্রয়মূল্য বাদ সঞ্চিত অবচয়ে দেখানো হয়; অবচয় সরলরেখা পদ্ধতিতে (আইএএস ১৬)।"},
        new String[]{"The cash flow statement uses the indirect method (IAS 7). Cash and cash equivalents are cash in hand, petty cash and bank balances.",
                     "নগদ প্রবাহ বিবরণীতে পরোক্ষ পদ্ধতি ব্যবহৃত (আইএএস ৭)। নগদ ও নগদ সমতুল্য হলো হাতে নগদ, খুচরা নগদ ও ব্যাংক জের।"},
        new String[]{"Amounts are stated in Bangladeshi Taka (BDT). Figures in brackets are deductions or negative balances.",
                     "অঙ্ক বাংলাদেশি টাকায়। বন্ধনীর অঙ্ক বিয়োগ বা ঋণাত্মক জের।"});

    private StatementPdf() {}

    // ------------------------------------------------------------------ helpers
    private static String money(Object o) {
        if (o == null) return "";
        BigDecimal v = o instanceof BigDecimal b ? b : new BigDecimal(o.toString());
        if (v.abs().compareTo(new BigDecimal("0.005")) < 0) return "-";
        String s = MONEY.format(v.abs());
        return v.signum() < 0 ? "(" + s + ")" : s;
    }

    private static String date(Object o) {
        return o == null ? "" : LocalDate.parse(o.toString()).format(D);
    }

    private static String pick(boolean bn, Object en, Object bnText) {
        String b = bnText == null ? "" : bnText.toString();
        return bn && !b.isBlank() ? b : String.valueOf(en);
    }

    private static final class Ctx {
        final Document doc; final PdfWriter writer; final PdfKit kit; final ByteArrayOutputStream out = new ByteArrayOutputStream();
        Ctx(Rectangle page, boolean bn) throws Exception {
            doc = new Document(page, 40, 40, 40, 46);
            writer = PdfWriter.getInstance(doc, out);
            writer.setPageEvent(new Footer());
            doc.open();
            kit = new PdfKit(bn, doc, writer);
        }
        byte[] close() { doc.close(); return out.toByteArray(); }
    }

    /** "Page n" and the print date at the bottom of every page. */
    private static final class Footer extends PdfPageEventHelper {
        @Override public void onEndPage(PdfWriter w, Document d) {
            try {
                BaseFont f = BaseFont.createFont(BaseFont.HELVETICA, BaseFont.WINANSI, false);
                PdfContentByte cb = w.getDirectContent();
                cb.beginText();
                cb.setFontAndSize(f, 8);
                cb.setColorFill(Color.GRAY);
                cb.showTextAligned(Element.ALIGN_LEFT, "MIM Enterprise - printed " + LocalDate.now().format(D), d.left(), 24, 0);
                cb.showTextAligned(Element.ALIGN_RIGHT, "Page " + w.getPageNumber(), d.right(), 24, 0);
                cb.endText();
            } catch (Exception ignored) { }
        }
    }

    private static void header(Ctx x, String name, String period, String sub) throws Exception {
        PdfKit k = x.kit;
        x.doc.add(k.para("MIM ENTERPRISE", true, false, 16, Color.BLACK, Element.ALIGN_CENTER, 0, 2));
        x.doc.add(k.para(name, true, false, 12, Color.BLACK, Element.ALIGN_CENTER, 0, 2));
        x.doc.add(k.para(period, false, false, 9, Color.DARK_GRAY, Element.ALIGN_CENTER, 0, 1));
        x.doc.add(k.para(sub, false, true, 8, Color.GRAY, Element.ALIGN_CENTER, 0, 10));
    }

    /** Statement cell: no side borders; optional top rule and bottom rule (grand totals get a heavy one). */
    private static PdfPCell cell(PdfKit k, String text, boolean bold, int align, float w, float padLeft, float top, float bottom, float gridBottom) {
        PdfPCell c = k.cell(text, bold, 9, Color.BLACK, align, w, 3.5f);
        c.setBorder(Rectangle.NO_BORDER);
        if (padLeft > 0) c.setPaddingLeft(padLeft);
        if (top > 0) { c.enableBorderSide(Rectangle.TOP); c.setBorderWidthTop(top); c.setBorderColorTop(Color.BLACK); }
        if (bottom > 0) { c.enableBorderSide(Rectangle.BOTTOM); c.setBorderWidthBottom(bottom); c.setBorderColorBottom(Color.BLACK); }
        else if (gridBottom > 0) { c.enableBorderSide(Rectangle.BOTTOM); c.setBorderWidthBottom(gridBottom); c.setBorderColorBottom(new Color(225, 225, 225)); }
        return c;
    }

    private static PdfPCell head(PdfKit k, String text, int align, float w) {
        PdfPCell c = k.cell(text, true, 8, Color.DARK_GRAY, align, w, 4);
        c.setBorder(Rectangle.BOTTOM);
        c.setBorderWidthBottom(1.5f);
        c.setBorderColorBottom(Color.BLACK);
        return c;
    }

    // ------------------------------------------------------------------ IFRS statements (financial position, P&L, cash flows)
    @SuppressWarnings("unchecked")
    static byte[] statement(Map<String, Object> s, boolean bn, boolean positionDate) {
        try {
            Ctx x = new Ctx(com.lowagie.text.PageSize.A4, bn);
            PdfKit k = x.kit;
            String title = pick(bn, s.get("title"), titleBn(String.valueOf(s.get("title"))));
            String period = positionDate
                ? (bn ? "তারিখ অনুযায়ী " : "As at ") + date(s.get("to"))
                : (bn ? "সমাপ্ত বছরের জন্য " : "For the year ended ") + date(s.get("to"));
            header(x, title, period, bn ? "অঙ্ক বাংলাদেশি টাকায়" : "Amounts in BDT");

            boolean cmp = s.get("priorYearName") != null;
            float[] ratio = cmp ? new float[]{5.2f, 0.7f, 1.7f, 1.7f} : new float[]{6.4f, 0.8f, 2f};
            float[] w = k.cols(ratio);
            PdfPTable t = new PdfPTable(ratio);
            t.setWidthPercentage(100);
            t.setHeaderRows(1);
            t.addCell(head(k, bn ? "বিবরণ" : "Particulars", Element.ALIGN_LEFT, w[0]));
            t.addCell(head(k, bn ? "টীকা" : "Note", Element.ALIGN_CENTER, w[1]));
            t.addCell(head(k, String.valueOf(s.get("yearName")), Element.ALIGN_RIGHT, w[2]));
            if (cmp) t.addCell(head(k, String.valueOf(s.get("priorYearName")), Element.ALIGN_RIGHT, w[3]));

            for (Map<String, Object> r : (List<Map<String, Object>>) s.get("rows")) {
                String kind = (String) r.get("kind");
                if ("gap".equals(kind)) {
                    PdfPCell g = new PdfPCell(new com.lowagie.text.Phrase(" "));
                    g.setColspan(ratio.length); g.setBorder(Rectangle.NO_BORDER); g.setFixedHeight(8);
                    t.addCell(g);
                    continue;
                }
                boolean heading = "heading".equals(kind), sub = "subtotal".equals(kind), tot = "total".equals(kind);
                boolean bold = heading || sub || tot;
                float top = sub || tot ? 0.8f : 0, bottom = tot ? 2f : 0, grid = bold ? 0 : 0.4f;
                String label = pick(bn, r.get("label"), r.get("labelBn"));
                t.addCell(cell(k, label, bold, Element.ALIGN_LEFT, w[0], heading || sub || tot ? 0 : 14, top, bottom, grid));
                t.addCell(cell(k, r.get("note") == null ? "" : r.get("note").toString(), false, Element.ALIGN_CENTER, w[1], 0, top, bottom, grid));
                t.addCell(cell(k, heading ? "" : money(r.get("amount")), bold, Element.ALIGN_RIGHT, w[2], 0, top, bottom, grid));
                if (cmp) t.addCell(cell(k, heading ? "" : money(r.get("prior")), bold, Element.ALIGN_RIGHT, w[3], 0, top, bottom, grid));
            }
            x.doc.add(t);

            List<Map<String, Object>> notes = (List<Map<String, Object>>) s.get("notes");
            if (!notes.isEmpty()) {
                x.doc.add(k.para(bn ? "আর্থিক বিবরণীর টীকা" : "Notes to the financial statements", true, false, 10, Color.BLACK, Element.ALIGN_LEFT, 14, 4));
                float[] nr = cmp ? new float[]{6.4f, 1.7f, 1.7f} : new float[]{8.2f, 2f};
                float[] nw = k.cols(nr);
                for (Map<String, Object> n : notes) {
                    x.doc.add(k.para(n.get("no") + ". " + pick(bn, n.get("title"), n.get("titleBn")), true, false, 9, Color.BLACK, Element.ALIGN_LEFT, 6, 2));
                    PdfPTable nt = new PdfPTable(nr);
                    nt.setWidthPercentage(100);
                    nt.setKeepTogether(true);
                    for (Map<String, Object> a : (List<Map<String, Object>>) n.get("accounts")) {
                        String code = a.get("code") == null || a.get("code").toString().isBlank() ? "" : a.get("code") + "  ";
                        nt.addCell(cell(k, code + pick(bn, a.get("name"), a.get("nameBn")), false, Element.ALIGN_LEFT, nw[0], 14, 0, 0, 0.4f));
                        nt.addCell(cell(k, money(a.get("amount")), false, Element.ALIGN_RIGHT, nw[1], 0, 0, 0, 0.4f));
                        if (cmp) nt.addCell(cell(k, money(a.get("prior")), false, Element.ALIGN_RIGHT, nw[2], 0, 0, 0, 0.4f));
                    }
                    x.doc.add(nt);
                }
            }

            x.doc.add(k.para(bn ? "গুরুত্বপূর্ণ হিসাব নীতি" : "Significant accounting policies", true, false, 9, Color.BLACK, Element.ALIGN_LEFT, 14, 3));
            int i = 1;
            for (String[] p : POLICIES)
                x.doc.add(k.para(i++ + ". " + (bn ? p[1] : p[0]), false, false, 8, Color.DARK_GRAY, Element.ALIGN_LEFT, 0, 2));
            return x.close();
        } catch (Exception e) {
            throw new ApiException("Could not create the PDF: " + e.getMessage());
        }
    }

    // ------------------------------------------------------------------ statement of changes in equity
    @SuppressWarnings("unchecked")
    static byte[] equity(Map<String, Object> s, boolean bn) {
        try {
            Ctx x = new Ctx(com.lowagie.text.PageSize.A4, bn);
            PdfKit k = x.kit;
            header(x, pick(bn, s.get("title"), titleBn(String.valueOf(s.get("title")))),
                (bn ? "সমাপ্ত বছরের জন্য " : "For the year ended ") + date(s.get("to")), bn ? "অঙ্ক বাংলাদেশি টাকায়" : "Amounts in BDT");
            List<String> cols = (List<String>) s.get(bn ? "columnsBn" : "columns");
            float[] ratio = {4.6f, 1.8f, 1.8f, 1.8f};
            float[] w = k.cols(ratio);
            PdfPTable t = new PdfPTable(ratio);
            t.setWidthPercentage(100);
            t.addCell(head(k, bn ? "বিবরণ" : "Particulars", Element.ALIGN_LEFT, w[0]));
            for (int i = 0; i < 3; i++) t.addCell(head(k, cols.get(i), Element.ALIGN_RIGHT, w[i + 1]));
            for (Map<String, Object> r : (List<Map<String, Object>>) s.get("rows")) {
                boolean tot = "total".equals(r.get("kind"));
                t.addCell(cell(k, pick(bn, r.get("label"), r.get("labelBn")), tot, Element.ALIGN_LEFT, w[0], tot ? 0 : 14, tot ? 0.8f : 0, tot ? 2f : 0, tot ? 0 : 0.4f));
                List<Object> vals = (List<Object>) r.get("values");
                for (int i = 0; i < 3; i++)
                    t.addCell(cell(k, money(vals.get(i)), tot, Element.ALIGN_RIGHT, w[i + 1], 0, tot ? 0.8f : 0, tot ? 2f : 0, tot ? 0 : 0.4f));
            }
            x.doc.add(t);
            return x.close();
        } catch (Exception e) {
            throw new ApiException("Could not create the PDF: " + e.getMessage());
        }
    }

    // ------------------------------------------------------------------ trial balance (landscape)
    @SuppressWarnings("unchecked")
    static byte[] trialBalance(Map<String, Object> tb, boolean bn) {
        try {
            Ctx x = new Ctx(com.lowagie.text.PageSize.A4.rotate(), bn);
            PdfKit k = x.kit;
            header(x, bn ? "রেওয়ামিল" : "Trial balance",
                (bn ? "সমাপ্ত বছরের জন্য " : "For the year ended ") + date(tb.get("to")), bn ? "অঙ্ক বাংলাদেশি টাকায়" : "Amounts in BDT");
            float[] ratio = {1.1f, 4.2f, 1.4f, 1.4f, 1.4f, 1.4f, 1.4f, 1.4f};
            float[] w = k.cols(ratio);
            PdfPTable t = new PdfPTable(ratio);
            t.setWidthPercentage(100);
            t.setHeaderRows(1);
            String[] heads = bn
                ? new String[]{"কোড", "খতিয়ান", "প্রারম্ভিক ডেবিট", "প্রারম্ভিক ক্রেডিট", "লেনদেন ডেবিট", "লেনদেন ক্রেডিট", "সমাপনী ডেবিট", "সমাপনী ক্রেডিট"}
                : new String[]{"Code", "Ledger", "Opening Dr", "Opening Cr", "Movement Dr", "Movement Cr", "Closing Dr", "Closing Cr"};
            for (int i = 0; i < 8; i++) t.addCell(head(k, heads[i], i < 2 ? Element.ALIGN_LEFT : Element.ALIGN_RIGHT, w[i]));
            String[] keys = {"opening_debit", "opening_credit", "period_debit", "period_credit", "closing_debit", "closing_credit"};
            for (Map<String, Object> r : (List<Map<String, Object>>) tb.get("rows")) {
                boolean zero = true;
                for (String key : keys) if (new BigDecimal(r.get(key).toString()).signum() != 0) { zero = false; break; }
                if (zero) continue;
                t.addCell(cell(k, String.valueOf(r.get("code")), false, Element.ALIGN_LEFT, w[0], 0, 0, 0, 0.4f));
                t.addCell(cell(k, pick(bn, r.get("name"), r.get("name_bn")), false, Element.ALIGN_LEFT, w[1], 0, 0, 0, 0.4f));
                for (int i = 0; i < 6; i++) t.addCell(cell(k, money(r.get(keys[i])), false, Element.ALIGN_RIGHT, w[i + 2], 0, 0, 0, 0.4f));
            }
            String[] totals = {"openingDebit", "openingCredit", "periodDebit", "periodCredit", "closingDebit", "closingCredit"};
            PdfPCell lab = cell(k, bn ? "মোট" : "Total", true, Element.ALIGN_LEFT, w[0] + w[1], 0, 0.8f, 2f, 0);
            lab.setColspan(2);
            t.addCell(lab);
            for (int i = 0; i < 6; i++) t.addCell(cell(k, money(tb.get(totals[i])), true, Element.ALIGN_RIGHT, w[i + 2], 0, 0.8f, 2f, 0));
            x.doc.add(t);
            return x.close();
        } catch (Exception e) {
            throw new ApiException("Could not create the PDF: " + e.getMessage());
        }
    }

    private static String titleBn(String en) {
        return switch (en) {
            case "Statement of financial position" -> "আর্থিক অবস্থার বিবরণী";
            case "Statement of profit or loss" -> "মুনাফা বা ক্ষতির বিবরণী";
            case "Statement of changes in equity" -> "মালিকানা স্বত্বের পরিবর্তনের বিবরণী";
            case "Statement of cash flows" -> "নগদ প্রবাহ বিবরণী";
            default -> en;
        };
    }
}
