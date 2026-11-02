package com.mim.erp.master;

import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * In-memory cache for the master-data lists (products, customers, suppliers, shops, warehouses).
 * MasterController evicts everything on any create/update/delete; the 5 minute expiry is a safety
 * net for rows changed outside the API (SQL, migrations).
 */
@Configuration
@EnableCaching
public class MasterCache {
    public static final String NAME = "master";

    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager m = new CaffeineCacheManager(NAME);
        m.setCaffeine(Caffeine.newBuilder().expireAfterWrite(Duration.ofMinutes(5)).maximumSize(50));
        return m;
    }
}
