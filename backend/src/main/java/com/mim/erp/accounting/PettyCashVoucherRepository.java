package com.mim.erp.accounting;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface PettyCashVoucherRepository extends JpaRepository<PettyCashVoucher, UUID> {
}
