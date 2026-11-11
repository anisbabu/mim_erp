package com.mim.erp.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mim.erp.auth.AppUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

/**
 * The only writer of audit entries besides the database trigger: sign-in events, which change no
 * table. There is deliberately no update or delete here, and the table itself rejects both.
 */
@Service
public class AuditService implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AuditService(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

    /** After Flyway has run: put the audit trigger on any table a new migration added. */
    @Override
    public void run(ApplicationArguments args) {
        Integer added = jdbc.queryForObject("select audit_attach_all()", Integer.class);
        if (added != null && added > 0) log.info("Audit trigger attached to {} new table(s)", added);
    }

    public void login(AppUser u) {
        authEvent("login", u.getId(), u.getUsername(), u.getFullName(), u.getRole(), null);
    }

    public void logout(UUID userId, String username, String name, String role) {
        authEvent("logout", userId, username, name, role, null);
    }

    /** {@code known} is the account the attempt was aimed at, or null when the username does not exist. */
    public void loginFailed(AppUser known, String attemptedUsername, String reason) {
        String username = attemptedUsername == null || attemptedUsername.isBlank() ? "(blank)" : attemptedUsername.trim();
        authEvent("login_failed",
            known == null ? null : known.getId(), username,
            known == null ? username : known.getFullName(),
            known == null ? "UNKNOWN" : known.getRole(),
            Map.of("reason", reason));
    }

    /**
     * A failed audit write must not lock everybody out of signing in, so it is reported loudly in the
     * server log instead of failing the request. (Data changes are different: there the trigger's
     * failure rolls the change back.)
     */
    private void authEvent(String action, UUID userId, String username, String name, String role, Map<String, Object> details) {
        AuditActor a = AuditActor.current();
        try {
            jdbc.update("insert into audit_log (user_id, username, user_name, user_role, action, module, "
                    + "table_name, record_id, new_values, ip_address, user_agent) "
                    + "values (?, ?, ?, ?, ?, 'auth', 'app_user', ?, ?::jsonb, nullif(?, ''), nullif(?, ''))",
                userId, AuditActor.cut(username, 120),
                AuditActor.cut(name == null || name.isBlank() ? username : name, 160),
                AuditActor.cut(role, 30), action,
                userId == null ? null : userId.toString(),
                details == null ? null : json.writeValueAsString(details),
                a.ip(), a.userAgent());
        } catch (RuntimeException | JsonProcessingException e) {
            log.error("AUDIT WRITE FAILED for {} by '{}' from {} — the event is not in the activity log", action, username, a.ip(), e);
        }
    }
}
