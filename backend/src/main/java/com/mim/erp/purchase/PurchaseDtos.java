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
    public record ReceiveLine(UUID poLineId, BigDecimal qtyReceived, UUID receivedProductId) {}
    public record ReceiveRequest(UUID warehouseId, List<ReceiveLine> lines) {}

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
