package com.mim.erp.accounting;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AccountRepository extends JpaRepository<Account, UUID> {
    Optional<Account> findByCode(String code);
    Optional<Account> findByPartyTypeAndPartyId(String partyType, UUID partyId);
    List<Account> findAllByOrderByCode();
}
