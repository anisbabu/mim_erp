package com.mim.erp.sales;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.math.BigDecimal;
import java.util.UUID;

public interface SalesOrderRepository extends JpaRepository<SalesOrder, UUID> {

    /** Outstanding (unpaid credit) exposure for a customer — used by the credit check. */
    @Query("""
        select coalesce(sum(l.qty * l.unitPrice - l.discountAmt),0)
        from SalesOrder o join o.lines l
        where o.customerId = :customerId and o.paymentMode = 'CREDIT'
          and o.status <> 'CANCELLED'
    """)
    BigDecimal outstandingCredit(@Param("customerId") UUID customerId);
}
