package com.mim.erp.audit;

import org.springframework.jdbc.datasource.DelegatingDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

/**
 * Stamps every connection handed out by the pool with the current actor, as session settings the
 * audit trigger reads (see V70__audit_log.sql). JPA and JdbcTemplate both take their connections
 * here, so no service or controller has to pass the user along.
 *
 * The settings are overwritten on every checkout — including with blanks when nobody is signed in —
 * so a pooled connection can never carry the previous request's user.
 */
public class AuditDataSource extends DelegatingDataSource {

    private static final String STAMP =
        "select set_config('mim.audit_user_id', ?, false), set_config('mim.audit_username', ?, false), "
      + "set_config('mim.audit_user_name', ?, false), set_config('mim.audit_user_role', ?, false), "
      + "set_config('mim.audit_module', ?, false), set_config('mim.audit_ip', ?, false), "
      + "set_config('mim.audit_user_agent', ?, false)";

    public AuditDataSource(DataSource target) { super(target); }

    @Override
    public Connection getConnection() throws SQLException {
        return stamp(super.getConnection());
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        return stamp(super.getConnection(username, password));
    }

    private Connection stamp(Connection c) throws SQLException {
        AuditActor a = AuditActor.current();
        try (PreparedStatement ps = c.prepareStatement(STAMP)) {
            ps.setString(1, a.userId());
            ps.setString(2, a.username());
            ps.setString(3, a.name());
            ps.setString(4, a.role());
            ps.setString(5, a.module());
            ps.setString(6, a.ip());
            ps.setString(7, a.userAgent());
            ps.execute();
        } catch (SQLException | RuntimeException e) {
            // never hand out a connection whose actor is unknown: the write would be logged against the wrong user
            try { c.close(); } catch (SQLException ignore) { e.addSuppressed(ignore); }
            throw e;
        }
        return c;
    }
}
