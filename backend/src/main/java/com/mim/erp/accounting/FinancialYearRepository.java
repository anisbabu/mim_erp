package com.mim.erp.accounting;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FinancialYearRepository extends JpaRepository<FinancialYear, UUID> {
    Optional<FinancialYear> findByIsCurrentTrue();
    List<FinancialYear> findAllByOrderByStartDateDesc();
    Optional<FinancialYear> findByStartDate(java.time.LocalDate startDate);
    boolean existsByStartDateBeforeAndStatus(java.time.LocalDate date, String status);
    boolean existsByStartDateAfterAndStatus(java.time.LocalDate date, String status);
}
