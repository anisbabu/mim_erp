package com.mim.erp.accounting;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface FinancialYearRepository extends JpaRepository<FinancialYear, UUID> {
    Optional<FinancialYear> findByIsCurrentTrue();
    List<FinancialYear> findAllByOrderByStartDateDesc();
}
