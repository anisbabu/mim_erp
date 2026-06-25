package com.mim.erp.purchase;

import com.mim.erp.accounting.AccountingService;
import com.mim.erp.accounting.AccountingService.Leg;
import com.mim.erp.accounting.LedgerService;
import com.mim.erp.common.ApiException;
import com.mim.erp.common.DocNumberService;
import com.mim.erp.inventory.InventoryService;
import com.mim.erp.master.ProductRepository;
import com.mim.erp.master.SupplierRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
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

    public PurchaseService(PurchaseOrderRepository pos, PoLineRepository poLines,
                           GoodsReceiptRepository grns, ProductRepository products,
                           SupplierRepository suppliers,
                           InventoryService inventory, AccountingService accounting,
                           LedgerService ledgers, DocNumberService docNo) {
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
     * Receive goods against a PO into ONE warehouse.
     * Rules enforced:
     *  - received qty per line must be > 0 and <= the line's open balance
     *  - received price is locked to PO price (never passed in by caller)
     *  - each received line reduces the PO-line balance and creates a FIFO layer
     *  - PO auto-closes when every line balance reaches zero
     *  - posts the accounting entry: Dr Inventory / Cr Accounts Payable
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

        BigDecimal totalValue = BigDecimal.ZERO;

        for (var rl : req.lines()) {
            if (rl.qtyReceived() == null || rl.qtyReceived().signum() <= 0) continue; // skip blanks
            PoLine poLine = poLines.findById(rl.poLineId())
                .orElseThrow(() -> new ApiException("PO line not found"));

            // received qty can be <= balance, never more
            if (rl.qtyReceived().compareTo(poLine.getQtyBalance()) > 0)
                throw new ApiException("Receive qty (" + rl.qtyReceived() +
                    ") exceeds open balance (" + poLine.getQtyBalance() + ")");

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
            grn.getLines().add(gl);

            totalValue = totalValue.add(rl.qtyReceived().multiply(poLine.getUnitPrice()));
        }

        if (grn.getLines().isEmpty())
            throw new ApiException("Nothing to receive — enter a quantity on at least one line");

        GoodsReceipt saved = grns.save(grn);

        // create FIFO cost layers for what actually arrived (price locked to PO price)
        for (GrnLine gl : saved.getLines()) {
            PoLine poLine = poLines.findById(gl.getPoLineId()).orElseThrow();
            inventory.addLayer(gl.getReceivedProductId(), req.warehouseId(), gl.getId(),
                gl.getQtyReceived(), poLine.getUnitPrice(), saved.getReceiptDate());
        }

        // auto-close PO if fully received
        boolean allZero = po.getLines().stream()
            .allMatch(l -> l.getQtyBalance().signum() == 0);
        if (allZero) po.setStatus("CLOSED");

        // accounting: Dr Inventory / Cr Accounts Payable (supplier's subsidiary ledger).
        // Free-only receipts carry zero value, so no journal entry is posted.
        if (totalValue.signum() > 0) {
            String apLedger = ledgers.supplierLedger(po.getSupplierId()).getCode();
            accounting.post(saved.getReceiptDate(),
                "Goods receipt " + saved.getGrnNo(),
                "GRN", saved.getId(),
                List.of(
                    Leg.debit("1200", totalValue),        // Inventory
                    Leg.credit(apLedger, totalValue)      // Accounts Payable — this supplier
                ));
        }

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
