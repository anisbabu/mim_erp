package com.mim.erp.sales;

import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import com.mim.erp.accounting.AccountingService;
import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.auth.AppUser;
import com.mim.erp.auth.CurrentUserService;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import com.mim.erp.common.PdfKit;
import com.mim.erp.inventory.InventoryService;
import com.mim.erp.master.Customer;
import com.mim.erp.master.CustomerRepository;
import com.mim.erp.master.Product;
import com.mim.erp.master.ProductRepository;
import com.mim.erp.master.Warehouse;
import com.mim.erp.master.WarehouseRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
    private static final Logger log = LoggerFactory.getLogger(SalesService.class);

    private final SalesOrderRepository orders;
    private final DeliveryChallanRepository challans;
    private final ProductRepository products;
    private final CustomerRepository customers;
    private final InventoryService inventory;
    private final AccountingService accounting;
    private final DocNumberService docNo;
    private final CurrentUserService currentUser;
    private final com.mim.erp.accounting.LedgerService ledgers;
    private final WarehouseRepository warehouses;
    private final com.mim.erp.auth.AppUserRepository users;
    private final com.mim.erp.master.ShopRepository shops;

    public SalesService(SalesOrderRepository orders, DeliveryChallanRepository challans,
                        ProductRepository products, CustomerRepository customers,
                        InventoryService inventory, AccountingService accounting,
                        DocNumberService docNo, CurrentUserService currentUser,
                        com.mim.erp.accounting.LedgerService ledgers,
                        WarehouseRepository warehouses,
                        com.mim.erp.auth.AppUserRepository users,
                        com.mim.erp.master.ShopRepository shops) {
        this.users = users;
        this.shops = shops;
        this.orders = orders; this.challans = challans; this.products = products;
        this.customers = customers; this.inventory = inventory;
        this.accounting = accounting; this.docNo = docNo; this.currentUser = currentUser;
        this.ledgers = ledgers; this.warehouses = warehouses;
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

    /**
     * Resolve which salesperson this sale/challan is attributed to:
     *   SALESPERSON — always themselves (request value ignored)
     *   others      — must explicitly choose one (e.g. manager raising on someone's behalf)
     */
    private UUID resolveSalesperson(UUID requested) {
        AppUser u = currentUser.me();
        if ("SALESPERSON".equals(u.getRole())) return u.getId();
        if (requested == null) throw new ApiException("Select a salesperson");
        return requested;
    }

    // ===================================================================
    // WORKFLOW 1 — SO_FIRST: order first, then per-warehouse challans
    // ===================================================================
    @Transactional
    public SalesDtos.OrderResult createOrder(SalesDtos.CreateOrderRequest req) {
        if (req.allocations() == null || req.allocations().isEmpty())
            throw new ApiException("A sales order needs at least one allocation");

        UUID shopId = resolveShop(req.shopId());
        UUID salespersonId = resolveSalesperson(req.salespersonId());

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
        so.setSalespersonId(salespersonId);
        so.setWorkflow("SO_FIRST");
        so.setPaymentMode(req.paymentMode());
        so.setStatus("CONFIRMED");
        so.setOrderDate(LocalDate.now());
        so.setCreditOverrideBy(req.creditOverrideBy());
        so.setDiscountBy(req.discountBy());
        BigDecimal soTransport = req.transportAndLifting() != null ? req.transportAndLifting() : BigDecimal.ZERO;
        so.setTransportAndLifting(soTransport);
        so.setDeliveryAddress(blankToNull(req.deliveryAddress()));
        so.setDeliveryMobile(blankToNull(req.deliveryMobile()));
        int ln = 1;
        boolean anyPending = false, anyDelivered = false;
        // the part taken today is delivered from its warehouse; the rest stays pending on the same line
        List<SalesDtos.Allocation> deliverNow = new ArrayList<>();
        for (var a : req.allocations()) {
            BigDecimal now = a.deliverNow();
            if (now.signum() < 0 || now.compareTo(a.qty()) > 0)
                throw new ApiException("Take-now quantity must be between 0 and the ordered quantity");
            BigDecimal pending = a.qty().subtract(now);
            anyPending   |= pending.signum() > 0;
            anyDelivered |= now.signum() > 0;
            if (now.signum() > 0) {
                BigDecimal disc = a.discountAmt() == null || now.compareTo(a.qty()) == 0 ? a.discountAmt()
                    : a.discountAmt().multiply(now).divide(a.qty(), 2, RoundingMode.HALF_UP);
                deliverNow.add(new SalesDtos.Allocation(a.productId(), a.warehouseId(), now, a.unitPrice(), disc));
            }
            SoLine sl = new SoLine();
            sl.setSo(so);
            sl.setProductId(a.productId());
            sl.setQty(a.qty());
            sl.setUnitPrice(a.unitPrice());
            sl.setDiscountAmt(a.discountAmt() != null ? a.discountAmt() : BigDecimal.ZERO);
            sl.setQtyPending(pending);
            sl.setPriceOverrideBy(overrideFor(a.productId(), a.warehouseId(), a.unitPrice(), req.priceOverrideBy()));
            sl.setLineNo(ln++);
            so.getLines().add(sl);
        }
        orders.save(so);

        Map<UUID, List<SalesDtos.Allocation>> byWarehouse = deliverNow.stream()
            .collect(Collectors.groupingBy(SalesDtos.Allocation::warehouseId));

        List<UUID> challanIds = new ArrayList<>();
        BigDecimal totalCost = BigDecimal.ZERO;

        for (var entry : byWarehouse.entrySet()) {
            DeliveryChallan dc = buildAndDeliver(so.getId(), shopId, req.customerId(), salespersonId,
                entry.getKey(), entry.getValue(), req.discountBy(), req.priceOverrideBy());
            challanIds.add(dc.getId());
            for (DcLine dl : dc.getLines()) {
                totalCost = totalCost.add(dl.getQty().multiply(dl.getUnitCost()));
            }
        }

        BigDecimal totalValue = orderValue.add(soTransport);
        so.setStatus(!anyPending ? "DELIVERED" : anyDelivered ? "PARTIALLY_DELIVERED" : "PENDING");
        postSale(so, totalValue, totalCost);

        return new SalesDtos.OrderResult(so.getId(), so.getSoNo(), challanIds, totalValue, totalCost);
    }

    /** All lines of a sales order — surfaced for the orders list / fulfillment screen. */
    @Transactional(readOnly = true)
    public List<SalesDtos.SoLineView> orderLines(UUID soId) {
        SalesOrder so = orders.findById(soId)
            .orElseThrow(() -> new ApiException("Sales order not found"));
        Set<UUID> pids = so.getLines().stream().map(SoLine::getProductId).collect(Collectors.toSet());
        Map<UUID, String> productNames = new HashMap<>();
        products.findAllById(pids).forEach(p -> productNames.put(p.getId(), p.getFullName() != null ? p.getFullName() : p.getName()));
        return so.getLines().stream()
            .map(sl -> new SalesDtos.SoLineView(sl.getId(), sl.getProductId(),
                productNames.getOrDefault(sl.getProductId(), "—"),
                sl.getQty(), sl.getQtyPending(), sl.getUnitPrice()))
            .toList();
    }

    /** Every pickup (delivery challan) issued under an order, chronologically — for the pickup-history view. */
    @Transactional(readOnly = true)
    public List<SalesDtos.PickupView> orderPickups(UUID soId) {
        List<DeliveryChallan> dcs = challans.findBySoIdWithLines(soId);

        Set<UUID> pids = dcs.stream().flatMap(dc -> dc.getLines().stream().map(DcLine::getProductId))
            .collect(Collectors.toSet());
        Map<UUID, String> productNames = new HashMap<>();
        products.findAllById(pids).forEach(p -> productNames.put(p.getId(), p.getFullName() != null ? p.getFullName() : p.getName()));

        Set<UUID> wids = dcs.stream().map(DeliveryChallan::getWarehouseId)
            .filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        Map<UUID, String> warehouseNames = new HashMap<>();
        warehouses.findAllById(wids).forEach(w -> warehouseNames.put(w.getId(), w.getName()));

        return dcs.stream()
            .sorted(Comparator.comparing(DeliveryChallan::getChallanDate).thenComparing(DeliveryChallan::getDcNo))
            .map(dc -> {
                Map<UUID, BigDecimal> qtyByProduct = new LinkedHashMap<>();
                for (DcLine l : dc.getLines())
                    qtyByProduct.merge(l.getProductId(), l.getQty(), BigDecimal::add);
                List<SalesDtos.PickupLine> lines = qtyByProduct.entrySet().stream()
                    .map(e -> new SalesDtos.PickupLine(e.getKey(), productNames.getOrDefault(e.getKey(), "—"), e.getValue()))
                    .toList();
                String whName = dc.getWarehouseId() != null ? warehouseNames.getOrDefault(dc.getWarehouseId(), "—") : "—";
                return new SalesDtos.PickupView(dc.getId(), dc.getDcNo(), dc.getChallanDate(), whName, lines);
            })
            .toList();
    }

    /**
     * Fulfil part or all of an order's outstanding (backordered) lines now that stock
     * exists. Deducts FIFO stock per chosen warehouse, creates a delivery challan per
     * warehouse, and posts COGS only (revenue was already posted at order creation).
     */
    @Transactional
    public SalesOrder fulfillOrder(UUID soId, SalesDtos.FulfillRequest req) {
        if (req.lines() == null || req.lines().isEmpty())
            throw new ApiException("Select at least one line to fulfil");

        SalesOrder so = orders.findById(soId)
            .orElseThrow(() -> new ApiException("Sales order not found"));
        Map<UUID, SoLine> byId = so.getLines().stream()
            .collect(Collectors.toMap(SoLine::getId, sl -> sl));

        Map<UUID, List<SalesDtos.Allocation>> byWarehouse = new LinkedHashMap<>();
        Map<UUID, BigDecimal> fulfilledBySoLine = new LinkedHashMap<>();
        for (var fl : req.lines()) {
            SoLine sl = byId.get(fl.soLineId());
            if (sl == null) throw new ApiException("Line does not belong to this order");
            if (fl.warehouseId() == null) throw new ApiException("Choose a warehouse to fulfil " + sl.getProductId());
            if (fl.qty() == null || fl.qty().signum() <= 0) throw new ApiException("Quantity to fulfil must be positive");
            if (fl.qty().compareTo(sl.getQtyPending()) > 0)
                throw new ApiException("Cannot fulfil more than the pending quantity for this line");

            BigDecimal disc = sl.getQty().signum() == 0 ? BigDecimal.ZERO
                : sl.getDiscountAmt().multiply(fl.qty()).divide(sl.getQty(), 2, RoundingMode.HALF_UP);
            var alloc = new SalesDtos.Allocation(sl.getProductId(), fl.warehouseId(), fl.qty(), sl.getUnitPrice(), disc);
            byWarehouse.computeIfAbsent(fl.warehouseId(), k -> new ArrayList<>()).add(alloc);
            fulfilledBySoLine.merge(fl.soLineId(), fl.qty(), BigDecimal::add);
        }

        for (var entry : byWarehouse.entrySet()) {
            DeliveryChallan dc = buildAndDeliver(so.getId(), so.getShopId(), so.getCustomerId(),
                so.getSalespersonId(), entry.getKey(), entry.getValue(), so.getDiscountBy(), null);
            BigDecimal cost = dc.getLines().stream()
                .map(l -> l.getQty().multiply(l.getUnitCost()))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
            if (cost.signum() > 0) {
                accounting.post(dc.getChallanDate(), "Fulfillment " + dc.getDcNo(),
                    "SALES_DELIVERY", dc.getId(),
                    List.of(Leg.debit("5000", cost), Leg.credit("1200", cost)));
            }
        }

        for (var e : fulfilledBySoLine.entrySet()) {
            SoLine sl = byId.get(e.getKey());
            sl.setQtyPending(sl.getQtyPending().subtract(e.getValue()));
        }

        boolean anyPending = so.getLines().stream().anyMatch(sl -> sl.getQtyPending().signum() > 0);
        boolean allPending = so.getLines().stream().allMatch(sl -> sl.getQtyPending().compareTo(sl.getQty()) == 0);
        so.setStatus(!anyPending ? "DELIVERED" : allPending ? "PENDING" : "PARTIALLY_DELIVERED");
        return orders.save(so);
    }

    // ===================================================================
    // WORKFLOW 2 — DC_FIRST: issue a challan now (single warehouse)
    // ===================================================================
    @Transactional
    public DeliveryChallan issueChallan(SalesDtos.IssueChallanRequest req) {
        if (req.warehouseId() == null)
            throw new ApiException("A challan must ship from one warehouse");
        UUID shopId = resolveShop(req.shopId());
        UUID salespersonId = resolveSalesperson(req.salespersonId());
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
        DeliveryChallan dc = buildAndDeliver(null, shopId, req.customerId(), salespersonId,
            req.warehouseId(), req.allocations(), req.discountBy(), req.priceOverrideBy());

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
                    dc.getWarehouseId(),
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
        so.setSalespersonId(open.get(0).getSalespersonId());
        so.setWorkflow("DC_FIRST");
        so.setPaymentMode(req.paymentMode());
        so.setStatus("INVOICED");
        so.setOrderDate(today);
        so.setCreditOverrideBy(req.creditOverrideBy());
        BigDecimal transport = req.transportAndLifting() != null ? req.transportAndLifting() : BigDecimal.ZERO;
        so.setTransportAndLifting(transport);

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
                // stock is already consumed here, so only the band is judged (no warehouse -> no cost check)
                sl.setPriceOverrideBy(overrideFor(dl.getProductId(), null, unitPrice, req.priceOverrideBy()));
                sl.setLineNo(ln++);
                so.getLines().add(sl);
                totalValue = totalValue.add(lineNet(dl.getQty(), unitPrice, discountAmt));
                totalCost  = totalCost.add(dl.getQty().multiply(dl.getUnitCost()));
            }
        }

        totalValue = totalValue.add(transport);

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
    public java.util.List<SalesOrder> allOrders() { return orders.findAllByOrderByOrderDateDescSoNoDesc(); }

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
    public byte[] generateInvoicePdf(UUID soId, boolean bn) {
        SalesOrder so = orders.findById(soId)
            .orElseThrow(() -> new ApiException("Sales order not found"));

        var custOpt = customers.findById(so.getCustomerId());
        DeliveryInfo delivery = resolveDelivery(so, custOpt.orElse(null));

        Set<UUID> pids = so.getLines().stream().map(SoLine::getProductId).collect(Collectors.toSet());
        Map<UUID, String> productNames = new HashMap<>();
        Map<UUID, String> productUnits = new HashMap<>();
        products.findAllById(pids).forEach(p -> {
            productNames.put(p.getId(), pname(bn, p));
            productUnits.put(p.getId(), p.getUnit());
        });

        try {
            return renderSlips(bn, List.of(new SlipPage((doc, writer, kit) -> {

            doc.add(kit.title(kit.l("SALES INVOICE"), 13, Color.BLACK, Element.ALIGN_CENTER, 0, 6));

            // meta: invoice details, customer and salesperson in one compact grid
            // payment mode and "discount by" are not printed (the balance box already says cash or credit)
            String[][] invFacts = {{"Invoice No", so.getSoNo()}, {"Date", PdfKit.date(so.getOrderDate())}};
            doc.add(slipMeta(kit, bn, invFacts, custOpt.orElse(null), so.getSalespersonId(), so.getShopId(),
                null, delivery.mobile(), delivery.address()));

            // line items: # | Product | Qty | Unit Price | Total (discount, if any, is one row under the lines)
            Color teal = PdfKit.TINT;
            PdfPTable tbl = new PdfPTable(5);
            tbl.setWidthPercentage(100);
            // numeric columns sized for qty up to hundreds, unit price to thousands, total to lakhs; product takes the rest
            tbl.setWidths(new float[]{24f, 186f, 52f, 50f, 60f});   // qty carries its unit ("120 PCS")
            float[] colW = kit.cols(24f, 186f, 52f, 50f, 60f);
            tbl.setSpacingAfter(8);

            String[] heads = {"#", "Product", "Qty", "Unit Price", "Gross Total"};
            // money columns are right-aligned, heading included, so figures line up on the decimal point
            int[] aligns  = {Element.ALIGN_CENTER, Element.ALIGN_CENTER, Element.ALIGN_CENTER, Element.ALIGN_RIGHT, Element.ALIGN_RIGHT};
            for (int i = 0; i < heads.length; i++) {
                String headLabel = i == 4 && kit.bn() ? "মোট" : kit.l(heads[i]);   // invoice has no discount column: plain "মোট"
                float hPad = i == 0 ? 2f : i == 2 ? 1f : (i == 3 || i == 4) ? 3f : 5f;   // slim side padding keeps the narrow columns' headings (Bangla especially) tidy
                PdfPCell h = kit.cell(headLabel, true, 9, PdfKit.INK, aligns[i], colW[i], hPad);
                h.setBackgroundColor(teal);
                h.setHorizontalAlignment(aligns[i]);
                h.setVerticalAlignment(Element.ALIGN_MIDDLE);
                h.setPaddingTop(5); h.setPaddingBottom(5); h.setPaddingLeft(hPad); h.setPaddingRight(hPad);
                centerInk(h, headLabel);
                tbl.addCell(h);
            }

            // group lines by product
            record InvLine(String name, BigDecimal qty, BigDecimal grossTotal, BigDecimal disc) {}
            java.util.LinkedHashMap<UUID, InvLine> grouped = new java.util.LinkedHashMap<>();
            for (SoLine line : so.getLines()) {
                UUID pid = line.getProductId();
                BigDecimal qty        = line.getQty();
                BigDecimal lineGross  = qty.multiply(line.getUnitPrice()).setScale(2, RoundingMode.HALF_UP);
                BigDecimal lineDisc   = line.getDiscountAmt() != null ? line.getDiscountAmt() : BigDecimal.ZERO;
                String name           = productNames.getOrDefault(pid, "—");
                grouped.merge(pid, new InvLine(name, qty, lineGross, lineDisc),
                    (a, b) -> new InvLine(a.name(), a.qty().add(b.qty()), a.grossTotal().add(b.grossTotal()), a.disc().add(b.disc())));
            }

            BigDecimal grossSum = BigDecimal.ZERO, discSum = BigDecimal.ZERO;
            int serial = 0;
            for (var e : grouped.entrySet()) {
                InvLine line = e.getValue();
                BigDecimal unitPrice = line.qty().compareTo(BigDecimal.ZERO) == 0 ? BigDecimal.ZERO
                    : line.grossTotal().divide(line.qty(), 2, RoundingMode.HALF_UP);
                grossSum = grossSum.add(line.grossTotal());
                discSum  = discSum.add(line.disc());

                midCell(tbl, kit, String.valueOf(++serial), Element.ALIGN_CENTER, colW[0]);
                midCell(tbl, kit, line.name(), Element.ALIGN_LEFT, colW[1]);
                midCell(tbl, kit, kit.qty(line.qty(), productUnits.get(e.getKey())), Element.ALIGN_CENTER, colW[2]);
                midCell(tbl, kit, fmt(unitPrice), Element.ALIGN_RIGHT, colW[3]);
                midCell(tbl, kit, fmt(line.grossTotal()), Element.ALIGN_RIGHT, colW[4]);
            }

            float labelW = colW[0] + colW[1] + colW[2] + colW[3];
            BigDecimal grandTotal = grossSum.subtract(discSum);
            // keep the arithmetic visible: discount and transport are part of what was invoiced and posted
            if (discSum.signum() > 0)
                summaryRow(tbl, kit, kit.l("Discount"), "-" + fmt(discSum), false, labelW, colW[4]);
            BigDecimal transport = so.getTransportAndLifting() != null ? so.getTransportAndLifting() : BigDecimal.ZERO;
            if (transport.signum() > 0) {
                summaryRow(tbl, kit, kit.l("Transport & lifting"), fmt(transport), false, labelW, colW[4]);
                grandTotal = grandTotal.add(transport);
            }
            summaryRow(tbl, kit, kit.l("TOTAL"), fmt(grandTotal), true, labelW, colW[4]);
            doc.add(tbl);

            // separate account box: what the customer owed before, this sale, and what is due now
            BigDecimal[] bal = ledgers.customerBalanceAround(so.getCustomerId(), so.getId(), so.getOrderDate());
            boolean credit = "CREDIT".equals(so.getPaymentMode());
            float boxW = kit.pageWidth() * 0.6f;
            PdfPTable acct = new PdfPTable(2);
            acct.setTotalWidth(boxW);
            acct.setLockedWidth(true);
            acct.setWidths(new float[]{3f, 2f});
            // sits on the left, where the old previous-balance status box was
            acct.setHorizontalAlignment(Element.ALIGN_LEFT);
            acct.setSpacingBefore(6);
            acct.setSpacingAfter(8);
            acctRow(acct, kit, kit.l("Previous Balance"), fmt(bal[0]), false, boxW * 0.6f, boxW * 0.4f);
            acctRow(acct, kit, kit.l(credit ? "This Invoice (On Credit)" : "Paid In Cash"), fmt(grandTotal), false, boxW * 0.6f, boxW * 0.4f);
            acctRow(acct, kit, kit.l("Balance Due"), fmt(bal[1]), true, boxW * 0.6f, boxW * 0.4f);
            doc.add(acct);

            doc.add(kit.para(kit.l("Thank you for your business with us."), false, true, 9, Color.BLACK, Element.ALIGN_CENTER, 18, 0));
            }, "Customer Signature", salespersonName(bn, so.getSalespersonId()))));
        } catch (Exception e) {
            log.error("generateInvoicePdf failed for SO {}", soId, e);
            throw new ApiException("Failed to generate invoice: " + e.getMessage());
        }
    }

    // ===================================================================
    // order challan PDF (all challans for one SO combined)
    // ===================================================================

    @Transactional(readOnly = true)
    public byte[] generateOrderChallanPdf(UUID soId, boolean bn) {
        SalesOrder so = orders.findById(soId)
            .orElseThrow(() -> new ApiException("Sales order not found"));

        List<DeliveryChallan> dcList = challans.findBySoIdWithLines(soId);
        if (dcList.isEmpty()) throw new ApiException("No challans found for this order");

        var custOpt = customers.findById(so.getCustomerId());
        DeliveryInfo delivery = resolveDelivery(so, custOpt.orElse(null));

        // collect all product ids
        Set<UUID> pids = dcList.stream()
            .flatMap(dc -> dc.getLines().stream().map(DcLine::getProductId))
            .collect(Collectors.toSet());
        Map<UUID, String> productNames = new HashMap<>();
        Map<UUID, String> productUnits = new HashMap<>();
        products.findAllById(pids).forEach(p -> {
            productNames.put(p.getId(), pname(bn, p));
            productUnits.put(p.getId(), p.getUnit());
        });

        // group all lines across all challans by productId
        record ChallanLine(String name, BigDecimal qty) {}
        java.util.LinkedHashMap<UUID, ChallanLine> grouped = new java.util.LinkedHashMap<>();
        for (DeliveryChallan dc : dcList) {
            for (DcLine l : dc.getLines()) {
                String name = productNames.getOrDefault(l.getProductId(), "—");
                grouped.merge(l.getProductId(), new ChallanLine(name, l.getQty()),
                    (a, b) -> new ChallanLine(a.name(), a.qty().add(b.qty())));
            }
        }


        try {
            return renderSlips(bn, List.of(new SlipPage((doc, writer, kit) -> {

            doc.add(kit.title(kit.l("DELIVERY CHALLAN"), 13, Color.BLACK, Element.ALIGN_CENTER, 0, 6));

            // meta
            doc.add(slipMeta(kit, bn, new String[][]{
                    {"Order No", so.getSoNo()},   // challan numbers are not printed; the order identifies the slip
                    {"Date", PdfKit.date(so.getOrderDate())}},
                custOpt.orElse(null), so.getSalespersonId(), so.getShopId(), null, delivery.mobile(), delivery.address()));

            // lines table
            Color teal = PdfKit.TINT;
            PdfPTable tbl = new PdfPTable(3);
            tbl.setWidthPercentage(100);
            tbl.setWidths(new float[]{24f, 280f, 64f});
            float[] colW = kit.cols(24f, 280f, 64f);
            tbl.setSpacingAfter(8);

            String[] heads  = {"#", "Product", "Qty"};
            int[]    aligns = {Element.ALIGN_CENTER, Element.ALIGN_CENTER, Element.ALIGN_CENTER};
            for (int i = 0; i < heads.length; i++) {
                PdfPCell h = kit.cell(kit.l(heads[i]), true, 9, PdfKit.INK, aligns[i], colW[i], 5);
                h.setBackgroundColor(teal);
                h.setHorizontalAlignment(aligns[i]);
                h.setPadding(5);
                h.setVerticalAlignment(Element.ALIGN_MIDDLE);
                centerInk(h, kit.l(heads[i]));
                tbl.addCell(h);
            }

            int serial = 1;
            BigDecimal totalQty = BigDecimal.ZERO;
            for (var e : grouped.entrySet()) {
                ChallanLine line = e.getValue();
                pdfCell(tbl, kit, String.valueOf(serial++), Element.ALIGN_CENTER, colW[0]);
                pdfCell(tbl, kit, line.name(), Element.ALIGN_LEFT, colW[1]);
                pdfCell(tbl, kit, kit.qty(line.qty(), productUnits.get(e.getKey())), Element.ALIGN_CENTER, colW[2]);
                totalQty = totalQty.add(line.qty());
            }

            PdfPCell tlabel = kit.cell(kit.l("TOTAL"), true, 9, Color.BLACK, Element.ALIGN_RIGHT, colW[0] + colW[1], 5);
            tlabel.setColspan(2);
            tlabel.setHorizontalAlignment(Element.ALIGN_RIGHT);
            tlabel.setPadding(5);
            tbl.addCell(tlabel);
            PdfPCell tval = kit.cell(kit.qty(totalQty, PdfKit.sharedUnit(grouped.keySet(), productUnits)), true, 9, Color.BLACK, Element.ALIGN_CENTER, colW[2], 5);
            tval.setHorizontalAlignment(Element.ALIGN_CENTER);
            tval.setPadding(5);
            tbl.addCell(tval);
            doc.add(tbl);

            }, "Received by", salespersonName(bn, so.getSalespersonId()))));
        } catch (Exception e) {
            log.error("generateOrderChallanPdf failed for SO {}", soId, e);
            throw new ApiException("Failed to generate challan PDF: " + e.getMessage());
        }
    }

    // ===================================================================
    // challan PDF
    // ===================================================================

    @Transactional(readOnly = true)
    public byte[] generateChallanPdf(UUID dcId, boolean bn) {
        DeliveryChallan dc = challans.findByIdWithLines(dcId)
            .orElseThrow(() -> new ApiException("Challan not found"));

        SalesOrder dcSo = dc.getSoId() != null ? orders.findById(dc.getSoId()).orElse(null) : null;
        var custOpt = customers.findById(dc.getCustomerId());
        DeliveryInfo delivery = resolveDelivery(dcSo, custOpt.orElse(null));

        String warehouseName = dc.getWarehouseId() == null ? "—"
            : warehouses.findById(dc.getWarehouseId()).map(w -> nm(bn, w.getNameBn(), w.getName())).orElse("—");

        Set<UUID> pids = dc.getLines().stream().map(DcLine::getProductId).collect(Collectors.toSet());
        Map<UUID, String> productNames = new HashMap<>();
        Map<UUID, String> productUnits = new HashMap<>();
        products.findAllById(pids).forEach(p -> {
            productNames.put(p.getId(), pname(bn, p));
            productUnits.put(p.getId(), p.getUnit());
        });

        try {
            return renderSlips(bn, List.of(new SlipPage((doc, writer, kit) -> {

            doc.add(kit.title(kit.l("DELIVERY CHALLAN"), 13, Color.BLACK, Element.ALIGN_CENTER, 0, 6));

            // meta
            doc.add(slipMeta(kit, bn, new String[][]{
                    // identified by its order; only a direct challan with no order yet prints its own number
                    dcSo != null ? new String[]{"Order No", dcSo.getSoNo()} : new String[]{"Challan No", dc.getDcNo()},
                    {"Date", PdfKit.date(dc.getChallanDate())}},
                custOpt.orElse(null),
                dc.getSalespersonId() != null ? dc.getSalespersonId() : dcSo != null ? dcSo.getSalespersonId() : null,
                dc.getShopId(),
                new String[][]{{"Warehouse", warehouseName}},   // one pickup = one warehouse; the picker needs it
                delivery.mobile(), delivery.address()));

            // line items table — no prices (delivery document)
            Color teal = PdfKit.TINT;
            PdfPTable tbl = new PdfPTable(3);
            tbl.setWidthPercentage(100);
            tbl.setWidths(new float[]{24f, 280f, 64f});
            float[] colW = kit.cols(24f, 280f, 64f);
            tbl.setSpacingAfter(8);

            String[] heads  = {"#", "Product", "Qty"};
            int[]    aligns = {Element.ALIGN_CENTER, Element.ALIGN_CENTER, Element.ALIGN_CENTER};
            for (int i = 0; i < heads.length; i++) {
                PdfPCell h = kit.cell(kit.l(heads[i]), true, 9, PdfKit.INK, aligns[i], colW[i], 5);
                h.setBackgroundColor(teal);
                h.setHorizontalAlignment(aligns[i]);
                h.setPadding(5);
                h.setVerticalAlignment(Element.ALIGN_MIDDLE);
                centerInk(h, kit.l(heads[i]));
                tbl.addCell(h);
            }

            // group lines by product
            record ChallanLine(String name, BigDecimal qty) {}
            java.util.LinkedHashMap<UUID, ChallanLine> grouped = new java.util.LinkedHashMap<>();
            for (DcLine l : dc.getLines()) {
                String name = productNames.getOrDefault(l.getProductId(), "—");
                grouped.merge(l.getProductId(), new ChallanLine(name, l.getQty()),
                    (a, b) -> new ChallanLine(a.name(), a.qty().add(b.qty())));
            }

            int serial = 1;
            BigDecimal totalQty = BigDecimal.ZERO;
            for (var e : grouped.entrySet()) {
                ChallanLine line = e.getValue();
                pdfCell(tbl, kit, String.valueOf(serial++), Element.ALIGN_CENTER, colW[0]);
                pdfCell(tbl, kit, line.name(), Element.ALIGN_LEFT, colW[1]);
                pdfCell(tbl, kit, kit.qty(line.qty(), productUnits.get(e.getKey())), Element.ALIGN_CENTER, colW[2]);
                totalQty = totalQty.add(line.qty());
            }

            // total row
            PdfPCell tlabel = kit.cell(kit.l("TOTAL"), true, 9, Color.BLACK, Element.ALIGN_RIGHT, colW[0] + colW[1], 5);
            tlabel.setColspan(2);
            tlabel.setHorizontalAlignment(Element.ALIGN_RIGHT);
            tlabel.setPadding(5);
            tbl.addCell(tlabel);
            PdfPCell tval = kit.cell(kit.qty(totalQty, PdfKit.sharedUnit(grouped.keySet(), productUnits)), true, 9, Color.BLACK, Element.ALIGN_CENTER, colW[2], 5);
            tval.setHorizontalAlignment(Element.ALIGN_CENTER);
            tval.setPadding(5);
            tbl.addCell(tval);
            doc.add(tbl);

            }, "Received by", salespersonName(bn,
                dc.getSalespersonId() != null ? dc.getSalespersonId() : dcSo != null ? dcSo.getSalespersonId() : null))));
        } catch (Exception e) {
            log.error("generateChallanPdf failed for DC {}", dcId, e);
            throw new ApiException("Failed to generate challan PDF: " + e.getMessage());
        }
    }

    // ===================================================================
    // warehouse dispatch token PDF
    // ===================================================================

    @Transactional(readOnly = true)
    public byte[] generateWarehouseTokenPdf(UUID soId, boolean bn) {
        SalesOrder so = orders.findById(soId)
            .orElseThrow(() -> new ApiException("Sales order not found"));

        List<DeliveryChallan> dcList = challans.findBySoIdWithLines(soId);
        if (dcList.isEmpty()) throw new ApiException("No challans found for this order");
        return tokenPdf(so, dcList, bn);
    }

    /** Dispatch token for one pickup only — a customer who collects an order in parts gets a token per pickup. */
    @Transactional(readOnly = true)
    public byte[] generateChallanTokenPdf(UUID dcId, boolean bn) {
        DeliveryChallan dc = challans.findByIdWithLines(dcId)
            .orElseThrow(() -> new ApiException("Challan not found"));
        if (dc.getSoId() == null) throw new ApiException("This challan is not under a sales order yet");
        SalesOrder so = orders.findById(dc.getSoId())
            .orElseThrow(() -> new ApiException("Sales order not found"));
        return tokenPdf(so, List.of(dc), bn);
    }

    private byte[] tokenPdf(SalesOrder so, List<DeliveryChallan> dcList, boolean bn) {
        // collect all product names
        Set<UUID> pids = dcList.stream()
            .flatMap(dc -> dc.getLines().stream().map(DcLine::getProductId))
            .collect(Collectors.toSet());
        Map<UUID, String> productNames = new HashMap<>();
        Map<UUID, String> productUnits = new HashMap<>();
        products.findAllById(pids).forEach(p -> {
            productNames.put(p.getId(), pname(bn, p));
            productUnits.put(p.getId(), p.getUnit());
        });

        // collect warehouse names
        Set<UUID> wids = dcList.stream().map(DeliveryChallan::getWarehouseId)
            .filter(java.util.Objects::nonNull).collect(Collectors.toSet());
        Map<UUID, String> warehouseNames = new HashMap<>();
        warehouses.findAllById(wids).forEach(w -> warehouseNames.put(w.getId(), nm(bn, w.getNameBn(), w.getName())));

        var custOpt = customers.findById(so.getCustomerId());
        DeliveryInfo delivery = resolveDelivery(so, custOpt.orElse(null));

        try {
            // one page per warehouse pickup
            List<SlipPage> pages = new ArrayList<>();
            for (DeliveryChallan dc : dcList) {
                pages.add(new SlipPage((doc, writer, kit) -> {
                Color teal = PdfKit.TINT;
                String whName = dc.getWarehouseId() != null
                    ? warehouseNames.getOrDefault(dc.getWarehouseId(), "—") : "—";

                // header

                doc.add(kit.title(kit.l("TOKEN"), 13, Color.BLACK, Element.ALIGN_CENTER, 0, 6));

                // warehouse badge
                PdfPTable badge = new PdfPTable(1);
                badge.setWidthPercentage(100);
                badge.setSpacingAfter(6);
                PdfPCell bc = kit.cell(bn ? kit.l("WAREHOUSE") + ": " + whName : "  WAREHOUSE: " + whName.toUpperCase(), true, 10, PdfKit.INK,
                    Element.ALIGN_LEFT, kit.pageWidth(), 3);
                bc.setBackgroundColor(teal);
                bc.setPadding(3);
                bc.setVerticalAlignment(Element.ALIGN_MIDDLE);
                centerInk(bc, bn ? kit.l("WAREHOUSE") + ": " + whName : "WAREHOUSE");
                bc.setBorder(Rectangle.NO_BORDER);
                badge.addCell(bc);
                doc.add(badge);

                // dense grid (the warehouse is already in the badge above)
                doc.add(slipMeta(kit, bn, new String[][]{
                        {"Order No", so.getSoNo()},
                        {"Date", PdfKit.date(dc.getChallanDate())}},
                    custOpt.orElse(null), so.getSalespersonId(), so.getShopId(), null, delivery.mobile(), delivery.address()));

                // product table
                PdfPTable tbl = new PdfPTable(3);
                tbl.setWidthPercentage(100);
                tbl.setWidths(new float[]{24f, 280f, 64f});
            float[] colW = kit.cols(24f, 280f, 64f);
                tbl.setSpacingAfter(8);

                String[] heads  = {"#", "Product", "Qty"};
                int[]    aligns = {Element.ALIGN_CENTER, Element.ALIGN_CENTER, Element.ALIGN_CENTER};
                for (int i = 0; i < heads.length; i++) {
                    PdfPCell h = kit.cell(kit.l(heads[i]), true, 9, PdfKit.INK, aligns[i], colW[i], 5);
                    h.setBackgroundColor(teal);
                    h.setHorizontalAlignment(aligns[i]);
                    h.setPadding(5);
                    h.setVerticalAlignment(Element.ALIGN_MIDDLE);
                    centerInk(h, kit.l(heads[i]));
                    tbl.addCell(h);
                }

                // group lines by product within this DC
                record DispatchLine(String name, BigDecimal qty) {}
                java.util.LinkedHashMap<UUID, DispatchLine> grouped = new java.util.LinkedHashMap<>();
                for (DcLine l : dc.getLines()) {
                    String name = productNames.getOrDefault(l.getProductId(), "—");
                    grouped.merge(l.getProductId(), new DispatchLine(name, l.getQty()),
                        (a, b) -> new DispatchLine(a.name(), a.qty().add(b.qty())));
                }

                int serial = 1;
                BigDecimal totalQty = BigDecimal.ZERO;
                for (var e : grouped.entrySet()) {
                    DispatchLine line = e.getValue();
                    pdfCell(tbl, kit, String.valueOf(serial++), Element.ALIGN_CENTER, colW[0]);
                    pdfCell(tbl, kit, line.name(), Element.ALIGN_LEFT, colW[1]);
                    pdfCell(tbl, kit, kit.qty(line.qty(), productUnits.get(e.getKey())), Element.ALIGN_CENTER, colW[2]);
                    totalQty = totalQty.add(line.qty());
                }

                PdfPCell tlabel = kit.cell(kit.l("TOTAL ITEMS"), true, 9, Color.BLACK, Element.ALIGN_RIGHT, colW[0] + colW[1], 5);
                tlabel.setColspan(2);
                tlabel.setHorizontalAlignment(Element.ALIGN_RIGHT);
                tlabel.setPadding(5);
                tbl.addCell(tlabel);
                PdfPCell tval = kit.cell(kit.qty(totalQty, PdfKit.sharedUnit(grouped.keySet(), productUnits)), true, 9, Color.BLACK, Element.ALIGN_CENTER, colW[2], 5);
                tval.setHorizontalAlignment(Element.ALIGN_CENTER);
                tval.setPadding(5);
                tbl.addCell(tval);
                doc.add(tbl);

                String noteText = bn ? String.format(kit.l("dispatch note"), whName)
                    : "* This token authorises dispatch from " + whName + " only. Do not release without this token.";
                doc.add(kit.para(noteText, false, true, 8, Color.BLACK, Element.ALIGN_CENTER, 16, 0));
                }, "Dispatched by", salespersonName(bn, so.getSalespersonId())));
            }
            return renderSlips(bn, pages);
        } catch (Exception e) {
            throw new ApiException("Failed to generate warehouse token: " + e.getMessage());
        }
    }

    // ===================================================================
    // shared helpers
    // ===================================================================

    /** Build a single-warehouse challan, consuming FIFO layers for each line. */
    private DeliveryChallan buildAndDeliver(UUID soId, UUID shopId, UUID customerId, UUID salespersonId,
                                            UUID warehouseId, List<SalesDtos.Allocation> allocs,
                                            String discountBy, String priceOverrideBy) {
        DeliveryChallan dc = new DeliveryChallan();
        dc.setDcNo(docNo.next("DC"));
        dc.setSoId(soId);
        dc.setShopId(shopId);
        dc.setCustomerId(customerId);
        dc.setSalespersonId(salespersonId);
        dc.setWarehouseId(warehouseId);
        dc.setChallanDate(LocalDate.now());
        dc.setDiscountBy(discountBy);
        dc = challans.save(dc);   // id first, so stock movements can reference the challan

        for (var a : allocs) {
            BigDecimal totalDisc = a.discountAmt() != null ? a.discountAmt() : BigDecimal.ZERO;
            // judged before FIFO consumes the layer, same state validatePrice saw
            String lineOverride = overrideFor(a.productId(), warehouseId, a.unitPrice(), priceOverrideBy);
            var consumptions = inventory.consumeFifo(a.productId(), warehouseId, a.qty(), "SALE", dc.getId());
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
                dl.setPriceOverrideBy(lineOverride);
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

        if (warehouseId != null) {
            BigDecimal avail = inventory.available(productId, warehouseId);
            if (avail.signum() == 0)
                throw new ApiException("No stock of " + p.getName() + " in the selected warehouse");
        }

        String why = priceBreach(p, warehouseId, price);
        if (why != null && (overrideBy == null || overrideBy.isBlank()))
            throw new ApiException("Price " + price + " out of band (" + why +
                ") — manager override required");
    }

    /**
     * Why a gross unit price needs an override, or null when it is fine: outside the product's
     * band, or below the FIFO cost of the layer that would be sold next (only when a warehouse is known).
     */
    private String priceBreach(Product p, UUID warehouseId, BigDecimal price) {
        StringBuilder why = new StringBuilder();
        if (p.getPriceLower() != null && price.compareTo(p.getPriceLower()) < 0)
            why.append("below lower limit ").append(p.getPriceLower()).append("; ");
        if (p.getPriceUpper() != null && price.compareTo(p.getPriceUpper()) > 0)
            why.append("above upper limit ").append(p.getPriceUpper()).append("; ");
        if (warehouseId != null) {
            BigDecimal cost = inventory.nextFifoCost(p.getId(), warehouseId);
            if (cost != null && price.compareTo(cost) < 0)
                why.append("below FIFO cost ").append(cost.setScale(2, RoundingMode.HALF_UP)).append("; ");
        }
        return why.length() == 0 ? null : why.toString();
    }

    /** The override authoriser to store on a line: only when that line's price really needed one. */
    private String overrideFor(UUID productId, UUID warehouseId, BigDecimal price, String overrideBy) {
        if (overrideBy == null || overrideBy.isBlank()) return null;
        Product p = products.findById(productId).orElse(null);
        return p != null && priceBreach(p, warehouseId, price) != null ? overrideBy : null;
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

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    /** Delivery contact for a document: the order's override, else the customer's own. */
    private record DeliveryInfo(String mobile, String address) {}
    private DeliveryInfo resolveDelivery(SalesOrder so, Customer c) {
        String mobile  = (so != null && so.getDeliveryMobile()  != null) ? so.getDeliveryMobile()  : (c != null ? c.getMobile()  : null);
        String address = (so != null && so.getDeliveryAddress() != null) ? so.getDeliveryAddress() : (c != null ? c.getAddress() : null);
        return new DeliveryInfo(mobile, address);
    }

    /** Net line value = qty × unitPrice − flat discount amount. */
    /**
     * Net value of one line, worked from the figures as they are stored (qty, price and discount
     * columns hold 2 decimals) and rounded per line exactly like the invoice PDF. The screen can send
     * prices such as 2371.7647; posting the unrounded value left the ledger 1 paisa off the invoice.
     */
    private static BigDecimal lineNet(BigDecimal qty, BigDecimal unitPrice, BigDecimal discountAmt) {
        BigDecimal gross = money(qty).multiply(money(unitPrice)).setScale(2, RoundingMode.HALF_UP);
        return discountAmt == null ? gross : gross.subtract(money(discountAmt));
    }

    private static BigDecimal money(BigDecimal v) { return v.setScale(2, RoundingMode.HALF_UP); }

    /**
     * Bangla text cells are an image whose blank leading/descender space sits below the ink, so a
     * middle-aligned image looks high next to Latin text. Move the padding from bottom to top to compensate.
     */
    private static void centerInk(PdfPCell c, String text) {
        if (!com.mim.erp.common.BanglaPdf.hasBengali(text)) return;
        float d = Math.min(2.3f, c.getPaddingBottom());
        c.setPaddingTop(c.getPaddingTop() + d);
        c.setPaddingBottom(c.getPaddingBottom() - d);
    }

    /** Invoice body cell: vertically centred so top and bottom padding match. */
    private static void midCell(PdfPTable t, PdfKit kit, String text, int align, float colWidth) {
        PdfPCell c = kit.cell(text != null ? text : "", false, 9, Color.BLACK, align, colWidth, 4);
        c.setVerticalAlignment(Element.ALIGN_MIDDLE);
        centerInk(c, text);
        t.addCell(c);
    }

    private static void pdfCell(PdfPTable t, PdfKit kit, String text, int align, float colWidth) {
        t.addCell(kit.cell(text != null ? text : "", false, 9, Color.BLACK, align, colWidth, 4));
    }

    /** Label/value pairs in a borderless 2-column block; width is the width of the outer cell. */
    /** One label-across-four-columns + amount row at the foot of the invoice table. */
    private static void summaryRow(PdfPTable tbl, PdfKit kit, String label, String amount, boolean bold,
                                   float labelW, float amountW) {
        PdfPCell lc = kit.cell(label, bold, 9, Color.BLACK, Element.ALIGN_RIGHT, labelW, 5);
        lc.setColspan(4);
        lc.setHorizontalAlignment(Element.ALIGN_RIGHT);
        lc.setPadding(5);
        lc.setVerticalAlignment(Element.ALIGN_MIDDLE);
        centerInk(lc, label);
        tbl.addCell(lc);
        PdfPCell vc = kit.cell(amount, bold, 9, Color.BLACK, Element.ALIGN_RIGHT, amountW, 5);
        vc.setHorizontalAlignment(Element.ALIGN_RIGHT);
        vc.setPadding(5);
        vc.setPaddingRight(4);   // same right edge as the line amounts above it
        vc.setVerticalAlignment(Element.ALIGN_MIDDLE);
        tbl.addCell(vc);
    }

    /** Row of the separate account box; the bold last row (balance due) is highlighted. */
    private static void acctRow(PdfPTable t, PdfKit kit, String label, String amount, boolean strong,
                                float labelW, float amountW) {
        Color teal = PdfKit.TINT;
        Color fg = strong ? PdfKit.INK : Color.BLACK;
        PdfPCell lc = kit.cell(label, strong, 9, fg, Element.ALIGN_LEFT, labelW, 5);
        PdfPCell vc = kit.cell(amount, strong, 9, fg, Element.ALIGN_RIGHT, amountW, 5);
        lc.setHorizontalAlignment(Element.ALIGN_LEFT);
        vc.setHorizontalAlignment(Element.ALIGN_RIGHT);
        if (strong) { lc.setBackgroundColor(teal); vc.setBackgroundColor(teal); }
        lc.setVerticalAlignment(Element.ALIGN_MIDDLE);
        centerInk(lc, label);
        vc.setVerticalAlignment(Element.ALIGN_MIDDLE);
        t.addCell(lc);
        t.addCell(vc);
    }
    /**
     * Compact header grid shared by the invoice, challans and token. Document facts first (two per row), then
     * customer | salesperson name - mobile, their Bangla lines, customer contact, any extra facts, and the
     * delivery address across the full width. {@code docFacts}/{@code extra} are {label, value} pairs.
     */
    /**
     * Slip header, the same on invoice, challan and token:
     *   left column  — document no, date, customer (Bangla name under the English one)
     *   right column — salesperson ("name - mobile"), branch name, then any extra facts
     *   full width   — customer mobile, then address
     */
    private PdfPTable slipMeta(PdfKit kit, boolean bn, String[][] docFacts, Customer c, UUID salespersonId,
                               UUID shopId, String[][] rightExtra, String mobile, String address) {
        List<String[]> custNames = c == null ? Collections.singletonList(new String[]{"Customer", "—"})
            : nameRows("Customer", bn, c.getName(), c.getNameBn(), null);
        String spMobile = null;
        List<String[]> spNames = new ArrayList<>();
        for (String[] r : salespersonRows(bn, salespersonId)) {
            if ("Mobile".equals(r[0])) spMobile = r[1]; else spNames.add(r);
        }
        // salesperson name and mobile on one line ("Arif (017...)"), same in the English and Bangla slip
        String spLine = spNames.isEmpty() ? "—" : spNames.get(0)[1];
        if (!spNames.isEmpty() && spMobile != null && !"—".equals(spMobile)) spLine += " (" + spMobile + ")";
        // the Bangla name goes in the same cell as the English one ("\n"), so it stays right under it
        // even when the other side of the row wraps onto a second line
        String custBn = custNames.size() > 1 ? "\n" + custNames.get(1)[1] : "";
        String spBn = spNames.size() > 1 ? "\n" + spNames.get(1)[1] : "";
        List<String[]> left = new ArrayList<>(List.of(docFacts));
        String branch = shopId == null ? null
            : shops.findById(shopId).map(s -> nm(bn, s.getNameBn(), s.getName())).orElse(null);
        List<String[]> right = new ArrayList<>();
        right.add(new String[]{"Salesperson", spLine + spBn});
        right.add(new String[]{"Branch Name", branch != null && !branch.isBlank() ? branch : "—"});
        if (rightExtra != null) right.addAll(List.of(rightExtra));

        // left and right columns are stacked independently, so a two-line salesperson on the right
        // does not stretch the "Invoice No" row and open a gap above "Date"
        float[] w = kit.cols(52f, 95f, 61f, 160f);
        PdfPTable t = new PdfPTable(4);
        t.setWidthPercentage(100);
        try { t.setWidths(new float[]{52f, 95f, 61f, 160f}); } catch (Exception ignored) { }
        t.addCell(metaColumn(kit, left, w[0], w[1]));
        t.addCell(metaColumn(kit, right, w[2], w[3]));
        // everything about the customer sits together underneath, full width; labels centred on their value
        List<String[]> contact = List.of(
            new String[]{"Customer", custNames.get(0)[1] + custBn},
            new String[]{"Mobile", mobile != null && !mobile.isBlank() ? mobile : "—"},
            new String[]{"Address", address != null && !address.isBlank() ? address : "—"});
        for (String[] r : contact) {
            PdfPCell lc = compactCell(kit, kit.l(r[0]), true, w[0], 1);
            lc.setVerticalAlignment(Element.ALIGN_MIDDLE);
            t.addCell(lc);
            PdfPCell vc = compactCell(kit, r[1], boldValue(r[0]), w[1] + w[2] + w[3], 3);
            vc.setVerticalAlignment(Element.ALIGN_MIDDLE);
            t.addCell(vc);
        }
        t.setSpacingAfter(12);
        return t;
    }

    /** One side of the slip header: {label, value} rows packed tight, spanning two columns of the outer grid. */
    private static PdfPCell metaColumn(PdfKit kit, List<String[]> rows, float labelW, float valueW) {
        PdfPTable inner = new PdfPTable(2);
        inner.setWidthPercentage(100);
        try { inner.setWidths(new float[]{labelW, valueW}); } catch (Exception ignored) { }
        for (String[] r : rows) {
            inner.addCell(compactCell(kit, kit.l(r[0]), true, labelW, 1));
            inner.addCell(compactCell(kit, r[1], boldValue(r[0]), valueW, 1));
        }
        PdfPCell c = new PdfPCell(inner);
        c.setBorder(Rectangle.NO_BORDER);
        c.setPadding(0);
        c.setColspan(2);
        c.setVerticalAlignment(Element.ALIGN_TOP);
        return c;
    }

    /** Who the slip is for and who sold it stand out: their values print bold. */
    private static boolean boldValue(String label) {
        return "Customer".equals(label) || "Salesperson".equals(label);
    }

    private static final float META_PT = 8.5f;   // header grid text: four columns must fit the 5.5 in slip

    private static PdfPCell compactCell(PdfKit kit, String text, boolean bold, float width, int colspan) {
        if (text != null && text.contains("\n")) {
            // one inner row per line: each line picks its own font (Latin or Bangla) and they sit tight together
            PdfPTable lines = new PdfPTable(1);
            for (String line : text.split("\n")) {
                PdfPCell lc = kit.cell(line, bold, META_PT, Color.BLACK, Element.ALIGN_LEFT, width, 1.5f);
                lc.setBorder(Rectangle.NO_BORDER);
                lines.addCell(lc);
            }
            PdfPCell wrap = new PdfPCell(lines);
            wrap.setBorder(Rectangle.NO_BORDER);
            wrap.setColspan(colspan);
            return wrap;
        }
        PdfPCell c = kit.cell(text == null ? "" : text, bold, META_PT, Color.BLACK, Element.ALIGN_LEFT, width, 1.5f);
        c.setBorder(Rectangle.NO_BORDER);
        c.setColspan(colspan);
        c.setVerticalAlignment(Element.ALIGN_TOP);
        return c;
    }


    private static PdfPCell metaBlock(PdfKit kit, float width, String[][] rows) {
        float colW = (width - 4f) / 2f;
        PdfPTable inner = new PdfPTable(2);
        inner.setWidthPercentage(100);
        for (String[] row : rows) {
            PdfPCell k = kit.cell(kit.l(row[0]), true, 9, Color.BLACK, Element.ALIGN_LEFT, colW, 2);
            k.setBorder(Rectangle.NO_BORDER); k.setPaddingBottom(3); inner.addCell(k);
            PdfPCell v = kit.cell(row[1] != null ? row[1] : "", false, 9, Color.BLACK, Element.ALIGN_LEFT, colW, 2);
            v.setBorder(Rectangle.NO_BORDER); v.setPaddingBottom(3); inner.addCell(v);
        }
        PdfPCell wrap = new PdfPCell();
        wrap.setBorder(Rectangle.NO_BORDER);
        wrap.addElement(inner);
        return wrap;
    }

    /** Bangla name when printing Bangla and one exists, else the English name. */
    /**
     * Label/value rows for a bilingual name: the Bangla slip shows the Bangla name; the English slip shows
     * the English name with the Bangla name on the line just below it. `suffix` (e.g. a mobile number)
     * goes after the first line.
     */
    private static List<String[]> nameRows(String label, boolean bn, String name, String nameBn, String suffix) {
        boolean hasBn = nameBn != null && !nameBn.isBlank();
        String first = (bn && hasBn ? nameBn.trim() : (name != null ? name : "—")) + (suffix != null ? suffix : "");
        List<String[]> rows = new ArrayList<>();
        rows.add(new String[]{label, first});
        if (!bn && hasBn && !nameBn.trim().equals(name)) rows.add(new String[]{"", nameBn.trim()});
        return rows;
    }

    private static List<String[]> customerRows(boolean bn, Customer c, DeliveryInfo d) {
        if (c == null) return Collections.singletonList(new String[]{"Customer", "—"});
        List<String[]> rows = new ArrayList<>(nameRows("Customer", bn, c.getName(), c.getNameBn(), null));
        // own row: a long name plus number wraps in a half-width column
        if (d != null && d.mobile() != null) rows.add(new String[]{"Contact", d.mobile()});
        return rows;
    }

    /** The salesperson on a slip; empty when the document has none. */
    private List<String[]> salespersonRows(boolean bn, UUID userId) {
        if (userId == null) return List.of();
        return users.findById(userId).map(u -> {
            List<String[]> rows = new ArrayList<>(nameRows("Salesperson", bn,
                u.getFullName() != null && !u.getFullName().isBlank() ? u.getFullName() : u.getUsername(),
                u.getFullNameBn(), null));
            // mobile so anyone can reach the salesperson in an emergency; "—" shows a number is still missing
            rows.add(new String[]{"Mobile", u.getMobile() != null && !u.getMobile().isBlank() ? u.getMobile().trim() : "—"});
            return rows;
        }).orElse(List.of());
    }

    /** Salesperson's printed name for a slip: Bangla when printing Bangla and one exists; "" when none. */
    private String salespersonName(boolean bn, UUID userId) {
        if (userId == null) return "";
        return users.findById(userId)
            .map(u -> nm(bn, u.getFullNameBn(),
                u.getFullName() != null && !u.getFullName().isBlank() ? u.getFullName() : u.getUsername()))
            .orElse("");
    }

    /** Writes the body of one slip page (everything above the signature block). */
    @FunctionalInterface
    private interface SlipBody { void write(Document doc, PdfWriter writer, PdfKit kit) throws Exception; }

    /** One printed slip page: its body and the captions of its signature block. */
    private record SlipPage(SlipBody body, String leftCaption, String sellerName) {}

    private static final float TALL = 14400f;        // largest page PDF allows; the body is measured on it
    private static final float SIGN_ROOM = 24f;      // clear space above the signature lines to sign in

    /**
     * Renders slips onto pre-printed stationery: every page is exactly {@link PdfKit#slip()} and nothing
     * ever prints outside its margins. The signature block is pinned to the bottom margin; the body goes
     * above it at full size when it fits, otherwise it is laid out wider and scaled down as a whole (fonts,
     * padding, lines together) until it fits the space between the top margin and the signature block,
     * still filling the full width. A body never runs onto a second page.
     */
    private static byte[] renderSlips(boolean bn, List<SlipPage> pages) throws Exception {
        Document doc = PdfKit.slip();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        PdfWriter writer = PdfWriter.getInstance(doc, out);
        doc.open();
        PdfKit.printActualSize(writer);
        PdfKit kit = new PdfKit(bn, doc, writer);
        PdfContentByte cb = writer.getDirectContent();

        float left = doc.leftMargin(), top = doc.topMargin();
        float contentW = doc.right() - doc.left();
        boolean first = true;
        for (SlipPage p : pages) {
            if (!first) doc.newPage();
            first = false;
            float avail = doc.top() - signFoot(doc, writer, kit, p.leftCaption(), p.sellerName()) - SIGN_ROOM;

            // lay the body out at a width that, once scaled, is exactly the printable width
            // (a wider layout wraps less, so the scale is found by a few rounds; the largest scale that fits wins)
            float s = 1f, best = 0f, h = 0f;
            byte[] body = null, bestBody = null;
            for (int i = 0; i < 8; i++) {
                float[] used = new float[1];
                body = measureBody(bn, p.body(), contentW / s, left, top, used);
                h = used[0];
                if (s * h <= avail + 0.01f && s > best) { best = s; bestBody = body; }
                float next = Math.min(1f, avail / h);
                if (Math.abs(next - s) < 0.003f) break;
                s = next;
            }
            if (bestBody != null) { s = best; body = bestBody; }
            else s = avail / h;   // no round fitted outright: shrink the last layout the rest of the way

            PdfImportedPage ip = writer.getImportedPage(new PdfReader(body), 1);
            // template point (left, TALL - top) lands on the slip's top-left margin corner
            cb.addTemplate(ip, s, 0, 0, s, left * (1 - s), doc.top() - s * (TALL - top));
            writer.setPageEmpty(false);
        }
        doc.close();
        return out.toByteArray();
    }

    /** Lays one slip body out on a very tall page of the given content width; reports the height it took. */
    private static byte[] measureBody(boolean bn, SlipBody body, float contentW, float left, float top,
                                      float[] usedHeight) throws Exception {
        Document doc = new Document(new Rectangle(contentW + 2 * left, TALL), left, left, top, 0);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        PdfWriter writer = PdfWriter.getInstance(doc, out);
        doc.open();
        body.write(doc, writer, new PdfKit(bn, doc, writer));
        usedHeight[0] = Math.max(1f, doc.top() - writer.getVerticalPosition(false));        doc.close();
        return out.toByteArray();
    }

    /**
     * Signature block pinned to the foot of the current page: a line to sign on at each side, the seller's
     * printed name under the right-hand line, then the captions. Returns the y of its top edge.
     */
    private static float signFoot(Document doc, PdfWriter writer, PdfKit kit, String leftCaption,
                                  String sellerName) throws Exception {
        float blockW = 130f;
        PdfPTable t = new PdfPTable(3);
        t.setTotalWidth(new float[]{blockW, kit.pageWidth() - 2 * blockW, blockW});
        t.setLockedWidth(true);
        String[][] rows = {
            {"", sellerName == null ? "" : sellerName},
            {kit.l(leftCaption), kit.l("Seller's Signature")}};
        for (int r = 0; r < rows.length; r++) {
            for (int col = 0; col < 3; col++) {
                String text = col == 1 ? "" : rows[r][col == 0 ? 0 : 1];
                // " " keeps the name row's height when there is no name to print
                PdfPCell c = kit.cell(text.isEmpty() ? " " : text, r == 1, 9, Color.BLACK, Element.ALIGN_CENTER, blockW, 2);
                c.setHorizontalAlignment(Element.ALIGN_CENTER);
                c.setBorder(r == 0 && col != 1 ? Rectangle.TOP : Rectangle.NO_BORDER);   // top border = the line
                if (r == rows.length - 1) c.setPaddingBottom(0);   // captions rest on the padded bottom edge
                t.addCell(c);
            }
        }
        float y = doc.bottom() + t.getTotalHeight();
        t.writeSelectedRows(0, -1, doc.left(), y, writer.getDirectContent());
        return y;
    }

    private static String[][] rowsArray(List<String[]> rows) { return rows.toArray(new String[0][]); }

    private static String nm(boolean bn, String nameBn, String name) {
        return bn && nameBn != null && !nameBn.isBlank() ? nameBn : name;
    }

    private static String pname(boolean bn, Product p) {
        return nm(bn, p.getNameBn(), p.getFullName() != null ? p.getFullName() : p.getName());
    }

    private static String fmt(BigDecimal v) {
        return v.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
}