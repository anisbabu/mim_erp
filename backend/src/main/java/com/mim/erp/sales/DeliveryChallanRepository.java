package com.mim.erp.sales;

import org.springframework.data.jpa.repository.JpaRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface DeliveryChallanRepository extends JpaRepository<DeliveryChallan, UUID> {
    List<DeliveryChallan> findByCustomerIdAndChallanDateAndStatus(
        UUID customerId, LocalDate challanDate, String status);

    List<DeliveryChallan> findByStatus(String status);
    List<DeliveryChallan> findByCustomerIdAndStatus(UUID customerId, String status);
    List<DeliveryChallan> findAllByOrderByChallanDateDescDcNoDesc();
}
