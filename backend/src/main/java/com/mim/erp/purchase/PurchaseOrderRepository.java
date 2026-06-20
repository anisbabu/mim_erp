package com.mim.erp.purchase;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface PurchaseOrderRepository extends JpaRepository<PurchaseOrder, UUID> {
    List<PurchaseOrder> findByStatusOrderByPoNoDesc(String status);
    /** OPEN first (status DESC: O > C), then newest first within each group. */
    List<PurchaseOrder> findAllByOrderByStatusDescPoNoDesc();
    /** Used to enforce uniqueness on a manually-entered PO number. */
    boolean existsByPoNo(String poNo);
}
