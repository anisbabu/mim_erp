package com.mim.erp.inventory;

import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import com.mim.erp.common.ApiException;
import com.mim.erp.master.ProductRepository;
import com.mim.erp.master.WarehouseRepository;
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

    public InventoryController(StockLayerRepository layers,
                               ProductRepository products,
                               WarehouseRepository warehouses) {
        this.layers = layers;
        this.products = products;
        this.warehouses = warehouses;
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

    /** Stock-on-hand report as PDF. */
    @GetMapping(value = "/stock-report", produces = "application/pdf")
    public ResponseEntity<byte[]> stockReport() {
        List<StockLayerRepository.StockRow> rows = layers.stockOverview();

        Map<UUID, String> productNames = new HashMap<>();
        products.findAll().forEach(p -> productNames.put(p.getId(), p.getName()));

        Map<UUID, String> warehouseNames = new HashMap<>();
        warehouses.findAll().forEach(w -> warehouseNames.put(w.getId(), w.getName()));

        try {
            Document doc = new Document(PageSize.A4, 40, 40, 60, 40);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfWriter.getInstance(doc, out);
            doc.open();

            Font companyFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 20);
            Font titleFont   = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 13);
            Font labelFont   = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9);
            Font valueFont   = FontFactory.getFont(FontFactory.HELVETICA, 9);
            Font thFont      = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9, Font.NORMAL, Color.WHITE);
            Font totalFont   = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9);

            Paragraph co = new Paragraph("MIM ENTERPRISE", companyFont);
            co.setAlignment(Element.ALIGN_CENTER);
            doc.add(co);

            Paragraph title = new Paragraph("STOCK ON HAND", titleFont);
            title.setAlignment(Element.ALIGN_CENTER);
            doc.add(title);

            Paragraph dateP = new Paragraph("As of " + LocalDate.now(),
                FontFactory.getFont(FontFactory.HELVETICA, 9));
            dateP.setAlignment(Element.ALIGN_CENTER);
            dateP.setSpacingAfter(16);
            doc.add(dateP);

            Color teal = new Color(0x0f, 0x76, 0x6e);
            PdfPTable tbl = new PdfPTable(4);
            tbl.setWidthPercentage(100);
            tbl.setWidths(new float[]{4f, 2.5f, 2f, 2.5f});
            tbl.setSpacingAfter(8);

            String[] heads  = {"Product", "Warehouse", "Qty", "Value (cost)"};
            int[]    aligns = {Element.ALIGN_LEFT, Element.ALIGN_LEFT,
                               Element.ALIGN_RIGHT, Element.ALIGN_RIGHT};
            for (int i = 0; i < heads.length; i++) {
                PdfPCell h = new PdfPCell(new Phrase(heads[i], thFont));
                h.setBackgroundColor(teal);
                h.setHorizontalAlignment(aligns[i]);
                h.setPadding(5);
                if (aligns[i] == Element.ALIGN_RIGHT) h.setPaddingRight(8);
                tbl.addCell(h);
            }

            BigDecimal totalValue = BigDecimal.ZERO;
            for (StockLayerRepository.StockRow r : rows) {
                String product   = productNames.getOrDefault(r.getProductId(), r.getProductId().toString());
                String warehouse = warehouseNames.getOrDefault(r.getWarehouseId(), r.getWarehouseId().toString());
                BigDecimal qty   = r.getQty();
                BigDecimal val   = r.getValue().setScale(2, RoundingMode.HALF_UP);
                totalValue = totalValue.add(val);

                pdfCell(tbl, product,   valueFont, Element.ALIGN_LEFT);
                pdfCell(tbl, warehouse, valueFont, Element.ALIGN_LEFT);
                pdfNumCell(tbl, qty.stripTrailingZeros().toPlainString(), valueFont);
                pdfNumCell(tbl, val.toPlainString(), valueFont);
            }

            PdfPCell tlabel = new PdfPCell(new Phrase("TOTAL INVENTORY VALUE", labelFont));
            tlabel.setColspan(3);
            tlabel.setHorizontalAlignment(Element.ALIGN_RIGHT);
            tlabel.setPadding(5);
            tbl.addCell(tlabel);
            PdfPCell tval = new PdfPCell(
                new Phrase(totalValue.setScale(2, RoundingMode.HALF_UP).toPlainString(), totalFont));
            tval.setHorizontalAlignment(Element.ALIGN_RIGHT);
            tval.setPadding(5);
            tval.setPaddingRight(8);
            tbl.addCell(tval);

            doc.add(tbl);
            doc.close();

            return ResponseEntity.ok()
                .header("Content-Disposition",
                    "attachment; filename=\"stock-on-hand-" + LocalDate.now() + ".pdf\"")
                .body(out.toByteArray());

        } catch (Exception e) {
            throw new ApiException("Failed to generate stock report: " + e.getMessage());
        }
    }

    private static void pdfCell(PdfPTable t, String text, Font font, int align) {
        PdfPCell c = new PdfPCell(new Phrase(text != null ? text : "", font));
        c.setHorizontalAlignment(align);
        c.setPadding(5);
        t.addCell(c);
    }

    private static void pdfNumCell(PdfPTable t, String text, Font font) {
        PdfPCell c = new PdfPCell(new Phrase(text != null ? text : "", font));
        c.setHorizontalAlignment(Element.ALIGN_RIGHT);
        c.setPadding(5);
        c.setPaddingRight(8);
        t.addCell(c);
    }
}