package com.mim.erp.master;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface SupplierRepository extends JpaRepository<Supplier, UUID> {
}
