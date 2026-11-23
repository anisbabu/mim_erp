package com.mim.erp.sales;

import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Customer invoices (receivables) - under Accounting; follows the /api/accounting/** roles. */
@RestController
@RequestMapping("/api/accounting/customer-invoices")
public class CustomerInvoiceController {

    private final SoStatusService soStatus;

    public CustomerInvoiceController(SoStatusService soStatus) { this.soStatus = soStatus; }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) UUID customerId) { return soStatus.invoices(customerId); }
}
