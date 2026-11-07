package com.mim.erp.inventory;

import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.BanglaPdf;
import com.mim.erp.common.PdfKit;
import com.mim.erp.master.ProductRepository;
import com.mim.erp.master.WarehouseRepository;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.*;
import java.util.List;

@RestController
@RequestMapping("/api/inventory")
public class InventoryController {

    private final StockLayerRepository layers;
    private final ProductRepository products;
    private final WarehouseRepository warehouses;
    private final StockReportService reports;
    private final OpeningStockService opening;

    public InventoryController(StockLayerRepository layers,
                               ProductRepository products,
                               WarehouseRepository warehouses,
                               StockReportService reports,
                               OpeningStockService opening) {
        this.layers = layers;
        this.products = products;
        this.warehouses = warehouses;
        this.reports = reports;
        this.opening = opening;
    }

    /** Per product: on hand, committed to customers (sold, not picked up), available, on order. */
    @GetMapping("/status")
    public List<StockReportService.StatusRow> status() {
        return reports.status();
    }

    /** Customers still waiting for a product (open sales-order lines with pending qty). */
    @GetMapping("/committed")
    public List<StockReportService.CommittedRow> committed(@RequestParam UUID productId) {
        return reports.committed(productId);
    }

    /** Opening / inward / outward / closing per product for a period; optional single warehouse. */
    @GetMapping("/stock-summary")
    public List<StockReportService.SummaryRow> stockSummary(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                                            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                                            @RequestParam(required = false) UUID warehouseId) {
        if (from.isAfter(to)) throw new ApiException("'from' must not be after 'to'");
        return reports.summary(from, to, warehouseId);
    }

    /**
     * One-time opening-stock load from the old system (CSV body:
     * product_name,warehouse_name,qty,unit_cost). dryRun=true only validates.
     */
    @PostMapping(value = "/opening-import", consumes = {"text/csv", "text/plain"})
    public OpeningStockService.ImportResult openingImport(@RequestBody String csv,
                                                          @RequestParam(defaultValue = "true") boolean dryRun,
                                                          @RequestParam(defaultValue = "2026-11-01") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate cutOver) {
        return opening.importCsv(csv, cutOver, dryRun);
    }

    /** Per-warehouse availability for a product — drives the sales-order stock picker. */
    @GetMapping("/availability")
    public List<StockLayerRepository.WarehouseStock> availability(@RequestParam UUID productId) {
        return layers.availabilityByWarehouse(productId);
    }

    /** Available qty of a product in a specific warehouse. */
    @GetMapping("/available")
    public BigDecimal available(@RequestParam UUID productId, @RequestParam UUID warehouseId) {
        return layers.availableQty(productId, warehouseId);
    }

    /** Whole-company stock overview (qty + value per product/warehouse). */
    @GetMapping("/overview")
    public List<StockLayerRepository.StockRow> overview() {
        return layers.stockOverview();
    }

    /**
     * Price-variance report. scope=warehouse (default) breaks down per warehouse;
     * scope=company rolls up per product across all warehouses.
     */
    @GetMapping("/price-variance")
    public List<StockLayerRepository.VarianceRow> priceVariance(
            @RequestParam(defaultValue = "warehouse") String scope) {
        return "company".equals(scope)
            ? layers.varianceCompanyWide()
            : layers.varianceByWarehouse();
    }

    /** Stock on hand grouped by supplier + product. */
    @GetMapping("/overview/by-supplier")
    public List<StockLayerRepository.SupplierStockRow> bySupplier() {
        return layers.stockBySupplier();
    }

    /** Stock-on-hand report as PDF (A4). lang=bn prints Bangla headings and names. */
    @GetMapping(value = "/stock-report", produces = "application/pdf")
    public ResponseEntity<byte[]> stockReport(@RequestParam(defaultValue = "en") String lang) {
        boolean bn = "bn".equalsIgnoreCase(lang);
        List<StockLayerRepository.StockRow> rows = layers.stockOverview();

        Map<UUID, String> productNames = new HashMap<>();
        products.findAll().forEach(p -> productNames.put(p.getId(),
            bn && p.getNameBn() != null && !p.getNameBn().isBlank() ? p.getNameBn() : p.getName()));

        Map<UUID, String> warehouseNames = new HashMap<>();
        warehouses.findAll().forEach(w -> warehouseNames.put(w.getId(),
            bn && w.getNameBn() != null && !w.getNameBn().isBlank() ? w.getNameBn() : w.getName()));

        try {
            Document doc = new Document(new Rectangle(595f, 842f), 28.35f, 28.35f, 28.35f, 36f); // A4
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfWriter writer = PdfWriter.getInstance(doc, out);
            doc.open();
            PdfContentByte cb = writer.getDirectContent();
            BanglaPdf.Cache cache = new BanglaPdf.Cache();
            float pageW = doc.right() - doc.left();

            Font companyFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 16);
            Color grey = new Color(0x55, 0x55, 0x55);

            Paragraph co = new Paragraph("MIM ENTERPRISE", companyFont);
            co.setAlignment(Element.ALIGN_CENTER);
            doc.add(co);

            String titleText = bn ? "মজুদ পণ্য" : "STOCK ON HAND";
            String dateText  = (bn ? "তারিখ: " : "As of ") + LocalDate.now();
            if (bn) {
                Image ti = BanglaPdf.text(cb, cache, titleText, true, 11, Color.BLACK, Element.ALIGN_CENTER, pageW);
                doc.add(ti);
                Image di = BanglaPdf.text(cb, cache, dateText, false, 9, grey, Element.ALIGN_CENTER, pageW);
                di.setSpacingAfter(6);
                doc.add(di);
            } else {
                Paragraph title = new Paragraph(titleText, FontFactory.getFont(FontFactory.HELVETICA_BOLD, 11));
                title.setAlignment(Element.ALIGN_CENTER);
                doc.add(title);
                Paragraph dateP = new Paragraph(dateText, FontFactory.getFont(FontFactory.HELVETICA, 9, Font.NORMAL, grey));
                dateP.setAlignment(Element.ALIGN_CENTER);
                dateP.setSpacingAfter(6);
                doc.add(dateP);
            }

            float[] ratio = {5.2f, 2.6f, 1.4f, 2.2f};
            float sum = 0; for (float r : ratio) sum += r;
            float[] colW = new float[ratio.length];
            for (int i = 0; i < ratio.length; i++) colW[i] = ratio[i] / sum * pageW;

            Color teal = PdfKit.TINT;
            PdfPTable tbl = new PdfPTable(4);
            tbl.setTotalWidth(colW);
            tbl.setLockedWidth(true);
            tbl.setHeaderRows(1);
            tbl.setSpacingAfter(8);

            String[] heads  = bn ? new String[]{"পণ্য", "গুদাম", "পরিমাণ", "মূল্য (ক্রয়)"}
                                 : new String[]{"Product", "Warehouse", "Qty", "Value (cost)"};
            int[]    aligns = {Element.ALIGN_LEFT, Element.ALIGN_LEFT,
                               Element.ALIGN_RIGHT, Element.ALIGN_RIGHT};
            for (int i = 0; i < heads.length; i++) {
                PdfPCell h = pdfText(bn, cb, cache, heads[i], true, PdfKit.INK, aligns[i], colW[i], 3);
                h.setBackgroundColor(teal);
                tbl.addCell(h);
            }

            BigDecimal totalValue = BigDecimal.ZERO;
            for (StockLayerRepository.StockRow r : rows) {
                String product   = productNames.getOrDefault(r.getProductId(), r.getProductId().toString());
                String warehouse = warehouseNames.getOrDefault(r.getWarehouseId(), r.getWarehouseId().toString());
                BigDecimal qty   = r.getQty();
                BigDecimal val   = r.getValue().setScale(2, RoundingMode.HALF_UP);
                totalValue = totalValue.add(val);

                tbl.addCell(pdfText(bn, cb, cache, product,   false, Color.BLACK, Element.ALIGN_LEFT,  colW[0], 2.5f));
                tbl.addCell(pdfText(bn, cb, cache, warehouse, false, Color.BLACK, Element.ALIGN_LEFT,  colW[1], 2.5f));
                tbl.addCell(pdfText(bn, cb, cache, qty.stripTrailingZeros().toPlainString(), false, Color.BLACK, Element.ALIGN_RIGHT, colW[2], 2.5f));
                tbl.addCell(pdfText(bn, cb, cache, String.format("%,.2f", val), false, Color.BLACK, Element.ALIGN_RIGHT, colW[3], 2.5f));
            }

            PdfPCell tlabel = pdfText(bn, cb, cache, bn ? "মোট মজুদ মূল্য" : "TOTAL INVENTORY VALUE", true, Color.BLACK,
                Element.ALIGN_RIGHT, colW[0] + colW[1] + colW[2], 4);
            tlabel.setColspan(3);
            tbl.addCell(tlabel);
            tbl.addCell(pdfText(bn, cb, cache, String.format("%,.2f", totalValue.setScale(2, RoundingMode.HALF_UP)),
                true, Color.BLACK, Element.ALIGN_RIGHT, colW[3], 4));

            doc.add(tbl);
            doc.close();

            return ResponseEntity.ok()
                .header("Content-Disposition",
                    "attachment; filename=\"stock-on-hand-" + LocalDate.now() + (bn ? "-bn" : "") + ".pdf\"")
                .body(out.toByteArray());

        } catch (Exception e) {
            throw new ApiException("Failed to generate stock report: " + e.getMessage());
        }
    }

    /** Table cell: Helvetica for English/digits, shaped vector outlines when the text has Bangla. 9pt, 5pt side padding. */
    private static PdfPCell pdfText(boolean bn, PdfContentByte cb, BanglaPdf.Cache cache, String text, boolean bold, Color color,
                                    int align, float colWidth, float padV) {
        PdfPCell c;
        if (bn && BanglaPdf.hasBengali(text)) {
            c = BanglaPdf.cell(cb, cache, text, bold, 9, color, align, colWidth, padV, 5);
        } else {
            c = new PdfPCell(new Phrase(text != null ? text : "",
                FontFactory.getFont(bold ? FontFactory.HELVETICA_BOLD : FontFactory.HELVETICA, 9, Font.NORMAL, color)));
            c.setHorizontalAlignment(align);
            c.setPaddingTop(padV); c.setPaddingBottom(padV);
            c.setPaddingLeft(5);   c.setPaddingRight(5);
        }
        c.setVerticalAlignment(com.lowagie.text.Element.ALIGN_MIDDLE);
        return c;
    }
}
