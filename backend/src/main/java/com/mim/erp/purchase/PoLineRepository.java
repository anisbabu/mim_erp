package com.mim.erp.purchase;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import java.util.Optional;
import java.util.UUID;

public interface PoLineRepository extends JpaRepository<PoLine, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<PoLine> findById(UUID id);
}
