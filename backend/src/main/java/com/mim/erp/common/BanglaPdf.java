package com.mim.erp.common;

import com.lowagie.text.Element;
import com.lowagie.text.Image;
import com.lowagie.text.pdf.PdfContentByte;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfTemplate;

import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.Shape;
import java.awt.font.FontRenderContext;
import java.awt.font.GlyphVector;
import java.awt.font.LineBreakMeasurer;
import java.awt.font.TextAttribute;
import java.awt.font.TextLayout;
import java.awt.geom.AffineTransform;
import java.awt.geom.Point2D;
import java.text.AttributedString;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Bangla text for OpenPDF. OpenPDF's built-in fonts cannot shape Bengali (conjuncts and vowel
 * signs come out wrong), so the text is laid out by Java2D with the bundled Noto Sans Bengali
 * and drawn into the PDF as vector outlines. The font also covers Latin, so mixed text is fine.
 */
public final class BanglaPdf {
    private BanglaPdf() {}

    private static final Font REGULAR = load("/fonts/NotoSansBengali-Regular.ttf");
    private static final Font BOLD    = load("/fonts/NotoSansBengali-Bold.ttf");
    private static final FontRenderContext FRC = new FontRenderContext(null, true, true);

    private static Font load(String path) {
        try (var in = BanglaPdf.class.getResourceAsStream(path)) {
            if (in == null) throw new IllegalStateException("Missing font resource " + path);
            return Font.createFont(Font.TRUETYPE_FONT, in);
        } catch (Exception e) {
            throw new IllegalStateException("Cannot load Bangla font " + path, e);
        }
    }

    /** True when the text has Bengali characters (anything else prints fine in Helvetica). */
    public static boolean hasBengali(String s) {
        if (s == null) return false;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch >= 0x0980 && ch <= 0x09FF) return true;
        }
        return false;
    }

    /** Per-document cache: repeated strings and glyphs are drawn once and reused. */
    public static final class Cache {
        private final Map<String, Image> images = new HashMap<>();
        private final Map<String, PdfTemplate> glyphs = new HashMap<>();
        Image get(String key) { return images.get(key); }
        void put(String key, Image img) { images.put(key, img); }
    }

    /**
     * Text wrapped to maxWidth (points), as a vector image exactly maxWidth wide. Java2D does the
     * shaping; each distinct shaped glyph is drawn once as a form XObject and placed by position,
     * which keeps the file small when thousands of names share the same glyphs.
     */
    public static Image text(PdfContentByte cb, Cache cache, String text, boolean bold, float size,
                             Color color, int align, float maxWidth) {
        Font f = (bold ? BOLD : REGULAR).deriveFont(size);
        char[] chars = text.toCharArray();
        AttributedString as = new AttributedString(text);
        as.addAttribute(TextAttribute.FONT, f);
        LineBreakMeasurer lbm = new LineBreakMeasurer(as.getIterator(), FRC);

        List<int[]> ranges = new ArrayList<>();
        List<TextLayout> lines = new ArrayList<>();
        float height = 0;
        while (lbm.getPosition() < chars.length) {
            int from = lbm.getPosition();
            TextLayout l = lbm.nextLayout(maxWidth);
            ranges.add(new int[]{from, lbm.getPosition()});
            lines.add(l);
            height += l.getAscent() + l.getDescent() + l.getLeading();
        }

        PdfTemplate tpl = cb.createTemplate(maxWidth, height);
        float y = 0;
        for (int n = 0; n < lines.size(); n++) {
            TextLayout l = lines.get(n);
            y += l.getAscent();
            float lw = l.getAdvance();
            float x0 = align == Element.ALIGN_RIGHT ? maxWidth - lw
                     : align == Element.ALIGN_CENTER ? (maxWidth - lw) / 2f : 0f;
            GlyphVector gv = f.layoutGlyphVector(FRC, chars, ranges.get(n)[0], ranges.get(n)[1],
                Font.LAYOUT_LEFT_TO_RIGHT);
            for (int i = 0; i < gv.getNumGlyphs(); i++) {
                Shape outline = gv.getGlyphOutline(i);
                if (outline.getBounds2D().isEmpty()) continue; // space
                Point2D p = gv.getGlyphPosition(i);
                PdfTemplate g = glyph(cb, cache, gv.getGlyphCode(i), outline, p, bold, size, color);
                // glyph template: baseline sits GLYPH_BASE*size above its bottom edge, origin PAD*size in
                tpl.addTemplate(g, x0 + (float) p.getX() - GLYPH_PAD * size,
                                   (height - y) - GLYPH_BASE * size);
            }
            y += l.getDescent() + l.getLeading();
        }

        try {
            return Image.getInstance(tpl);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static final float GLYPH_PAD = 1f, GLYPH_BASE = 0.8f, GLYPH_W = 3f, GLYPH_H = 2.6f;

    private static PdfTemplate glyph(PdfContentByte cb, Cache cache, int code, Shape outline, Point2D pos,
                                     boolean bold, float size, Color color) {
        String key = code + "|" + bold + "|" + size + "|" + color.getRGB();
        PdfTemplate g = cache.glyphs.get(key);
        if (g != null) return g;
        float w = GLYPH_W * size, h = GLYPH_H * size;
        g = cb.createTemplate(w, h);
        Graphics2D g2 = g.createGraphics(w, h);
        g2.setColor(color);
        g2.fill(AffineTransform.getTranslateInstance(GLYPH_PAD * size - pos.getX(),
                                                     h - GLYPH_BASE * size - pos.getY())
                .createTransformedShape(outline));
        g2.dispose();
        cache.glyphs.put(key, g);
        return g;
    }

    /** A table cell holding Bangla text; colWidth is the full column width in points. */
    public static PdfPCell cell(PdfContentByte cb, Cache cache, String text, boolean bold, float size,
                                Color color, int align, float colWidth, float padV, float padH) {
        PdfPCell c;
        if (text == null || text.isBlank()) {
            c = new PdfPCell();
        } else {
            String key = text + "|" + bold + "|" + size + "|" + color.getRGB() + "|" + align + "|" + colWidth;
            Image img = cache.get(key);
            if (img == null) {
                img = text(cb, cache, text, bold, size, color, align, colWidth - 2 * padH);
                cache.put(key, img);
            }
            c = new PdfPCell(img, false);
        }
        c.setHorizontalAlignment(align);
        c.setPaddingTop(padV);
        c.setPaddingBottom(padV);
        c.setPaddingLeft(padH);
        c.setPaddingRight(padH);
        return c;
    }
}
