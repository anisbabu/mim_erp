package com.mim.erp.accounting;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ChequeEventRepository extends JpaRepository<ChequeEvent, UUID> {
    List<ChequeEvent> findByChequeIdOrderByCreatedAtDesc(UUID chequeId);
}
