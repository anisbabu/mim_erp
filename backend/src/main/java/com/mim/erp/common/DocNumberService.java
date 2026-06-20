package com.mim.erp.common;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Year;

/**
 * Generates human-readable document numbers like PO-2026-000123.
 * Backed by a Postgres sequence per prefix, created lazily.
 */
@Service
public class DocNumberService {

    private final JdbcTemplate jdbc;

    public DocNumberService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public synchronized String next(String prefix) {
        String seq = "seq_" + prefix.toLowerCase();
        jdbc.execute("CREATE SEQUENCE IF NOT EXISTS " + seq);
        Long n = jdbc.queryForObject("SELECT nextval('" + seq + "')", Long.class);
        return "%s-%d-%06d".formatted(prefix, Year.now().getValue(), n);
    }
}
