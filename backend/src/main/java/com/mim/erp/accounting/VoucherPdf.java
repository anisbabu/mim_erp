package com.mim.erp.accounting;

import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.PdfKit;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Receipt voucher (money in from a customer) / payment voucher (money out to a supplier), slip size. */
public final class VoucherPdf {

    private VoucherPdf() {}

    private static String money(Object o) {
        BigDecimal b = o == null ? BigDecimal.ZERO : o instanceof BigDecimal d ? d : new BigDecimal(o.toString());
        return String.format("%,.2f", b.setScale(2, RoundingMode.HALF_UP));
    }

    private static LocalDate day(Object o) {
        return o instanceof java.sql.Date d ? d.toLocalDate() : o instanceof LocalDate l ? l : null;
    }

    static byte[] render(Map<String, Object> v, List<Map<String, Object>> allocs, BigDecimal balance, boolean bn) {
        try {
            Document doc = PdfKit.slip();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfWriter writer = PdfWriter.getInstance(doc, out);
            PdfKit.printActualSize(writer);
            doc.open();
            PdfKit kit = new PdfKit(bn, doc, writer);
            boolean in = "IN".equals(v.get("direction"));

            doc.add(kit.title(kit.l(in ? "RECEIPT VOUCHER" : "PAYMENT VOUCHER"), 13, Color.BLACK, Element.ALIGN_CENTER, 0, 6));

            BigDecimal amount = (BigDecimal) v.get("amount");
            BigDecimal disc = v.get("discount") == null ? BigDecimal.ZERO : (BigDecimal) v.get("discount");
            BigDecimal ait = v.get("ait") == null ? BigDecimal.ZERO : (BigDecimal) v.get("ait");
            BigDecimal vds = v.get("vds") == null ? BigDecimal.ZERO : (BigDecimal) v.get("vds");
            String partyName = kit.name((String) v.get("party_name_bn"), (String) v.get("party_name"))
                + " (" + v.get("party_code") + ")";
            Object ledger = v.get("money_ledger");
            String method = "BANK".equals(v.get("method"))
                ? kit.l("Bank") + (ledger == null || "Bank".equals(ledger) ? "" : " - " + ledger)
                  + (v.get("bank_account_no") == null ? "" : " A/C " + v.get("bank_account_no"))
                : kit.l("Cash");
            String[][] rows = {
                {"Voucher no.", (String) v.get("voucher_no")},
                {"Date", PdfKit.date(day(v.get("payment_date")))},
                {in ? "Received from" : "Paid to", partyName},
                {"Mobile", (String) v.get("party_mobile")},
                {"Mode", method},
                {"Reference", (String) v.get("reference")},
                {"Amount", kit.l("Tk") + " " + money(amount)},
                {in ? "Discount allowed" : "Discount received", disc.signum() > 0 ? kit.l("Tk") + " " + money(disc) : null},
                {in ? "AIT deducted by customer" : "AIT deducted at source", ait.signum() > 0 ? kit.l("Tk") + " " + money(ait) : null},
                {in ? "VAT deducted by customer" : "VAT deducted at source", vds.signum() > 0 ? kit.l("Tk") + " " + money(vds) : null},
                {"In words", bn ? ChequeReceiptPdf.banglaWords(amount) : "Taka " + ChequeReceiptPdf.words(amount) + " only"},
                {"Note", (String) v.get("note")},
            };
            float[] colW = kit.cols(1.2f, 3f);
            PdfPTable t = new PdfPTable(new float[]{1.2f, 3f});
            t.setWidthPercentage(100);
            for (String[] r : rows) {
                if (r[1] == null || r[1].isBlank()) continue;
                PdfPCell k = kit.cell(kit.l(r[0]), true, 9, Color.BLACK, Element.ALIGN_LEFT, colW[0], 3.5f);
                PdfPCell c = kit.cell(r[1], false, 9, Color.BLACK, Element.ALIGN_LEFT, colW[1], 3.5f);
                for (PdfPCell cell : new PdfPCell[]{k, c}) cell.setBorderColor(Color.LIGHT_GRAY);
                t.addCell(k); t.addCell(c);
            }
            doc.add(t);

            // bills settled by this voucher
            doc.add(kit.para(kit.l("Against bills"), true, false, 9, Color.BLACK, Element.ALIGN_LEFT, 8, 3));
            float[] bw = kit.cols(1.6f, 1.2f, 1.2f, 1.2f);
            PdfPTable b = new PdfPTable(new float[]{1.6f, 1.2f, 1.2f, 1.2f});
            b.setWidthPercentage(100);
            String[] head = {"Bill no.", "Bill date", "Bill amount", "Settled"};
            for (int i = 0; i < head.length; i++) {
                PdfPCell h = kit.cell(kit.l(head[i]), true, 8, Color.BLACK, i < 2 ? Element.ALIGN_LEFT : Element.ALIGN_RIGHT, bw[i], 3f);
                h.setBackgroundColor(PdfKit.TINT); h.setBorderColor(Color.LIGHT_GRAY);
                b.addCell(h);
            }
            BigDecimal settled = BigDecimal.ZERO;
            for (Map<String, Object> a : allocs) {
                String[] cells = {(String) a.get("doc_no"), PdfKit.date(day(a.get("doc_date"))), money(a.get("bill_amount")), money(a.get("amount"))};
                for (int i = 0; i < cells.length; i++) {
                    PdfPCell c = kit.cell(cells[i] == null ? "" : cells[i], false, 8, Color.BLACK,
                        i < 2 ? Element.ALIGN_LEFT : Element.ALIGN_RIGHT, bw[i], 3f);
                    c.setBorderColor(Color.LIGHT_GRAY);
                    b.addCell(c);
                }
                settled = settled.add((BigDecimal) a.get("amount"));
            }
            BigDecimal advance = amount.add(disc).add(ait).add(vds).subtract(settled);
            if (advance.signum() > 0) {
                PdfPCell k = kit.cell(kit.l("Advance / on account"), false, 8, Color.BLACK, Element.ALIGN_LEFT, bw[0] + bw[1] + bw[2], 3f);
                k.setColspan(3); k.setBorderColor(Color.LIGHT_GRAY);
                PdfPCell c = kit.cell(money(advance), false, 8, Color.BLACK, Element.ALIGN_RIGHT, bw[3], 3f);
                c.setBorderColor(Color.LIGHT_GRAY);
                b.addCell(k); b.addCell(c);
            }
            doc.add(b);

            String balLabel = balance.signum() < 0 ? "Advance held"
                : in ? "Balance due after this receipt" : "Balance payable after this payment";
            doc.add(kit.para(kit.l(balLabel) + ": " + kit.l("Tk") + " " + money(balance.abs()),
                true, false, 9, Color.BLACK, Element.ALIGN_RIGHT, 6, 0));

            PdfPTable sign = new PdfPTable(2);
            sign.setWidthPercentage(100);
            sign.setSpacingBefore(30);
            float signW = kit.pageWidth() / 2 - 20;
            for (String s : new String[]{in ? "Received by" : "Receiver's signature", "Authorised by"}) {
                PdfPCell cell = kit.cell(kit.l(s), true, 9, Color.BLACK, Element.ALIGN_CENTER, signW, 0);
                cell.setBorder(Rectangle.TOP);
                cell.setPaddingTop(4);
                PdfPCell wrap = new PdfPCell();
                wrap.setBorder(Rectangle.NO_BORDER);
                wrap.setPaddingLeft(10); wrap.setPaddingRight(10);
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
            throw new ApiException("Failed to generate voucher");
        }
    }
}
