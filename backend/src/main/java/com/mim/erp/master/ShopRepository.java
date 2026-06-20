package com.mim.erp.master;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface ShopRepository extends JpaRepository<Shop, UUID> {
}
