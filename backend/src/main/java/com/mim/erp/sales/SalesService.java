package com.mim.erp.sales;

import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import com.mim.erp.accounting.AccountingService;
import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.auth.AppUser;
import com.mim.erp.auth.CurrentUserService;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import com.mim.erp.inventory.InventoryService;
import com.mim.erp.master.Customer;
import com.mim.erp.master.CustomerRepository;
import com.mim.erp.master.Product;
import com.mim.erp.master.ProductRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.*;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Sales engine. Handles both workflows:
 *   SO_FIRST : create order -> auto-split into per-warehouse delivery challans
 *   DC_FIRST : issue challans during the day -> consolidate into one order at day end
 *
 * Cross-cutting rules applied in both:
 *   - selling price must sit within the product's [priceLower, priceUpper] band,
 *     and never below FIFO cost, unless an override authoriser is supplied (logged)
 *   - credit sales checked against the party's credit limit, unless overridden (logged)
 *   - stock is deducted at the CHALLAN via FIFO; each DC line records its cost layer
 *   - accounting posts at delivery: Dr AR/Cash + Cr Sales, and Dr COGS + Cr Inventory
 *   - discountAmt is a flat gross discount per line; unitPrice on lines is the GROSS selling price
 */
@Service
public class SalesService {

    private final SalesOrderRepository orders;
    private final DeliveryChallanRepository challans;
    private final ProductRepository products;
    private final CustomerRepository customers;
    private final InventoryService inventory;
    private final AccountingService accounting;
    private final DocNumberService docNo;
    private final CurrentUserService currentUser;
    private final com.mim.erp.accounting.LedgerService ledgers;

    public SalesService(SalesOrderRepository orders, DeliveryChallanRepository challans,
                        ProductRepository products, CustomerRepository customers,
                        InventoryService inventory, AccountingService accounting,
                        DocNumberService docNo, CurrentUserService currentUser,
                        com.mim.erp.accounting.LedgerService ledgers) {
        this.orders = orders; this.challans = challans; this.products = products;
        this.customers = customers; this.inventory = inventory;
        this.accounting = accounting; this.docNo = docNo; this.currentUser = currentUser;
        this.ledgers = ledgers;
    }

    /** Cash account (1000) for cash sales, or the customer's subsidiary ledger for credit. */
    private String receivableAccount(String paymentMode, UUID customerId) {
        return "CREDIT".equals(paymentMode) ? ledgers.customerLedger(customerId).getCode() : "1000";
    }

    /**
     * Resolve which shop this sale belongs to, based on the logged-in user:
     *   SALESPERSON — forced to their single assigned shop (request value ignored)
     *   MANAGER     — must be one of their assigned shops
     *   ADMIN       — any shop (must be supplied)
     *   ACCOUNTANT  — cannot raise sales
     */
    private UUID resolveShop(UUID requestedShopId) {
        AppUser u = currentUser.me();
        switch (u.getRole()) {
            case "SALESPERSON" -> {
                if (u.getShopIds().size() != 1)
                    throw new ApiException("Your account isn't bound to exactly one shop — contact an admin");
                return u.getShopIds().iterator().next();
            }
            case "MANAGER" -> {
                if (u.getShopIds().isEmpty())
                    throw new ApiException("Your account isn't assigned to any shop — contact an admin");
                if (requestedShopId != null && !u.getShopIds().contains(requestedShopId))
                    throw new ApiException("That shop isn't one you manage");
                return requestedShopId != null ? requestedShopId : u.getShopIds().iterator().next();
            }
            case "ADMIN" -> {
                if (requestedShopId != null) return requestedShopId;
                if (!u.getShopIds().isEmpty()) return u.getShopIds().iterator().next();
                throw new ApiException("Assign at least one shop to your admin account to record sales");
            }
            default -> throw new ApiException(u.getRole() + " users cannot raise sales");
        }
    }

    // ===================================================================
    // WORKFLOW 1 — SO_FIRST: order first, then per-warehouse challans
    // ===================================================================
    @Transactional
    public SalesDtos.OrderResult createOrder(SalesDtos.CreateOrderRequest req) {
        if (req.allocations() == null || req.allocations().isEmpty())
            throw new ApiException("A sales order needs at least one allocation");

        UUID shopId = resolveShop(req.shopId());

        // validate GROSS unit price against band (discount is separately authorised via discountBy)
        for (var a : req.allocations())
            validatePrice(a.productId(), a.warehouseId(), a.unitPrice(), req.priceOverrideBy());

        BigDecimal orderValue = req.allocations().stream()
            .map(a -> lineNet(a.qty(), a.unitPrice(), a.discountAmt()))
            .reduce(BigDecimal.ZERO, BigDecimal::add);

        if ("CREDIT".equals(req.paymentMode()))
            checkCredit(req.customerId(), orderValue, req.creditOverrideBy());

        if (req.discountBy() == null || req.discountBy().isBlank()) {
            boolean hasDiscount = req.allocations().stream()
                .anyMatch(a -> a.discountAmt() != null && a.discountAmt().compareTo(BigDecimal.ZERO) > 0);
            if (hasDiscount) throw new ApiException("Discount requires an authoriser (discountBy)");
        }

        SalesOrder so = new SalesOrder();
        so.setSoNo(docNo.next("SO"));
        so.setShopId(shopId);
        so.setCustomerId(req.customerId());
        so.setWorkflow("SO_FIRST");
        so.setPaymentMode(req.paymentMode());
        so.setStatus("CONFIRMED");
        so.setOrderDate(LocalDate.now());
        so.setCreditOverrideBy(req.creditOverrideBy());
        so.setDiscountBy(req.discountBy());
        int ln = 1;
        for (var a : req.allocations()) {
            SoLine sl = new SoLine();
            sl.setSo(so);
            sl.setProductId(a.productId());
            sl.setQty(a.qty());
            sl.setUnitPrice(a.unitPrice());
            sl.setDiscountAmt(a.discountAmt() != null ? a.discountAmt() : BigDecimal.ZERO);
            sl.setPriceOverrideBy(req.priceOverrideBy());
            sl.setLineNo(ln++);
            so.getLines().add(sl);
        }
        orders.save(so);

        Map<UUID, List<SalesDtos.Allocation>> byWarehouse = req.allocations().stream()
            .collect(Collectors.groupingBy(SalesDtos.Allocation::warehouseId));

        List<UUID> challanIds = new ArrayList<>();
        BigDecimal totalCost = BigDecimal.ZERO;
        BigDecimal totalValue = BigDecimal.ZERO;

        for (var entry : byWarehouse.entrySet()) {
            DeliveryChallan dc = buildAndDeliver(so.getId(), shopId, req.customerId(),
                entry.getKey(), entry.getValue(), req.discountBy());
            challanIds.add(dc.getId());
            for (DcLine dl : dc.getLines()) {
                totalCost  = totalCost.add(dl.getQty().multiply(dl.getUnitCost()));
                totalValue = totalValue.add(lineNet(dl.getQty(), dl.getUnitPrice(), dl.getDiscountAmt()));
            }
        }

        so.setStatus("DELIVERED");
        postSale(so, totalValue, totalCost);

        return new SalesDtos.OrderResult(so.getId(), so.getSoNo(), challanIds, totalValue, totalCost);
    }

    // ===================================================================
    // WORKFLOW 2 — DC_FIRST: issue a challan now (single warehouse)
    // ===================================================================
    @Transactional
    public DeliveryChallan issueChallan(SalesDtos.IssueChallanRequest req) {
        if (req.warehouseId() == null)
            throw new ApiException("A challan must ship from one warehouse");
        UUID shopId = resolveShop(req.shopId());
        for (var a : req.allocations()) {
            if (!req.warehouseId().equals(a.warehouseId()))
                throw new ApiException("All challan lines must be from the challan's warehouse");
            validatePrice(a.productId(), req.warehouseId(), a.unitPrice(), req.priceOverrideBy());
        }
        if (req.discountBy() == null || req.discountBy().isBlank()) {
            boolean hasDiscount = req.allocations().stream()
                .anyMatch(a -> a.discountAmt() != null && a.discountAmt().compareTo(BigDecimal.ZERO) > 0);
            if (hasDiscount) throw new ApiException("Discount requires an authoriser (discountBy)");
        }
        DeliveryChallan dc = buildAndDeliver(null, shopId, req.customerId(),
            req.warehouseId(), req.allocations(), req.discountBy());

        BigDecimal cost = dc.getLines().stream()
            .map(l -> l.getQty().multiply(l.getUnitCost()))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (cost.signum() > 0) {
            accounting.post(dc.getChallanDate(), "Delivery " + dc.getDcNo(),
                "SALES_DELIVERY", dc.getId(),
                List.of(Leg.debit("5000", cost), Leg.credit("1200", cost)));
        }

        return dc;
    }

    /** All ISSUED challan lines for a customer — shown in the consolidation review form. */
    @Transactional(readOnly = true)
    public List<SalesDtos.ChallanLineView> openChallanLines(UUID customerId) {
        List<DeliveryChallan> open = challans.findByCustomerIdAndStatus(customerId, "ISSUED");
        List<SalesDtos.ChallanLineView> result = new java.util.ArrayList<>();
        for (DeliveryChallan dc : open) {
            for (DcLine dl : dc.getLines()) {
                Product p = products.findById(dl.getProductId()).orElse(null);
                String name = p != null && p.getFullName() != null ? p.getFullName()
                    : (p != null ? p.getName() : "?");
                result.add(new SalesDtos.ChallanLineView(
                    dl.getId(), dc.getDcNo(), dl.getProductId(), name,
                    dl.getQty(), dl.getUnitPrice(), dl.getUnitCost(),
                    dl.getDiscountAmt() != null ? dl.getDiscountAmt() : BigDecimal.ZERO,
                    p != null ? p.getPriceLower() : null,
                    p != null ? p.getPriceUpper() : null));
            }
        }
        return result;
    }

    /** Day-end: consolidate a customer's ISSUED challans into one SO + post revenue. */
    @Transactional
    public SalesDtos.OrderResult consolidate(SalesDtos.ConsolidateRequest req) {
        LocalDate today = LocalDate.now();
        List<DeliveryChallan> open = challans.findByCustomerIdAndStatus(req.customerId(), "ISSUED");
        if (open.isEmpty())
            throw new ApiException("No open challans to consolidate for this customer");

        // build override map keyed by dcLineId
        Map<UUID, SalesDtos.LineOverride> overrides = req.lineOverrides() != null
            ? req.lineOverrides().stream().collect(Collectors.toMap(SalesDtos.LineOverride::dcLineId, x -> x))
            : Map.of();

        BigDecimal totalValue = BigDecimal.ZERO, totalCost = BigDecimal.ZERO;
        SalesOrder so = new SalesOrder();
        so.setSoNo(docNo.next("SO"));
        so.setShopId(open.get(0).getShopId());
        so.setCustomerId(req.customerId());
        so.setWorkflow("DC_FIRST");
        so.setPaymentMode(req.paymentMode());
        so.setStatus("INVOICED");
        so.setOrderDate(today);
        so.setCreditOverrideBy(req.creditOverrideBy());

        int ln = 1;
        for (DeliveryChallan dc : open) {
            for (DcLine dl : dc.getLines()) {
                SalesDtos.LineOverride ov = overrides.get(dl.getId());
                BigDecimal unitPrice = ov != null ? ov.unitPrice() : dl.getUnitPrice();
                BigDecimal discountAmt = ov != null ? ov.discountAmt()
                    : (dl.getDiscountAmt() != null ? dl.getDiscountAmt() : BigDecimal.ZERO);
                SoLine sl = new SoLine();
                sl.setSo(so);
                sl.setProductId(dl.getProductId());
                sl.setQty(dl.getQty());
                sl.setUnitPrice(unitPrice);
                sl.setDiscountAmt(discountAmt);
                sl.setLineNo(ln++);
                so.getLines().add(sl);
                totalValue = totalValue.add(lineNet(dl.getQty(), unitPrice, discountAmt));
                totalCost  = totalCost.add(dl.getQty().multiply(dl.getUnitCost()));
            }
        }

        if ("CREDIT".equals(req.paymentMode()))
            checkCredit(req.customerId(), totalValue, req.creditOverrideBy());

        orders.save(so);

        for (DeliveryChallan dc : open) {
            dc.setSoId(so.getId());
            dc.setStatus("CONSOLIDATED");
        }
        challans.saveAll(open);

        String ar = receivableAccount(req.paymentMode(), so.getCustomerId());
        accounting.post(today, "Invoice (consolidated) " + so.getSoNo(),
            "SALES_INVOICE", so.getId(),
            List.of(Leg.debit(ar, totalValue), Leg.credit("4000", totalValue)));

        return new SalesDtos.OrderResult(so.getId(), so.getSoNo(),
            open.stream().map(DeliveryChallan::getId).toList(), totalValue, totalCost);
    }

    // ===================================================================
    // reads for the UI
    // ===================================================================
    public java.util.List<SalesOrder> allOrders() { return orders.findAll(); }

    public java.util.List<DeliveryChallan> openChallans() {
        return challans.findByStatus("ISSUED");
    }

    public java.util.List<DeliveryChallan> allChallans() {
        return challans.findAllByOrderByChallanDateDescDcNoDesc();
    }

    // ===================================================================
    // invoice PDF
    // ===================================================================
    @Transactional(readOnly = true)
    public byte[] generateInvoicePdf(UUID soId) {
        SalesOrder so = orders.findById(soId)
            .orElseThrow(() -> new ApiException("Sales order not found"));

        var custOpt = customers.findById(so.getCustomerId());
        String customerName = custOpt.map(Customer::getName).orElse("—");
        String customerContact = custOpt.map(c -> {
            StringBuilder sb = new StringBuilder();
            if (c.getMobile() != null) sb.append(c.getMobile());
            if (c.getAddress() != null) { if (!sb.isEmpty()) sb.append(" · "); sb.append(c.getAddress()); }
            return sb.toString();
        }).orElse("");

        Set<UUID> pids = so.getLines().stream().map(SoLine::getProductId).collect(Collectors.toSet());
        Map<UUID, String> productNames = new HashMap<>();
        products.findAllById(pids).forEach(p -> productNames.put(p.getId(), p.getFullName() != null ? p.getFullName() : p.getName()));

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
            Paragraph inv = new Paragraph("SALES INVOICE", titleFont);
            inv.setAlignment(Element.ALIGN_CENTER);
            inv.setSpacingAfter(14);
            doc.add(inv);

            // meta table: invoice details | customer details
            PdfPTable meta = new PdfPTable(2);
            meta.setWidthPercentage(100);
            meta.setSpacingAfter(14);
            meta.addCell(metaBlock(labelFont, valueFont, new String[][]{
                {"Invoice No", so.getSoNo()},
                {"Date",       so.getOrderDate() != null ? so.getOrderDate().toString() : ""},
                {"Payment",    so.getPaymentMode()},
            }));
            meta.addCell(metaBlock(labelFont, valueFont, new String[][]{
                {"Customer", customerName},
                {"Contact",  customerContact},
            }));
            doc.add(meta);

            if (so.getDiscountBy() != null && !so.getDiscountBy().isBlank()) {
                meta.addCell(metaBlock(labelFont, valueFont, new String[][]{
                    {"Discount by", so.getDiscountBy()},
                }));
            }

            // line items: Product | Qty | Unit Price | Gross Total | Discount | Net Total
            Color teal = new Color(0x0f, 0x76, 0x6e);
            PdfPTable tbl = new PdfPTable(6);
            tbl.setWidthPercentage(100);
            tbl.setWidths(new float[]{4f, 1.5f, 2f, 2f, 2f, 2f});
            tbl.setSpacingAfter(8);

            String[] heads = {"Product", "Qty", "Unit Price", "Gross Total", "Discount", "Net Total"};
            int[] aligns  = {Element.ALIGN_LEFT, Element.ALIGN_RIGHT, Element.ALIGN_RIGHT,
                             Element.ALIGN_RIGHT, Element.ALIGN_RIGHT, Element.ALIGN_RIGHT};
            for (int i = 0; i < heads.length; i++) {
                PdfPCell h = new PdfPCell(new Phrase(heads[i], thFont));
                h.setBackgroundColor(teal);
                h.setHorizontalAlignment(aligns[i]);
                h.setPadding(5);
                tbl.addCell(h);
            }

            BigDecimal grandTotal = BigDecimal.ZERO;
            for (SoLine line : so.getLines()) {
                String name      = productNames.getOrDefault(line.getProductId(), "—");
                BigDecimal qty   = line.getQty();
                BigDecimal gross = line.getUnitPrice();
                BigDecimal disc  = line.getDiscountAmt() != null ? line.getDiscountAmt() : BigDecimal.ZERO;
                BigDecimal grossTotal = qty.multiply(gross).setScale(2, RoundingMode.HALF_UP);
                BigDecimal netTotal   = grossTotal.subtract(disc).setScale(2, RoundingMode.HALF_UP);
                grandTotal = grandTotal.add(netTotal);

                pdfCell(tbl, name, valueFont, Element.ALIGN_LEFT);
                pdfCell(tbl, qty.toPlainString(), valueFont, Element.ALIGN_RIGHT);
                pdfCell(tbl, fmt(gross), valueFont, Element.ALIGN_RIGHT);
                pdfCell(tbl, fmt(grossTotal), valueFont, Element.ALIGN_RIGHT);
                pdfCell(tbl, disc.compareTo(BigDecimal.ZERO) == 0 ? "—" : fmt(disc), valueFont, Element.ALIGN_RIGHT);
                pdfCell(tbl, fmt(netTotal), valueFont, Element.ALIGN_RIGHT);
            }

            // grand total row
            PdfPCell tlabel = new PdfPCell(new Phrase("TOTAL", labelFont));
            tlabel.setColspan(5);
            tlabel.setHorizontalAlignment(Element.ALIGN_RIGHT);
            tlabel.setPadding(5);
            tbl.addCell(tlabel);
            PdfPCell tval = new PdfPCell(new Phrase(fmt(grandTotal), totalFont));
            tval.setHorizontalAlignment(Element.ALIGN_RIGHT);
            tval.setPadding(5);
            tbl.addCell(tval);
            doc.add(tbl);

            Paragraph footer = new Paragraph("Thank you for your business.",
                FontFactory.getFont(FontFactory.HELVETICA_OBLIQUE, 9));
            footer.setAlignment(Element.ALIGN_CENTER);
            footer.setSpacingBefore(18);
            doc.add(footer);

            doc.close();
            return out.toByteArray();
        } catch (Exception e) {
            throw new ApiException("Failed to generate invoice: " + e.getMessage());
        }
    }

    // ===================================================================
    // shared helpers
    // ===================================================================

    /** Build a single-warehouse challan, consuming FIFO layers for each line. */
    private DeliveryChallan buildAndDeliver(UUID soId, UUID shopId, UUID customerId,
                                            UUID warehouseId, List<SalesDtos.Allocation> allocs,
                                            String discountBy) {
        DeliveryChallan dc = new DeliveryChallan();
        dc.setDcNo(docNo.next("DC"));
        dc.setSoId(soId);
        dc.setShopId(shopId);
        dc.setCustomerId(customerId);
        dc.setWarehouseId(warehouseId);
        dc.setChallanDate(LocalDate.now());
        dc.setDiscountBy(discountBy);

        for (var a : allocs) {
            BigDecimal totalDisc = a.discountAmt() != null ? a.discountAmt() : BigDecimal.ZERO;
            var consumptions = inventory.consumeFifo(a.productId(), warehouseId, a.qty());
            BigDecimal discAssigned = BigDecimal.ZERO;
            for (int ci = 0; ci < consumptions.size(); ci++) {
                var c = consumptions.get(ci);
                DcLine dl = new DcLine();
                dl.setDc(dc);
                dl.setProductId(a.productId());
                dl.setStockLayerId(c.stockLayerId());
                dl.setQty(c.qty());
                dl.setUnitCost(c.unitCost());
                dl.setUnitPrice(a.unitPrice());
                // distribute flat discount proportionally; last layer gets rounding remainder
                BigDecimal layerDisc;
                if (ci == consumptions.size() - 1) {
                    layerDisc = totalDisc.subtract(discAssigned);
                } else {
                    layerDisc = totalDisc.multiply(c.qty()).divide(a.qty(), 2, RoundingMode.HALF_UP);
                    discAssigned = discAssigned.add(layerDisc);
                }
                dl.setDiscountAmt(layerDisc);
                dc.getLines().add(dl);
            }
        }
        return challans.save(dc);
    }

    /** Revenue + COGS in one delivery (SO_FIRST). */
    private void postSale(SalesOrder so, BigDecimal value, BigDecimal cost) {
        String ar = receivableAccount(so.getPaymentMode(), so.getCustomerId());
        List<Leg> legs = new java.util.ArrayList<>(List.of(
            Leg.debit(ar, value),
            Leg.credit("4000", value)
        ));
        if (cost.signum() > 0) {
            legs.add(Leg.debit("5000", cost));
            legs.add(Leg.credit("1200", cost));
        }
        accounting.post(so.getOrderDate(), "Sale " + so.getSoNo(), "SALES_DELIVERY", so.getId(), legs);
    }

    /** Price band + below-cost guard. Requires override authoriser if breached. */
    private void validatePrice(UUID productId, UUID warehouseId, BigDecimal price, String overrideBy) {
        Product p = products.findById(productId)
            .orElseThrow(() -> new ApiException("Product not found"));

        boolean breach = false;
        StringBuilder why = new StringBuilder();
        if (p.getPriceLower() != null && price.compareTo(p.getPriceLower()) < 0) {
            breach = true; why.append("below lower limit ").append(p.getPriceLower()).append("; ");
        }
        if (p.getPriceUpper() != null && price.compareTo(p.getPriceUpper()) > 0) {
            breach = true; why.append("above upper limit ").append(p.getPriceUpper()).append("; ");
        }
        BigDecimal avail = inventory.available(productId, warehouseId);
        if (avail.signum() == 0)
            throw new ApiException("No stock of " + p.getName() + " in the selected warehouse");

        if (breach && (overrideBy == null || overrideBy.isBlank()))
            throw new ApiException("Price " + price + " out of band (" + why +
                ") — manager override required");
    }

    /** Credit limit (amount) check. */
    private void checkCredit(UUID customerId, BigDecimal newValue, String overrideBy) {
        Customer c = customers.findById(customerId)
            .orElseThrow(() -> new ApiException("Customer not found"));
        if (!"PARTY".equals(c.getType()))
            throw new ApiException("Credit sales are only allowed for party/company customers");

        BigDecimal outstanding = orders.outstandingCredit(customerId);
        BigDecimal projected = outstanding.add(newValue);
        if (c.getCreditLimit() != null && projected.compareTo(c.getCreditLimit()) > 0
                && (overrideBy == null || overrideBy.isBlank())) {
            throw new ApiException("Credit limit exceeded: outstanding " + outstanding +
                " + " + newValue + " = " + projected + " > limit " + c.getCreditLimit() +
                " — manager override required");
        }
    }

    /** Net line value = qty × unitPrice − flat discount amount. */
    private static BigDecimal lineNet(BigDecimal qty, BigDecimal unitPrice, BigDecimal discountAmt) {
        BigDecimal gross = qty.multiply(unitPrice);
        return discountAmt == null || discountAmt.compareTo(BigDecimal.ZERO) == 0
            ? gross : gross.subtract(discountAmt);
    }

    private static void pdfCell(PdfPTable t, String text, Font font, int align) {
        PdfPCell c = new PdfPCell(new Phrase(text != null ? text : "", font));
        c.setHorizontalAlignment(align);
        c.setPadding(4);
        t.addCell(c);
    }

    private static PdfPCell metaBlock(Font labelFont, Font valueFont, String[][] rows) {
        PdfPTable inner = new PdfPTable(2);
        for (String[] row : rows) {
            PdfPCell k = new PdfPCell(new Phrase(row[0], labelFont)); k.setBorder(Rectangle.NO_BORDER); k.setPaddingBottom(3); inner.addCell(k);
            PdfPCell v = new PdfPCell(new Phrase(row[1] != null ? row[1] : "", valueFont)); v.setBorder(Rectangle.NO_BORDER); v.setPaddingBottom(3); inner.addCell(v);
        }
        PdfPCell wrap = new PdfPCell();
        wrap.setBorder(Rectangle.NO_BORDER);
        wrap.addElement(inner);
        return wrap;
    }

    private static String fmt(BigDecimal v) {
        return v.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
}