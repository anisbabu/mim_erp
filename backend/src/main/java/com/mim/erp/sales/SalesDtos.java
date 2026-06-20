package com.mim.erp.sales;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

public class SalesDtos {

    /** One allocation: take `qty` of a product FROM a specific warehouse. discountAmt is a flat line discount (null = 0). */
    public record Allocation(UUID productId, UUID warehouseId, BigDecimal qty, BigDecimal unitPrice, BigDecimal discountAmt) {}

    /** SO_FIRST: create order, then system splits into per-warehouse challans. */
    public record CreateOrderRequest(
        UUID shopId, UUID customerId, String paymentMode,   // CASH | CREDIT
        List<Allocation> allocations,
        String creditOverrideBy,                            // set when over limit, authorised
        String priceOverrideBy,                             // set when out-of-band price, authorised
        String discountBy                                   // set when any line has a discount, authorised
    ) {}

    /** DC_FIRST: issue one challan now (single warehouse). */
    public record IssueChallanRequest(
        UUID shopId, UUID customerId, UUID warehouseId,
        List<Allocation> allocations,
        String priceOverrideBy,
        String discountBy
    ) {}

    /** DC_FIRST consolidation at day end: roll a customer's challans into one SO. */
    public record ConsolidateRequest(UUID customerId, String paymentMode, String creditOverrideBy) {}

    public record OrderResult(UUID soId, String soNo, List<UUID> challanIds, BigDecimal totalValue, BigDecimal totalCost) {}
}
