package com.mim.erp.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mim.erp.common.ApiException;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Activity Log — read only, ADMIN only (see SecurityConfig). There is no write endpoint for audit
 * entries on purpose; the table also rejects UPDATE / DELETE / TRUNCATE at the database level.
 */
@RestController
@RequestMapping("/api/audit-log")
public class AuditController {

    private static final int MAX_PAGE = 200;
    private static final int MAX_EXPORT = 100_000;
    private static final String TZ = "Asia/Dhaka";

    private static final String COLS =
        "id, to_char(created_at at time zone '" + TZ + "', 'YYYY-MM-DD HH24:MI:SS') as \"at\", "
      + "user_id as \"userId\", username as \"login\", user_name as \"userName\", user_role as \"userRole\", action, module, "
      + "table_name as \"tableName\", record_id as \"recordId\", ip_address as \"ipAddress\", user_agent as \"userAgent\"";

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AuditController(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

    /** One page, newest first. {@code user} is a user id, or "system" for jobs and unknown sign-ins. */
    @GetMapping
    public Map<String, Object> list(@RequestParam(defaultValue = "0") int page,
                                    @RequestParam(defaultValue = "50") int size,
                                    @RequestParam(required = false) String user,
                                    @RequestParam(required = false) String module,
                                    @RequestParam(required = false) String action,
                                    @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                    @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                    @RequestParam(required = false) String recordId,
                                    @RequestParam(required = false) String q) {
        if (page < 0) page = 0;
        size = Math.max(1, Math.min(size, MAX_PAGE));
        List<Object> args = new ArrayList<>();
        String where = where(user, module, action, from, to, recordId, q, args);

        Long total = jdbc.queryForObject("select count(*) from audit_log" + where, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        // "fields" = the changed columns of an update; old/new values come along too, so the list itself
        // shows what was changed (update: changed fields only, create/delete: the row) without opening each entry
        List<Map<String, Object>> items = jdbc.queryForList(
            "select " + COLS + ", case when old_values is not null and new_values is not null then "
          + "(select string_agg(k, ', ' order by k) from jsonb_object_keys(new_values) k) end as fields, "
          + "old_values::text as old_json, new_values::text as new_json "
          + "from audit_log" + where + " order by created_at desc, id desc limit ? offset ?", pageArgs.toArray());
        for (Map<String, Object> row : items) {
            row.put("oldValues", parse((String) row.remove("old_json")));
            row.put("newValues", parse((String) row.remove("new_json")));
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("items", items);
        out.put("total", total == null ? 0 : total);
        out.put("page", page);
        out.put("size", size);
        return out;
    }

    /** Values for the filter dropdowns: only what actually occurs in the log. */
    @GetMapping("/facets")
    public Map<String, Object> facets() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("modules", jdbc.queryForList("select distinct module from audit_log order by 1", String.class));
        out.put("actions", jdbc.queryForList("select distinct action from audit_log order by 1", String.class));
        out.put("users", jdbc.queryForList(
            "select distinct on (user_id) user_id as id, user_name as name, username from audit_log "
          + "where user_id is not null order by user_id, created_at desc"));
        return out;
    }

    /** One entry with its old and new values. */
    @GetMapping("/{id}")
    public Map<String, Object> one(@PathVariable long id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "select " + COLS + ", old_values::text as old_json, new_values::text as new_json from audit_log where id = ?", id);
        if (rows.isEmpty()) throw new ApiException("Activity log entry not found");
        Map<String, Object> row = new LinkedHashMap<>(rows.get(0));
        row.put("oldValues", parse((String) row.remove("old_json")));
        row.put("newValues", parse((String) row.remove("new_json")));
        return row;
    }

    /** Same filters as the list, as a CSV download (newest first, capped at 100,000 rows). */
    @GetMapping("/export")
    public void export(@RequestParam(required = false) String user,
                       @RequestParam(required = false) String module,
                       @RequestParam(required = false) String action,
                       @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                       @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                       @RequestParam(required = false) String recordId,
                       @RequestParam(required = false) String q,
                       HttpServletResponse res) throws IOException {
        List<Object> args = new ArrayList<>();
        String where = where(user, module, action, from, to, recordId, q, args);
        args.add(MAX_EXPORT);
        String sql = "select " + COLS + ", old_values::text as old_json, new_values::text as new_json "
                   + "from audit_log" + where + " order by created_at desc, id desc limit ?";

        // written straight to the response (no async streaming: the security context does not follow an async dispatch)
        res.setContentType("text/csv; charset=UTF-8");
        res.setHeader(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"activity-log-" + LocalDate.now() + ".csv\"");
        Writer w = new OutputStreamWriter(res.getOutputStream(), StandardCharsets.UTF_8);
        w.write(0xFEFF);      // byte-order mark, so Excel reads Bangla names as UTF-8
        w.write("ID,Time (" + TZ + "),User,Username,Role,Action,Module,Table,Record ID,IP address,User agent,Old values,New values\r\n");
        jdbc.query(sql, (RowCallbackHandler) rs -> {
            try {
                w.write(csv(rs.getString("id"), rs.getString("at"), rs.getString("userName"), rs.getString("login"),
                    rs.getString("userRole"), rs.getString("action"), rs.getString("module"), rs.getString("tableName"),
                    rs.getString("recordId"), rs.getString("ipAddress"), rs.getString("userAgent"),
                    rs.getString("old_json"), rs.getString("new_json")));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }, args.toArray());
        w.flush();
    }

    // ---- helpers ----

    private static String where(String user, String module, String action, LocalDate from, LocalDate to,
                                String recordId, String q, List<Object> args) {
        List<String> c = new ArrayList<>();
        if (has(user)) {
            if (AuditActor.SYSTEM.equalsIgnoreCase(user.trim())) c.add("user_id is null");
            else {
                try { args.add(java.util.UUID.fromString(user.trim())); }
                catch (IllegalArgumentException e) { throw new ApiException("Unknown user filter"); }
                c.add("user_id = ?");
            }
        }
        if (has(module))   { c.add("module = ?"); args.add(module.trim()); }
        if (has(action))   { c.add("action = ?"); args.add(action.trim()); }
        if (from != null)  { c.add("created_at >= (?::date)::timestamp at time zone '" + TZ + "'"); args.add(from.toString()); }
        if (to != null)    { c.add("created_at < ((?::date) + 1)::timestamp at time zone '" + TZ + "'"); args.add(to.toString()); }
        if (has(recordId)) { c.add("record_id = ?"); args.add(recordId.trim()); }
        if (has(q)) {
            String like = "%" + q.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
            c.add("(user_name ilike ? or username ilike ? or table_name ilike ? or record_id ilike ? "
                + "or ip_address ilike ? or old_values::text ilike ? or new_values::text ilike ?)");
            for (int i = 0; i < 7; i++) args.add(like);
        }
        return c.isEmpty() ? "" : " where " + String.join(" and ", c);
    }

    private static boolean has(String s) { return s != null && !s.isBlank(); }

    private Object parse(String jsonText) {
        if (jsonText == null) return null;
        try { return json.readTree(jsonText); }
        catch (JsonProcessingException e) { return jsonText; }
    }

    /** One CSV line. Cells that a spreadsheet would run as a formula are neutralised with a leading quote. */
    private static String csv(String... cells) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) sb.append(',');
            String v = cells[i] == null ? "" : cells[i];
            if (!v.isEmpty() && "=+-@\t\r".indexOf(v.charAt(0)) >= 0) v = "'" + v;
            sb.append('"').append(v.replace("\"", "\"\"")).append('"');
        }
        return sb.append("\r\n").toString();
    }
}
