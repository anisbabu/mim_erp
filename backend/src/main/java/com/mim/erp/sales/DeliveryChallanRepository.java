package com.mim.erp.sales;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface DeliveryChallanRepository extends JpaRepository<DeliveryChallan, UUID> {
    List<DeliveryChallan> findByCustomerIdAndChallanDateAndStatus(
        UUID customerId, LocalDate challanDate, String status);

    List<DeliveryChallan> findByStatus(String status);
    List<DeliveryChallan> findByCustomerIdAndStatus(UUID customerId, String status);
    List<DeliveryChallan> findAllByOrderByChallanDateDescDcNoDesc();
    @Query("SELECT DISTINCT dc FROM DeliveryChallan dc LEFT JOIN FETCH dc.lines WHERE dc.soId = :soId")
    List<DeliveryChallan> findBySoIdWithLines(@Param("soId") UUID soId);

    @Query("SELECT dc FROM DeliveryChallan dc LEFT JOIN FETCH dc.lines WHERE dc.id = :id")
    java.util.Optional<DeliveryChallan> findByIdWithLines(@Param("id") UUID id);
}
