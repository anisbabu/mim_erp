package com.mim.erp.common;

import com.lowagie.text.DocumentException;
import com.lowagie.text.Element;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;

import java.awt.Color;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.List;

/** Building blocks shared by the slip-size voucher PDFs: label/value block, item table, signature line. */
public final class SlipParts {

    private SlipParts() {}

    public static String money(Object o) {
        BigDecimal b = o == null ? BigDecimal.ZERO : o instanceof BigDecimal d ? d : new BigDecimal(o.toString());
        return String.format("%,.2f", b.setScale(2, RoundingMode.HALF_UP));
    }

    public static LocalDate day(Object o) {
        return o instanceof java.sql.Date d ? d.toLocalDate() : o instanceof LocalDate l ? l : null;
    }

    /** Two-column label / value table; rows with an empty value are skipped. Labels go through {@code kit.l}. */
    public static PdfPTable keyValues(PdfKit kit, String[][] rows) {
        float[] w = kit.cols(1.2f, 3f);
        PdfPTable t = new PdfPTable(new float[]{1.2f, 3f});
        t.setWidthPercentage(100);
        for (String[] r : rows) {
            if (r[1] == null || r[1].isBlank()) continue;
            PdfPCell k = kit.cell(kit.l(r[0]), true, 9, Color.BLACK, Element.ALIGN_LEFT, w[0], 3.5f);
            PdfPCell c = kit.cell(r[1], false, 9, Color.BLACK, Element.ALIGN_LEFT, w[1], 3.5f);
            k.setBorderColor(Color.LIGHT_GRAY); c.setBorderColor(Color.LIGHT_GRAY);
            t.addCell(k); t.addCell(c);
        }
        return t;
    }

    /**
     * Item table: header row tinted, the first {@code leftCols} columns left-aligned, the rest right-aligned
     * (numbers). {@code footer}, when given, is a label spanning all but the last column plus a value.
     */
    public static PdfPTable items(PdfKit kit, float[] rel, String[] head, int leftCols, List<String[]> rows, String[] footer) {
        float[] w = kit.cols(rel);
        PdfPTable t = new PdfPTable(rel);
        t.setWidthPercentage(100);
        for (int i = 0; i < head.length; i++) {
            PdfPCell h = kit.cell(kit.l(head[i]), true, 8, Color.BLACK, i < leftCols ? Element.ALIGN_LEFT : Element.ALIGN_RIGHT, w[i], 3f);
            h.setBackgroundColor(PdfKit.TINT); h.setBorderColor(Color.LIGHT_GRAY);
            t.addCell(h);
        }
        for (String[] r : rows)
            for (int i = 0; i < r.length; i++) {
                PdfPCell c = kit.cell(r[i] == null ? "" : r[i], false, 8, Color.BLACK,
                    i < leftCols ? Element.ALIGN_LEFT : Element.ALIGN_RIGHT, w[i], 3f);
                c.setBorderColor(Color.LIGHT_GRAY);
                t.addCell(c);
            }
        if (footer != null) {
            float span = 0;
            for (int i = 0; i < rel.length - 1; i++) span += w[i];
            PdfPCell k = kit.cell(kit.l(footer[0]), true, 8, Color.BLACK, Element.ALIGN_RIGHT, span, 3f);
            k.setColspan(rel.length - 1); k.setBorderColor(Color.LIGHT_GRAY);
            PdfPCell v = kit.cell(footer[1], true, 8, Color.BLACK, Element.ALIGN_RIGHT, w[rel.length - 1], 3f);
            v.setBorderColor(Color.LIGHT_GRAY);
            t.addCell(k); t.addCell(v);
        }
        return t;
    }

    /** Two signature lines side by side. */
    public static PdfPTable signatures(PdfKit kit, String left, String right) throws DocumentException {
        PdfPTable sign = new PdfPTable(2);
        sign.setWidthPercentage(100);
        sign.setSpacingBefore(30);
        float signW = kit.pageWidth() / 2 - 20;
        for (String s : new String[]{left, right}) {
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
        return sign;
    }
}
