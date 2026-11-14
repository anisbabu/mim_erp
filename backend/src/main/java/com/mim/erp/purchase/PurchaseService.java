package com.mim.erp.purchase;

import com.mim.erp.accounting.AccountingService;
import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.accounting.BillService;
import com.mim.erp.accounting.LedgerService;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import com.mim.erp.inventory.InventoryService;
import com.mim.erp.master.ProductRepository;
import com.mim.erp.master.SupplierRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Service
public class PurchaseService {

    private final PurchaseOrderRepository pos;
    private final PoLineRepository poLines;
    private final GoodsReceiptRepository grns;
    private final ProductRepository products;
    private final SupplierRepository suppliers;
    private final InventoryService inventory;
    private final AccountingService accounting;
    private final LedgerService ledgers;
    private final DocNumberService docNo;
    private final BillService bills;

    public PurchaseService(PurchaseOrderRepository pos, PoLineRepository poLines,
                           GoodsReceiptRepository grns, ProductRepository products,
                           SupplierRepository suppliers,
                           InventoryService inventory, AccountingService accounting,
                           LedgerService ledgers, DocNumberService docNo, BillService bills) {
        this.bills = bills;
        this.pos = pos; this.poLines = poLines; this.grns = grns;
        this.products = products; this.suppliers = suppliers;
        this.inventory = inventory;
        this.accounting = accounting; this.ledgers = ledgers; this.docNo = docNo;
    }

    @Transactional
    public PurchaseOrder createPo(PurchaseDtos.CreatePoRequest req) {
        if (req.lines() == null || req.lines().isEmpty())
            throw new ApiException("A purchase order needs at least one line");

        PurchaseOrder po = new PurchaseOrder();
        // honour a manually-entered PO number; otherwise auto-generate one.
        String manual = req.manualPoNo() == null ? "" : req.manualPoNo().trim();
        if (manual.isEmpty()) {
            po.setPoNo(docNo.next("PO"));
        } else {
            if (pos.existsByPoNo(manual))
                throw new ApiException("PO number '" + manual + "' is already in use");
            po.setPoNo(manual);
        }
        po.setSupplierId(req.supplierId());
        po.setOrderDate(LocalDate.now());
        po.setNote(req.note());

        int n = 1;
        for (var l : req.lines()) {
            PoLine line = new PoLine();
            line.setPo(po);
            line.setProductId(l.productId());
            line.setQtyOrdered(l.qty());
            line.setQtyBalance(l.qty());     // balance starts full
            line.setFreeProduct(l.freeProduct());
            // a free line carries no price; quantity still counts toward stock
            line.setUnitPrice(l.freeProduct() ? java.math.BigDecimal.ZERO
                : (l.unitPrice() == null ? java.math.BigDecimal.ZERO : l.unitPrice()));
            line.setLineNo(n++);
            po.getLines().add(line);
        }
        return pos.save(po);
    }

    /**
     * Receive goods against a PO into ONE warehouse, together with the supplier's bill.
     * Rules enforced:
     *  - received qty per line must be > 0 and <= the line's open balance
     *  - billed price defaults to the PO price; a different price needs an approver (logged on the GRN)
     *  - freight is added to the stock cost (landed cost), shared across lines by value
     *  - each received line reduces the PO-line balance and creates a FIFO layer at landed cost
     *  - PO auto-closes when every line balance reaches zero
     *  - posts Dr Inventory / Cr Supplier (and Cr Cash for freight paid to a carrier)
     *  - the supplier bill is due on dueDate, else bill date (or receipt date) + supplier credit days
     */
    @Transactional
    public GoodsReceipt receive(UUID poId, PurchaseDtos.ReceiveRequest req) {
        PurchaseOrder po = pos.findById(poId)
            .orElseThrow(() -> new ApiException("Purchase order not found"));
        if (!"OPEN".equals(po.getStatus()))
            throw new ApiException("Purchase order is not open");
        if (req.warehouseId() == null)
            throw new ApiException("Select a warehouse to receive into");

        GoodsReceipt grn = new GoodsReceipt();
        grn.setGrnNo(docNo.next("GRN"));
        grn.setPoId(poId);
        grn.setWarehouseId(req.warehouseId());
        grn.setReceiptDate(LocalDate.now());
        applyBill(grn, po.getSupplierId(), req.billNo(), req.billDate(), req.dueDate());

        BigDecimal freight = req.freight() == null ? BigDecimal.ZERO : req.freight().setScale(2, RoundingMode.HALF_UP);
        if (freight.signum() < 0) throw new ApiException("Freight can't be negative");
        grn.setFreight(freight);
        grn.setFreightOnBill(req.freightOnBill() == null || req.freightOnBill());

        BigDecimal totalValue = BigDecimal.ZERO;
        boolean priceChanged = false;

        for (var rl : req.lines()) {
            if (rl.qtyReceived() == null || rl.qtyReceived().signum() <= 0) continue; // skip blanks
            PoLine poLine = poLines.findById(rl.poLineId())
                .orElseThrow(() -> new ApiException("PO line not found"));

            // received qty can be <= balance, never more
            if (rl.qtyReceived().compareTo(poLine.getQtyBalance()) > 0)
                throw new ApiException("Receive qty (" + rl.qtyReceived() +
                    ") exceeds open balance (" + poLine.getQtyBalance() + ")");

            // the supplier's billed price; a free line stays free
            BigDecimal price = poLine.isFreeProduct() || rl.billPrice() == null ? poLine.getUnitPrice() : rl.billPrice();
            if (price.signum() < 0) throw new ApiException("Billed price can't be negative");
            if (price.compareTo(poLine.getUnitPrice()) != 0) priceChanged = true;

            // reduce balance
            poLine.setQtyBalance(poLine.getQtyBalance().subtract(rl.qtyReceived()));

            // what actually arrived — defaults to the ordered product, may be a
            // different SKU (colour/substitute) received at the PO line's price
            UUID receivedProductId = rl.receivedProductId() != null
                ? rl.receivedProductId() : poLine.getProductId();

            // grn line
            GrnLine gl = new GrnLine();
            gl.setGrn(grn);
            gl.setPoLineId(poLine.getId());
            gl.setReceivedProductId(receivedProductId);
            gl.setQtyReceived(rl.qtyReceived());
            gl.setUnitPrice(price);
            grn.getLines().add(gl);

            totalValue = totalValue.add(rl.qtyReceived().multiply(price).setScale(2, RoundingMode.HALF_UP));
        }

        if (grn.getLines().isEmpty())
            throw new ApiException("Nothing to receive — enter a quantity on at least one line");
        if (priceChanged) {
            if (req.priceApprovedBy() == null || req.priceApprovedBy().isBlank())
                throw new ApiException("The billed price differs from the PO price - name who approved it");
            grn.setPriceApprovedBy(req.priceApprovedBy().trim());
        }
        grn.setGoodsValue(totalValue);
        BigDecimal inputVat = req.vat() == null ? BigDecimal.ZERO : req.vat().setScale(2, RoundingMode.HALF_UP);
        if (inputVat.signum() < 0 || inputVat.compareTo(totalValue) > 0)
            throw new ApiException("Input VAT must be between 0 and the goods value");
        grn.setVat(inputVat);
        // the VAT inside the billed prices is claimed back, so it is not part of the stock cost
        BigDecimal exVat = totalValue.signum() == 0 ? BigDecimal.ONE
            : totalValue.subtract(inputVat).divide(totalValue, 10, RoundingMode.HALF_UP);

        // landed cost: freight shared by line value (by quantity when everything is free)
        BigDecimal weightTotal = totalValue.signum() > 0 ? totalValue
            : grn.getLines().stream().map(GrnLine::getQtyReceived).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal freightLeft = freight;
        for (int i = 0; i < grn.getLines().size(); i++) {
            GrnLine gl = grn.getLines().get(i);
            BigDecimal value = gl.getQtyReceived().multiply(gl.getUnitPrice()).setScale(2, RoundingMode.HALF_UP);
            BigDecimal weight = totalValue.signum() > 0 ? value : gl.getQtyReceived();
            BigDecimal share = i == grn.getLines().size() - 1 ? freightLeft
                : freight.multiply(weight).divide(weightTotal, 2, RoundingMode.HALF_UP).min(freightLeft);
            freightLeft = freightLeft.subtract(share);
            gl.setUnitCost(value.multiply(exVat).add(share).divide(gl.getQtyReceived(), 4, RoundingMode.HALF_UP));
        }

        GoodsReceipt saved = grns.save(grn);

        // create FIFO cost layers for what actually arrived, at landed cost
        for (GrnLine gl : saved.getLines()) {
            inventory.addLayer(gl.getReceivedProductId(), req.warehouseId(), gl.getId(),
                gl.getQtyReceived(), gl.getUnitCost(), saved.getReceiptDate(),
                saved.getReceiptDate(), "GRN", saved.getId());
        }

        // auto-close PO if fully received
        boolean allZero = po.getLines().stream()
            .allMatch(l -> l.getQtyBalance().signum() == 0);
        if (allZero) po.setStatus("CLOSED");

        // accounting: Dr Inventory (goods ex VAT + freight), Dr Input VAT / Cr the supplier for the bill,
        // Cr Cash for carrier freight.
        // Free-only receipts with no freight carry zero value, so no journal entry is posted.
        BigDecimal payable = totalValue.add(saved.isFreightOnBill() ? freight : BigDecimal.ZERO);
        BigDecimal stock = totalValue.subtract(inputVat).add(freight);
        if (stock.add(inputVat).signum() > 0) {
            List<Leg> legs = new java.util.ArrayList<>();
            if (stock.signum() > 0) legs.add(Leg.debit("1200", stock));          // Inventory
            if (inputVat.signum() > 0) legs.add(Leg.debit(com.mim.erp.accounting.VatService.INPUT_VAT, inputVat));
            if (payable.signum() > 0)
                legs.add(Leg.credit(ledgers.supplierLedger(po.getSupplierId()).getCode(), payable));
            if (!saved.isFreightOnBill() && freight.signum() > 0)
                legs.add(Leg.credit("1000", freight));                             // carrier paid in cash
            accounting.post(saved.getReceiptDate(), "Goods receipt " + saved.getGrnNo()
                + (saved.getBillNo() == null ? "" : " - bill " + saved.getBillNo()), "GRN", saved.getId(), legs);
        }

        return saved;
    }

    /** Set the supplier invoice details on a GRN; due date defaults to bill date (or receipt date) + credit days. */
    private void applyBill(GoodsReceipt grn, UUID supplierId, String billNo, LocalDate billDate, LocalDate dueDate) {
        if (billDate != null && billDate.isAfter(LocalDate.now())) throw new ApiException("The bill date can't be in the future");
        int days = suppliers.findById(supplierId).map(s -> s.getCreditDays()).orElse(0);
        LocalDate base = billDate != null ? billDate : grn.getReceiptDate();
        LocalDate due = dueDate != null ? dueDate : base.plusDays(days);
        if (due.isBefore(base)) throw new ApiException("The due date can't be before the bill date");
        grn.setBillNo(billNo == null || billNo.isBlank() ? null : billNo.trim());
        grn.setBillDate(billDate);
        grn.setDueDate(due);
    }

    /**
     * Key or correct the supplier's invoice no., date and due date after receipt. Amounts are posted and
     * can't change here; the open bill in the supplier's account takes the new reference and due date.
     */
    @Transactional
    public GoodsReceipt updateBill(UUID grnId, PurchaseDtos.BillDetails b) {
        GoodsReceipt grn = grns.findById(grnId).orElseThrow(() -> new ApiException("Goods receipt not found"));
        PurchaseOrder po = pos.findById(grn.getPoId()).orElseThrow();
        if (b.billNo() == null || b.billNo().isBlank()) throw new ApiException("Enter the supplier's bill number");
        applyBill(grn, po.getSupplierId(), b.billNo(), b.billDate(), b.dueDate());
        GoodsReceipt saved = grns.saveAndFlush(grn);
        bills.retagGrn(saved.getId());
        return saved;
    }

    /** Build the side-by-side view for the receive screen. */
    @Transactional(readOnly = true)
    public java.util.List<PurchaseDtos.ReceiptView> receiptHistory(UUID poId) {
        var result = new java.util.ArrayList<PurchaseDtos.ReceiptView>();
        for (GoodsReceipt grn : grns.findByPoIdOrderByReceiptDateAsc(poId)) {
            for (GrnLine gl : grn.getLines()) {
                String name = products.findById(gl.getReceivedProductId())
                    .map(p -> p.getFullName() != null ? p.getFullName() : p.getName()).orElse("—");
                result.add(new PurchaseDtos.ReceiptView(
                    grn.getGrnNo(), grn.getReceiptDate(), name, grn.getWarehouseId(), gl.getQtyReceived()));
            }
        }
        return result;
    }

    @Transactional(readOnly = true)
    public PurchaseDtos.PoView view(UUID poId) {
        PurchaseOrder po = pos.findById(poId)
            .orElseThrow(() -> new ApiException("Purchase order not found"));
        var lines = po.getLines().stream().map(l -> {
            String name = products.findById(l.getProductId())
                .map(p -> p.getFullName() != null ? p.getFullName() : p.getName()).orElse("?");
            return new PurchaseDtos.PoLineView(l.getId(), l.getProductId(), name,
                l.getQtyOrdered(), l.getQtyBalance(), l.getUnitPrice(), l.isFreeProduct());
        }).toList();
        return new PurchaseDtos.PoView(po.getId(), po.getPoNo(), po.getSupplierId(),
            null, po.getStatus(), lines);
    }

    public List<PurchaseOrder> openOrders() { return pos.findByStatusOrderByPoNoDesc("OPEN"); }
    /** Newest POs first for the list view. */
    public List<PurchaseOrder> allOrders()  { return pos.findAllByOrderByStatusDescPoNoDesc(); }

    /** Full details for the PO details page — header, supplier name, lines and totals. */
    @Transactional(readOnly = true)
    public PurchaseDtos.PoDetails viewDetails(UUID poId) {
        PurchaseOrder po = pos.findById(poId)
            .orElseThrow(() -> new ApiException("Purchase order not found"));
        String supplierName = po.getSupplierId() == null ? "—"
            : suppliers.findById(po.getSupplierId()).map(s -> s.getName()).orElse("—");
        // mutable accumulators (BigDecimal is immutable; the array trick keeps them in scope for the lambda)
        java.math.BigDecimal[] totalQty = { java.math.BigDecimal.ZERO };
        java.math.BigDecimal[] totalValue = { java.math.BigDecimal.ZERO };
        var lines = po.getLines().stream().map(l -> {
            String name = products.findById(l.getProductId())
                .map(p -> p.getFullName() != null ? p.getFullName() : p.getName()).orElse("?");
            totalQty[0] = totalQty[0].add(l.getQtyOrdered());
            // free lines carry zero price; including them leaves totalValue unchanged
            if (l.getUnitPrice() != null) {
                totalValue[0] = totalValue[0].add(l.getQtyOrdered().multiply(l.getUnitPrice()));
            }
            return new PurchaseDtos.PoLineView(l.getId(), l.getProductId(), name,
                l.getQtyOrdered(), l.getQtyBalance(), l.getUnitPrice(), l.isFreeProduct());
        }).toList();
        return new PurchaseDtos.PoDetails(po.getId(), po.getPoNo(), po.getSupplierId(),
            supplierName, po.getOrderDate(), po.getStatus(), po.getNote(),
            lines, totalQty[0], totalValue[0]);
    }
}
