package com.mim.erp.purchase;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** Request/response payloads for the purchase module. */
public class PurchaseDtos {

    public record CreatePoLine(UUID productId, BigDecimal qty, BigDecimal unitPrice, boolean freeProduct) {}
    /** Optional manual poNo — when blank/omitted the server auto-generates one. */
    public record CreatePoRequest(UUID supplierId, String note, String manualPoNo, List<CreatePoLine> lines) {}

    /** One line on the receive screen: receive qty editable, defaults to balance.
     *  receivedProductId is optional — defaults to the ordered product, but can be a
     *  different SKU (same product different colour, or a different product) at the PO price. */
    public record ReceiveLine(UUID poLineId, BigDecimal qtyReceived, UUID receivedProductId,
                              BigDecimal billPrice) {}   // supplier's billed unit price; blank = PO price
    /**
     * billNo/billDate/dueDate: the supplier's invoice (may be keyed later). dueDate blank = bill date (else
     * receipt date) + supplier credit days. freight: carriage on this delivery, added to the stock cost;
     * freightOnBill = the supplier charged it on the bill, else it was paid to a carrier in cash.
     * priceApprovedBy: required when a billed price differs from the PO price.
     */
    public record ReceiveRequest(UUID warehouseId, List<ReceiveLine> lines,
                                 String billNo, java.time.LocalDate billDate, java.time.LocalDate dueDate,
                                 BigDecimal freight, Boolean freightOnBill, String priceApprovedBy,
                                 BigDecimal vat) {}   // input VAT on the supplier VAT invoice (Mushak 6.3), inside the billed prices
    /** Supplier invoice details keyed after the goods were received. */
    public record BillDetails(String billNo, java.time.LocalDate billDate, java.time.LocalDate dueDate) {}

    /** View model for the side-by-side receive screen. */
    public record PoLineView(UUID poLineId, UUID productId, String productName,
                             BigDecimal qtyOrdered, BigDecimal qtyBalance, BigDecimal unitPrice,
                             boolean freeProduct) {}

    /** One historical receipt line against a PO. */
    public record ReceiptView(String grnNo, java.time.LocalDate receiptDate,
                              String productName, java.util.UUID warehouseId, BigDecimal qtyReceived) {}
    public record PoView(UUID poId, String poNo, UUID supplierId, String supplierName,
                         String status, List<PoLineView> lines) {}

    /** Full details for the PO details view (header + line items + totals). */
    public record PoDetails(UUID poId, String poNo, UUID supplierId, String supplierName,
                            java.time.LocalDate orderDate, String status, String note,
                            List<PoLineView> lines, BigDecimal totalQty, BigDecimal totalValue) {}
}
