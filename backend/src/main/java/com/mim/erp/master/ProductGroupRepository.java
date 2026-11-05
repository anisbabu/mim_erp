package com.mim.erp.master;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProductGroupRepository extends JpaRepository<ProductGroup, UUID> {
    List<ProductGroup> findAllByOrderByNameAsc();
    Optional<ProductGroup> findByNameIgnoreCase(String name);
}
