package com.mim.erp.accounting;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface AccountGroupRepository extends JpaRepository<AccountGroup, UUID> {
    Optional<AccountGroup> findByCode(String code);
}
