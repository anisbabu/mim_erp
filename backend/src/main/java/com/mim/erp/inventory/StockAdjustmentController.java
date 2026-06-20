package com.mim.erp.inventory;

import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.UUID;

@RestController
@RequestMapping("/api/inventory/adjustments")
public class StockAdjustmentController {

    private final StockAdjustmentService service;

    public StockAdjustmentController(StockAdjustmentService service) { this.service = service; }

    public record AdjustRequest(String type, UUID productId, UUID fromWarehouseId,
                                UUID toWarehouseId, BigDecimal qty, String reason) {}

    @PostMapping
    public StockAdjustment adjust(@RequestBody AdjustRequest req) {
        return service.adjust(req.type(), req.productId(), req.fromWarehouseId(),
            req.toWarehouseId(), req.qty(), req.reason());
    }
}
