package com.mim.erp.common;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Tiny key/value store (table app_setting) for switches the backend itself needs to read. */
@Component
public class AppSettings {
    private final JdbcTemplate jdbc;

    public AppSettings(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public String get(String key, String fallback) {
        var rows = jdbc.queryForList("SELECT value FROM app_setting WHERE key = ?", String.class, key);
        return rows.isEmpty() ? fallback : rows.get(0);
    }

    public void put(String key, String value) {
        jdbc.update("INSERT INTO app_setting (key, value) VALUES (?, ?) "
            + "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", key, value);
    }
}
