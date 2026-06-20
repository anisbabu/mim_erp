package com.mim.erp.purchase;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface GoodsReceiptRepository extends JpaRepository<GoodsReceipt, UUID> {
    List<GoodsReceipt> findByPoIdOrderByReceiptDateAsc(UUID poId);
}
