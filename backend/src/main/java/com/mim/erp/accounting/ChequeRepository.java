package com.mim.erp.accounting;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ChequeRepository extends JpaRepository<Cheque, UUID> {
    List<Cheque> findAllByOrderByMaturityDateAsc();
    List<Cheque> findByStatusOrderByMaturityDateAsc(String status);
}
