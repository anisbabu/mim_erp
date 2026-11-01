package com.mim.erp.accounting;

import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.PdfKit;
import com.mim.erp.master.Customer;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.format.DateTimeFormatter;

/** Acknowledgement slip handed to the customer when their cheque is received. */
final class ChequeReceiptPdf {

    private static final DateTimeFormatter D = DateTimeFormatter.ofPattern("dd-MM-yyyy");

    private ChequeReceiptPdf() {}

    static byte[] render(Cheque c, Customer cu, boolean bn) {
        try {
            Document doc = new Document(new Rectangle(396f, 612f), 14.17f, 14.17f, 104.88f, 42.52f);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfWriter writer = PdfWriter.getInstance(doc, out);
            doc.open();
            PdfKit kit = new PdfKit(bn, doc, writer);

            Font companyFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 20);

            Paragraph co = new Paragraph("MIM ENTERPRISE", companyFont);
            co.setAlignment(Element.ALIGN_CENTER);
            doc.add(co);
            doc.add(kit.para(kit.l("CHEQUE RECEIPT"), true, false, 13, Color.BLACK, Element.ALIGN_CENTER, 0, 14));

            String amount = c.getAmount().setScale(2, RoundingMode.HALF_UP).toPlainString();
            String[][] rows = {
                {"Received on", c.getReceiveDate().format(D)},
                {"Customer", cu == null ? "" : kit.name(cu.getNameBn(), cu.getName()) + " (" + cu.getCode() + ")"},
                {"Mobile", cu == null ? "" : cu.getMobile()},
                {"Cheque no.", c.getChequeNo()},
                {"Bank", c.getBankName()},
                {"Branch", c.getBranchName()},
                {"Maturity date", c.getMaturityDate().format(D)},
                {"Amount", bn ? kit.l("Tk") + " " + amount : "Tk " + amount},
                {"In words", bn ? banglaWords(c.getAmount()) : "Taka " + words(c.getAmount()) + " only"},
                {"Note", c.getNote()},
            };
            float[] colW = kit.cols(1.1f, 3f);
            PdfPTable t = new PdfPTable(new float[]{1.1f, 3f});
            t.setWidthPercentage(100);
            for (String[] r : rows) {
                PdfPCell k = kit.cell(kit.l(r[0]), true, 9, Color.BLACK, Element.ALIGN_LEFT, colW[0], 5);
                PdfPCell v = kit.cell(r[1] != null ? r[1] : "", false, 9, Color.BLACK, Element.ALIGN_LEFT, colW[1], 5);
                for (PdfPCell cell : new PdfPCell[]{k, v}) cell.setBorderColor(Color.LIGHT_GRAY);
                t.addCell(k); t.addCell(v);
            }
            doc.add(t);

            doc.add(kit.para(kit.l("This receipt acknowledges the cheque only. Payment is credited to the customer's account once the cheque is honoured by the bank."),
                false, true, 8, Color.BLACK, Element.ALIGN_LEFT, 8, 0));

            PdfPTable sign = new PdfPTable(2);
            sign.setWidthPercentage(100);
            sign.setSpacingBefore(50);
            float signW = kit.pageWidth() / 2 - 20;
            for (String s : new String[]{"Customer signature", "Received by"}) {
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

    // ---- the same in Bangla: every number below 100 has its own word ----
    private static final String[] BN_NUM = {
        "শূন্য", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়",
        "দশ", "এগারো", "বারো", "তেরো", "চৌদ্দ", "পনেরো", "ষোলো", "সতেরো", "আঠারো", "ঊনিশ",
        "বিশ", "একুশ", "বাইশ", "তেইশ", "চব্বিশ", "পঁচিশ", "ছাব্বিশ", "সাতাশ", "আটাশ", "ঊনত্রিশ",
        "ত্রিশ", "একত্রিশ", "বত্রিশ", "তেত্রিশ", "চৌত্রিশ", "পঁয়ত্রিশ", "ছত্রিশ", "সাঁইত্রিশ", "আটত্রিশ", "ঊনচল্লিশ",
        "চল্লিশ", "একচল্লিশ", "বিয়াল্লিশ", "তেতাল্লিশ", "চুয়াল্লিশ", "পঁয়তাল্লিশ", "ছেচল্লিশ", "সাতচল্লিশ", "আটচল্লিশ", "ঊনপঞ্চাশ",
        "পঞ্চাশ", "একান্ন", "বাহান্ন", "তিপ্পান্ন", "চুয়ান্ন", "পঞ্চান্ন", "ছাপ্পান্ন", "সাতান্ন", "আটান্ন", "ঊনষাট",
        "ষাট", "একষট্টি", "বাষট্টি", "তেষট্টি", "চৌষট্টি", "পঁয়ষট্টি", "ছেষট্টি", "সাতষট্টি", "আটষট্টি", "ঊনসত্তর",
        "সত্তর", "একাত্তর", "বাহাত্তর", "তিয়াত্তর", "চুয়াত্তর", "পঁচাত্তর", "ছিয়াত্তর", "সাতাত্তর", "আটাত্তর", "ঊনআশি",
        "আশি", "একাশি", "বিরাশি", "তিরাশি", "চুরাশি", "পঁচাশি", "ছিয়াশি", "সাতাশি", "আটাশি", "ঊননব্বই",
        "নব্বই", "একানব্বই", "বিরানব্বই", "তিরানব্বই", "চুরানব্বই", "পঁচানব্বই", "ছিয়ানব্বই", "সাতানব্বই", "আটানব্বই", "নিরানব্বই"};

    /** Full phrase, e.g. "এক হাজার টাকা মাত্র". */
    static String banglaWords(BigDecimal amount) {
        BigDecimal v = amount.setScale(2, RoundingMode.HALF_UP);
        long taka = v.longValue();
        int paisa = v.remainder(BigDecimal.ONE).movePointRight(2).intValue();
        String w = (taka == 0 ? BN_NUM[0] : bnGroup(taka).trim()) + " টাকা";
        if (paisa > 0) w += " " + BN_NUM[paisa] + " পয়সা";
        return w + " মাত্র";
    }

    private static String bnGroup(long n) {
        if (n == 0) return "";
        if (n >= 10_000_000) return (bnGroup(n / 10_000_000) + " কোটি " + bnGroup(n % 10_000_000)).trim();
        if (n >= 100_000) return (BN_NUM[(int) (n / 100_000)] + " লাখ " + bnGroup(n % 100_000)).trim();
        if (n >= 1_000) return (BN_NUM[(int) (n / 1_000)] + " হাজার " + bnGroup(n % 1_000)).trim();
        if (n >= 100) return (BN_NUM[(int) (n / 100)] + "শো " + bnGroup(n % 100)).trim();
        return BN_NUM[(int) n];
    }
}
