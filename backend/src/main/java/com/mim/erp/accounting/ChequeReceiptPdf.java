package com.mim.erp.accounting;

import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import com.mim.erp.common.ApiException;
import com.mim.erp.master.Customer;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.format.DateTimeFormatter;

/** Acknowledgement slip handed to the customer when their cheque is received. */
final class ChequeReceiptPdf {

    private static final DateTimeFormatter D = DateTimeFormatter.ofPattern("dd-MM-yyyy");

    private ChequeReceiptPdf() {}

    static byte[] render(Cheque c, Customer cu) {
        try {
            Document doc = new Document(new Rectangle(396f, 612f), 14.17f, 14.17f, 104.88f, 42.52f);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfWriter.getInstance(doc, out);
            doc.open();

            Font companyFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 20);
            Font titleFont   = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 13);
            Font labelFont   = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9);
            Font valueFont   = FontFactory.getFont(FontFactory.HELVETICA, 9);
            Font smallFont   = FontFactory.getFont(FontFactory.HELVETICA_OBLIQUE, 8);

            Paragraph co = new Paragraph("MIM ENTERPRISE", companyFont);
            co.setAlignment(Element.ALIGN_CENTER);
            doc.add(co);
            Paragraph title = new Paragraph("CHEQUE RECEIPT", titleFont);
            title.setAlignment(Element.ALIGN_CENTER);
            title.setSpacingAfter(14);
            doc.add(title);

            String[][] rows = {
                {"Received on", c.getReceiveDate().format(D)},
                {"Customer", cu == null ? "" : cu.getName() + " (" + cu.getCode() + ")"},
                {"Mobile", cu == null ? "" : cu.getMobile()},
                {"Cheque no.", c.getChequeNo()},
                {"Bank", c.getBankName()},
                {"Branch", c.getBranchName()},
                {"Maturity date", c.getMaturityDate().format(D)},
                {"Amount", "Tk " + c.getAmount().setScale(2, RoundingMode.HALF_UP).toPlainString()},
                {"In words", "Taka " + words(c.getAmount()) + " only"},
                {"Note", c.getNote()},
            };
            PdfPTable t = new PdfPTable(new float[]{1.1f, 3f});
            t.setWidthPercentage(100);
            for (String[] r : rows) {
                PdfPCell k = new PdfPCell(new Phrase(r[0], labelFont));
                PdfPCell v = new PdfPCell(new Phrase(r[1] != null ? r[1] : "", valueFont));
                for (PdfPCell cell : new PdfPCell[]{k, v}) { cell.setPadding(5); cell.setBorderColor(java.awt.Color.LIGHT_GRAY); }
                t.addCell(k); t.addCell(v);
            }
            doc.add(t);

            Paragraph fine = new Paragraph(
                "This receipt acknowledges the cheque only. Payment is credited to the customer's account once the cheque is honoured by the bank.",
                smallFont);
            fine.setSpacingBefore(8);
            doc.add(fine);

            PdfPTable sign = new PdfPTable(2);
            sign.setWidthPercentage(100);
            sign.setSpacingBefore(50);
            for (String s : new String[]{"Customer signature", "Received by"}) {
                PdfPCell cell = new PdfPCell(new Phrase(s, labelFont));
                cell.setBorder(Rectangle.TOP);
                cell.setHorizontalAlignment(Element.ALIGN_CENTER);
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
            throw new ApiException("Failed to generate cheque receipt");
        }
    }

    // ---- amount in words, Bangladeshi grouping (crore / lakh / thousand) ----
    private static final String[] ONES = {"", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"};
    private static final String[] TENS = {"", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"};

    static String words(BigDecimal amount) {
        BigDecimal v = amount.setScale(2, RoundingMode.HALF_UP);
        long taka = v.longValue();
        int paisa = v.remainder(BigDecimal.ONE).movePointRight(2).intValue();
        String w = taka == 0 ? "Zero" : group(taka).trim();
        if (paisa > 0) w += " and " + below100(paisa) + " Paisa";
        return w;
    }

    private static String group(long n) {
        if (n == 0) return "";
        if (n >= 10_000_000) return group(n / 10_000_000) + " Crore " + group(n % 10_000_000);
        if (n >= 100_000) return below100((int) (n / 100_000)) + " Lakh " + group(n % 100_000);
        if (n >= 1_000) return below100((int) (n / 1_000)) + " Thousand " + group(n % 1_000);
        if (n >= 100) return ONES[(int) (n / 100)] + " Hundred " + group(n % 100);
        return below100((int) n);
    }

    private static String below100(int n) {
        if (n < 20) return ONES[n];
        return TENS[n / 10] + (n % 10 == 0 ? "" : " " + ONES[n % 10]);
    }
}
