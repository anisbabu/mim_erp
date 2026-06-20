package com.mim.erp.accounting;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OpeningBalanceRepository extends JpaRepository<OpeningBalance, UUID> {
    List<OpeningBalance> findByFinancialYearId(UUID financialYearId);
    Optional<OpeningBalance> findByFinancialYearIdAndAccountId(UUID financialYearId, UUID accountId);
}
