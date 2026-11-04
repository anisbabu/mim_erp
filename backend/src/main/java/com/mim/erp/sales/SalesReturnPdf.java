package com.mim.erp.sales;

import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.PdfKit;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

/** Printable credit note (or cash-refund voucher) for a sales return. */
final class SalesReturnPdf {

    private static final DateTimeFormatter D = DateTimeFormatter.ofPattern("dd-MM-yyyy");

    private SalesReturnPdf() {}

    private static String money(Object o) {
        return new DecimalFormat("#,##0.00").format(new BigDecimal(String.valueOf(o)));
    }

    private static String qty(Object o) {
        return new BigDecimal(String.valueOf(o)).stripTrailingZeros().toPlainString();
    }

    @SuppressWarnings("unchecked")
    static byte[] render(Map<String, Object> r, boolean bn) {
        try {
            Document doc = new Document(PageSize.A5, 28, 28, 36, 40);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfWriter writer = PdfWriter.getInstance(doc, out);
            doc.open();
            PdfKit k = new PdfKit(bn, doc, writer);
            boolean credit = "CREDIT_NOTE".equals(r.get("settlement"));

            doc.add(k.para("MIM ENTERPRISE", true, false, 18, Color.BLACK, Element.ALIGN_CENTER, 0, 2));
            doc.add(k.para(bn ? (credit ? "ক্রেডিট নোট" : "নগদ ফেরত ভাউচার") : (credit ? "CREDIT NOTE" : "CASH REFUND VOUCHER"),
                true, false, 13, Color.BLACK, Element.ALIGN_CENTER, 0, 10));

            String[][] meta = {
                {bn ? "রিটার্ন নং" : "Return no", String.valueOf(r.get("return_no"))},
                {bn ? "ক্রেডিট নোট নং" : "Credit note no", credit ? String.valueOf(r.get("credit_note_no")) : "-"},
                {bn ? "তারিখ" : "Date", LocalDate.parse(String.valueOf(r.get("return_date"))).format(D)},
                {bn ? "অর্ডার নং" : "Against order", String.valueOf(r.get("so_no"))},
                {bn ? "গ্রাহক" : "Customer", k.name((String) r.get("customer_name_bn"), (String) r.get("customer_name")) + " (" + r.get("customer_code") + ")"},
                {bn ? "কারণ" : "Reason", String.valueOf(r.get("reason"))},
            };
            PdfPTable m = new PdfPTable(new float[]{1.2f, 3f});
            m.setWidthPercentage(100);
            float[] mw = k.cols(1.2f, 3f);
            for (String[] row : meta) {
                PdfPCell a = k.cell(row[0], true, 9, Color.BLACK, Element.ALIGN_LEFT, mw[0], 3);
                PdfPCell b = k.cell(row[1], false, 9, Color.BLACK, Element.ALIGN_LEFT, mw[1], 3);
                a.setBorder(Rectangle.NO_BORDER);
                b.setBorder(Rectangle.NO_BORDER);
                m.addCell(a);
                m.addCell(b);
            }
            doc.add(m);

            float[] ratio = {4f, 1.2f, 1.6f, 1.8f};
            float[] w = k.cols(ratio);
            PdfPTable t = new PdfPTable(ratio);
            t.setWidthPercentage(100);
            t.setSpacingBefore(10);
            String[] heads = bn ? new String[]{"পণ্য", "পরিমাণ", "একক দাম", "টাকা"} : new String[]{"Product", "Qty", "Unit price", "Amount"};
            for (int i = 0; i < 4; i++) {
                PdfPCell c = k.cell(heads[i], true, 8, Color.BLACK, i == 0 ? Element.ALIGN_LEFT : Element.ALIGN_RIGHT, w[i], 4);
                c.setBackgroundColor(new Color(240, 240, 240));
                t.addCell(c);
            }
            for (Map<String, Object> l : (List<Map<String, Object>>) r.get("lines")) {
                String name = k.name((String) l.get("product_name_bn"), (String) l.get("product_name"));
                t.addCell(k.cell(name, false, 9, Color.BLACK, Element.ALIGN_LEFT, w[0], 3));
                t.addCell(k.cell(qty(l.get("qty")) + (l.get("unit") == null ? "" : " " + l.get("unit")), false, 9, Color.BLACK, Element.ALIGN_RIGHT, w[1], 3));
                t.addCell(k.cell(money(l.get("unit_price")), false, 9, Color.BLACK, Element.ALIGN_RIGHT, w[2], 3));
                t.addCell(k.cell(money(l.get("amount")), false, 9, Color.BLACK, Element.ALIGN_RIGHT, w[3], 3));
            }
            PdfPCell tl = k.cell(bn ? "মোট ক্রেডিট" : "Total credited", true, 9, Color.BLACK, Element.ALIGN_RIGHT, w[0] + w[1] + w[2], 4);
            tl.setColspan(3);
            t.addCell(tl);
            t.addCell(k.cell(money(r.get("goods_value")), true, 9, Color.BLACK, Element.ALIGN_RIGHT, w[3], 4));
            doc.add(t);

            doc.add(k.para(credit
                ? (bn ? "এই পরিমাণ গ্রাহকের হিসাবে জমা করা হয়েছে এবং পরবর্তী বিল থেকে বাদ যাবে।"
                      : "This amount has been credited to the customer's account and will be set against future invoices.")
                : (bn ? "পণ্য ফেরতের বিপরীতে নগদ ফেরত দেওয়া হয়েছে।" : "Cash has been refunded against the returned goods."),
                false, true, 8, Color.DARK_GRAY, Element.ALIGN_LEFT, 8, 0));

            PdfPTable sign = new PdfPTable(2);
            sign.setWidthPercentage(100);
            sign.setSpacingBefore(36);
            float sw = k.pageWidth() / 2 - 20;
            for (String s : bn ? new String[]{"গ্রাহকের স্বাক্ষর", "অনুমোদনকারী"} : new String[]{"Customer signature", "Authorised by"}) {
                PdfPCell cell = k.cell(s, true, 9, Color.BLACK, Element.ALIGN_CENTER, sw, 0);
                cell.setBorder(Rectangle.TOP);
                cell.setPaddingTop(4);
                PdfPCell wrap = new PdfPCell();
                wrap.setBorder(Rectangle.NO_BORDER);
                wrap.setPaddingLeft(10);
                wrap.setPaddingRight(10);
                PdfPTable inner = new PdfPTable(1);
                inner.setWidthPercentage(100);
                inner.addCell(cell);
                wrap.addElement(inner);
                sign.addCell(wrap);
            }
            doc.add(sign);
            doc.close();
            return out.toByteArray();
        } catch (DocumentException e) {
            throw new ApiException("Failed to generate the credit note");
        }
    }
}
