package com.mim.erp.common;

import com.lowagie.text.Document;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.FontFactory;
import com.lowagie.text.Image;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfWriter;

import java.awt.Color;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Collection;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Per-document helper for PDFs that can print in English or Bangla. Text with Bengali characters
 * goes through {@link BanglaPdf} (Java2D shaping); everything else stays in Helvetica, so digits,
 * doc numbers and "MIM ENTERPRISE" look the same in both languages.
 */
public final class PdfKit {
    /** Light slate-blue fill for headers and boxes: little ink, prints clean on any printer. */
    public static final Color TINT = new Color(0xE3, 0xEA, 0xF3);
    /** Dark navy text and rules to go with TINT. */
    public static final Color INK = new Color(0x1F, 0x35, 0x5E);

    private final boolean bn;
    private final PdfWriter writer;
    private final BanglaPdf.Cache cache = new BanglaPdf.Cache();
    private final float pageW;

    public PdfKit(boolean bn, Document doc, PdfWriter writer) {
        this.bn = bn;
        this.writer = writer;
        this.pageW = doc.right() - doc.left();
    }

    public static boolean isBn(String lang) { return "bn".equalsIgnoreCase(lang); }

    public boolean bn() { return bn; }
    public float pageWidth() { return pageW; }

    /** Printed label: the Bangla one in bn mode, otherwise the English text itself. */
    public String l(String en) {
        return bn && en != null ? BN.getOrDefault(en, en) : en;
    }

    /** Bangla name when printing Bangla and one exists, else the English name. */
    public String name(String nameBn, String name) {
        return bn && nameBn != null && !nameBn.isBlank() ? nameBn : name;
    }

    private static final DateTimeFormatter DMY = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    /** Printed date, dd/MM/yyyy; empty when there is none. */
    public static String date(LocalDate d) {
        return d == null ? "" : d.format(DMY);
    }

    /** Quantity with its unit: "30 PCS", or "30 পিস" in Bangla. 1 not 1.00; 2.5 stays. No unit = number only. */
    public String qty(BigDecimal qty, String unit) {
        String n = qty.stripTrailingZeros().toPlainString();
        if (unit == null || unit.isBlank()) return n;
        String u = unit.trim().toUpperCase(Locale.ROOT);
        return n + " " + (bn ? UNIT_BN.getOrDefault(u, u) : u);
    }

    /** The unit every listed product shares, or null when they differ (a total across units has no unit). */
    public static String sharedUnit(Collection<UUID> productIds, Map<UUID, String> units) {
        Set<String> seen = new HashSet<>();
        for (UUID id : productIds) {
            String u = units.get(id);
            seen.add(u == null ? "" : u.trim().toUpperCase(Locale.ROOT));
        }
        return seen.size() == 1 ? seen.iterator().next() : null;
    }

    private static final Map<String, String> UNIT_BN = Map.ofEntries(
        Map.entry("PCS", "পিস"), Map.entry("PC", "পিস"),
        Map.entry("FT", "ফুট"), Map.entry("SFT", "বর্গফুট"),
        Map.entry("INCH", "ইঞ্চি"), Map.entry("IN", "ইঞ্চি"),
        Map.entry("MTR", "মিটার"), Map.entry("M", "মিটার"),
        Map.entry("KG", "কেজি"), Map.entry("GM", "গ্রাম"), Map.entry("LTR", "লিটার"),
        Map.entry("BOX", "বক্স"), Map.entry("PAC", "প্যাকেট"), Map.entry("PKT", "প্যাকেট"),
        Map.entry("ROLL", "রোল"), Map.entry("SET", "সেট"), Map.entry("PAIR", "জোড়া"),
        Map.entry("DOZ", "ডজন"), Map.entry("BAG", "ব্যাগ"), Map.entry("SHEET", "শিট")
    );

    /** Column widths in points for a table spanning the page, from relative widths. */
    public float[] cols(float... ratios) {
        float sum = 0;
        for (float r : ratios) sum += r;
        float[] w = new float[ratios.length];
        for (int i = 0; i < w.length; i++) w[i] = pageW * ratios[i] / sum;
        return w;
    }

    private static Font font(boolean bold, boolean italic, float size, Color color) {
        String f = bold ? FontFactory.HELVETICA_BOLD : italic ? FontFactory.HELVETICA_OBLIQUE : FontFactory.HELVETICA;
        return FontFactory.getFont(f, size, Font.NORMAL, color);
    }

    /** Table cell with uniform padding; colWidth is the full column width in points. */
    public PdfPCell cell(String text, boolean bold, boolean italic, float size, Color color, int align,
                         float colWidth, float pad) {
        PdfPCell c;
        if (BanglaPdf.hasBengali(text)) {
            c = BanglaPdf.cell(writer.getDirectContent(), cache, text, bold, size, color, align, colWidth, pad, pad);
        } else {
            c = new PdfPCell(new Phrase(text != null ? text : "", font(bold, italic, size, color)));
            c.setHorizontalAlignment(align);
            c.setPadding(pad);
        }
        c.setVerticalAlignment(Element.ALIGN_MIDDLE);   // text sits mid-height in every cell and coloured box
        return c;
    }

    public PdfPCell cell(String text, boolean bold, float size, Color color, int align, float colWidth, float pad) {
        return cell(text, bold, false, size, color, align, colWidth, pad);
    }

    /** Full-width block (title, footer, note) with spacing; centered or left. */
    public Element para(String text, boolean bold, boolean italic, float size, Color color, int align,
                        float before, float after) {
        if (BanglaPdf.hasBengali(text)) {
            Image img = BanglaPdf.text(writer.getDirectContent(), cache, text, bold, size, color, align, pageW);
            img.setSpacingBefore(before);
            img.setSpacingAfter(after);
            return img;
        }
        Paragraph p = new Paragraph(text, font(bold, italic, size, color));
        p.setAlignment(align);
        p.setSpacingBefore(before);
        p.setSpacingAfter(after);
        return p;
    }

    private static final Map<String, String> BN = Map.ofEntries(
        Map.entry("SALES INVOICE", "বিক্রয় ইনভয়েস"),
        Map.entry("Previous balance", "পূর্বের বাকি"),
        Map.entry("PREVIOUS BALANCE STATUS", "পূর্বের বাকির অবস্থা"),
        Map.entry("Due (Dr)", "বাকি (ডেবিট)"),
        Map.entry("Advance (Cr)", "অগ্রিম (ক্রেডিট)"),
        Map.entry("Clear (nil)", "পরিষ্কার (শূন্য)"),
        Map.entry("Salesperson", "বিক্রয়কর্মী"),
        Map.entry("This invoice (on credit)", "এই ইনভয়েস (বাকিতে)"),
        Map.entry("Paid in cash", "নগদ পরিশোধ"),
        Map.entry("BALANCE DUE", "মোট বাকি"),
        Map.entry("Transport & lifting", "পরিবহন ও উঠানামা"),
        Map.entry("DELIVERY CHALLAN", "ডেলিভারি চালান"),
        Map.entry("WAREHOUSE DISPATCH TOKEN", "গুদাম ডিসপ্যাচ টোকেন"),
        Map.entry("CHEQUE RECEIPT", "চেক প্রাপ্তি রসিদ"),
        Map.entry("Invoice No", "ইনভয়েস নং"),
        Map.entry("Order No", "অর্ডার নং"),
        Map.entry("Challan No", "চালান নং"),
        Map.entry("Challan(s)", "চালান"),
        Map.entry("DC No", "চালান নং"),
        Map.entry("Date", "তারিখ"),
        Map.entry("Payment", "পেমেন্ট"),
        Map.entry("CASH", "নগদ"),
        Map.entry("CREDIT", "বাকি"),
        Map.entry("Customer", "গ্রাহক"),
        Map.entry("Contact", "যোগাযোগ"),
        Map.entry("Discount by", "ছাড় অনুমোদন"),
        Map.entry("Deliver to", "ডেলিভারির ঠিকানা"),
        Map.entry("Warehouse", "গুদাম"),
        Map.entry("WAREHOUSE", "গুদাম"),
        Map.entry("Status", "অবস্থা"),
        Map.entry("ISSUED", "ইস্যুকৃত"),
        Map.entry("CONSOLIDATED", "একত্রীকৃত"),
        Map.entry("CANCELLED", "বাতিল"),
        Map.entry("Product", "পণ্য"),
        Map.entry("Qty", "পরিমাণ"),
        Map.entry("Unit Price", "একক দাম"),
        Map.entry("Gross Total", "মোট (ছাড়ের আগে)"),
        Map.entry("Discount", "ছাড়"),
        Map.entry("Net Total", "নিট মোট"),
        Map.entry("TOTAL", "সর্বমোট"),
        Map.entry("TOTAL ITEMS", "মোট পণ্য"),
        Map.entry("Thank you for your business.", "আপনার ব্যবসার জন্য ধন্যবাদ।"),
        Map.entry("Received by", "গ্রহণকারী"),
        Map.entry("Seller's Signature", "বিক্রেতার স্বাক্ষর"),
        Map.entry("Customer Signature", "গ্রাহকের স্বাক্ষর"),
        Map.entry("Dispatched by", "প্রেরক"),
        Map.entry("Received on", "গ্রহণের তারিখ"),
        Map.entry("Mobile", "মোবাইল"),
        Map.entry("Cheque no.", "চেক নং"),
        Map.entry("Bank", "ব্যাংক"),
        Map.entry("Branch", "শাখা"),
        Map.entry("Maturity date", "পাকার তারিখ"),
        Map.entry("Amount", "টাকার পরিমাণ"),
        Map.entry("In words", "কথায়"),
        Map.entry("Note", "মন্তব্য"),
        Map.entry("Customer signature", "গ্রাহকের স্বাক্ষর"),
        Map.entry("Tk", "টাকা"),
        Map.entry("This receipt acknowledges the cheque only. Payment is credited to the customer's account once the cheque is honoured by the bank.",
            "এই রসিদ শুধু চেক গ্রহণের স্বীকৃতি। ব্যাংক চেক পরিশোধ করলে তবেই টাকা গ্রাহকের হিসাবে জমা হবে।"),
        Map.entry("dispatch note", "এই টোকেন শুধু %s থেকে মাল ছাড়ের অনুমতি দেয়। টোকেন ছাড়া মাল ছাড়বেন না।")
    );
}
