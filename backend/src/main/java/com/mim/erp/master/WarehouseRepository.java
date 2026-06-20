package com.mim.erp.master;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface WarehouseRepository extends JpaRepository<Warehouse, UUID> {
}
