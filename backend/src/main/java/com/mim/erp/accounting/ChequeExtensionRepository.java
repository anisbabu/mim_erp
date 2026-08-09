package com.mim.erp.accounting;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ChequeExtensionRepository extends JpaRepository<ChequeExtension, UUID> {
    List<ChequeExtension> findByChequeIdOrderByExtendedAtDesc(UUID chequeId);
}
