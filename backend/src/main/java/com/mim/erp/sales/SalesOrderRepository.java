package com.mim.erp.sales;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface SalesOrderRepository extends JpaRepository<SalesOrder, UUID> {

    /** Newest first — for the orders list. */
    List<SalesOrder> findAllByOrderByOrderDateDescSoNoDesc();
}
