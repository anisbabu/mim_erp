package com.mim.erp.accounting;

import com.mim.erp.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * VAT settings and arithmetic. Selling prices include VAT: the VAT inside a price is
 * price x rate / (100 + rate). A product's tax_rate overrides the default rate. While VAT is
 * switched off every rate is 0, so sales post exactly as before.
 */
@Service
public class VatService {

    public static final String OUTPUT_VAT = "2100", INPUT_VAT = "1450", AIT_PAYABLE = "2120",
        AIT_CREDIT = "1460", VDS_PAYABLE = "2110", VDS_CREDIT = "1470";

    public record Settings(boolean enabled, BigDecimal defaultRate) {}

    private final JdbcTemplate jdbc;

    public VatService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    private String setting(String key, String fallback) {
        List<String> v = jdbc.queryForList("select value from app_setting where key = ?", String.class, key);
        return v.isEmpty() ? fallback : v.get(0);
    }

    public Settings settings() {
        return new Settings(Boolean.parseBoolean(setting("vat_enabled", "false")),
            new BigDecimal(setting("vat_default_rate", "0")));
    }

    @Transactional
    public Settings save(boolean enabled, BigDecimal defaultRate) {
        if (defaultRate == null || defaultRate.signum() < 0 || defaultRate.compareTo(new BigDecimal("100")) > 0)
            throw new ApiException("The default VAT rate must be between 0 and 100");
        for (Map.Entry<String, String> e : Map.of("vat_enabled", String.valueOf(enabled),
                "vat_default_rate", defaultRate.stripTrailingZeros().toPlainString()).entrySet())
            jdbc.update("insert into app_setting (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
                e.getKey(), e.getValue());
        return settings();
    }

    /** VAT rate charged on a product right now: 0 when VAT is off, else its own rate or the default. */
    public BigDecimal rateFor(UUID productId) {
        Settings s = settings();
        if (!s.enabled()) return BigDecimal.ZERO;
        List<BigDecimal> r = jdbc.queryForList("select tax_rate from product where id = ?", BigDecimal.class, productId);
        return r.isEmpty() || r.get(0) == null ? s.defaultRate() : r.get(0);
    }

    /** The VAT inside a VAT-inclusive amount. */
    public static BigDecimal inside(BigDecimal gross, BigDecimal rate) {
        if (gross == null || rate == null || rate.signum() == 0) return BigDecimal.ZERO;
        return gross.multiply(rate).divide(new BigDecimal("100").add(rate), 2, RoundingMode.HALF_UP);
    }
}
