package com.mim.erp.audit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mim.erp.master.Warehouse;
import com.mim.erp.master.WarehouseRepository;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.dao.DataAccessException;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * End-to-end proof of the audit log: real HTTP calls through the real security chain into a real
 * PostgreSQL 16 (Flyway builds the schema from V1). Every assertion reads the audit_log table.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AuditLogTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");

    private static final String IP = "203.0.113.7";
    private static final String UA = "audit-test-agent";

    @Autowired TestRestTemplate rest;
    @Autowired JdbcTemplate jdbc;
    @Autowired WarehouseRepository warehouses;
    @Autowired ObjectMapper json;

    private String adminToken;

    @BeforeAll
    void signInAsAdmin() {
        adminToken = login("admin", "admin123");
    }

    // ---------------------------------------------------------------- coverage of the schema

    @Test
    void everyTableCarriesTheAuditTrigger() {
        List<String> uncovered = jdbc.queryForList(
            "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace "
          + "where n.nspname = 'public' and c.relkind = 'r' "
          + "and c.relname not in ('audit_log', 'flyway_schema_history', 'doc_counter') "
          + "and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'zz_audit_row') "
          + "order by 1", String.class);
        assertThat(uncovered).as("tables without the audit trigger").isEmpty();
    }

    @Test
    void tableAddedLaterIsAuditedWithoutExtraCode() {
        jdbc.execute("create table zz_new_module (id uuid primary key default gen_random_uuid(), label text)");
        try {
            assertThat(jdbc.queryForObject("select audit_attach_all()", Integer.class)).isEqualTo(1);   // what startup runs
            jdbc.update("insert into zz_new_module (label) values ('hello')");
            assertThat(count("table_name = 'zz_new_module' and action = 'create'")).isEqualTo(1);
        } finally {
            jdbc.execute("drop table zz_new_module");
        }
    }

    // ---------------------------------------------------------------- create / update / delete through the API

    @Test
    void createUpdateDeleteThroughTheApiAreLoggedWithTheActor() {
        JsonNode wh = call(HttpMethod.POST, "/api/master/warehouses", adminToken, Map.of("code", "AT1", "name", "audit one"), 200);
        String id = wh.get("id").asText();

        Map<String, Object> created = only("table_name = 'warehouse' and record_id = '" + id + "' and action = 'create'");
        assertThat(created).containsEntry("username", "admin").containsEntry("user_role", "ADMIN")
            .containsEntry("module", "master").containsEntry("ip_address", IP).containsEntry("user_agent", UA);
        assertThat(created.get("user_id")).isNotNull();
        assertThat(created.get("user_name")).isEqualTo("System Administrator");
        assertThat(created.get("old_values")).isNull();
        assertThat(node(created, "new_values").get("name").asText()).isEqualTo("AUDIT ONE");

        // update: only the changed field is stored, with its old value
        call(HttpMethod.PUT, "/api/master/warehouses/" + id, adminToken,
            Map.of("code", "AT1", "name", "audit one", "address", "Dhaka"), 200);
        Map<String, Object> updated = only("table_name = 'warehouse' and record_id = '" + id + "' and action = 'update'");
        assertThat(fieldNames(node(updated, "new_values"))).containsExactly("address");
        assertThat(node(updated, "new_values").get("address").asText()).isEqualTo("Dhaka");
        assertThat(node(updated, "old_values").get("address").isNull()).isTrue();

        // saving the same values again changes nothing, so it logs nothing
        call(HttpMethod.PUT, "/api/master/warehouses/" + id, adminToken,
            Map.of("code", "AT1", "name", "audit one", "address", "Dhaka"), 200);
        assertThat(count("table_name = 'warehouse' and record_id = '" + id + "' and action = 'update'")).isEqualTo(1);

        call(HttpMethod.DELETE, "/api/master/warehouses/" + id, adminToken, null, 200);
        Map<String, Object> deleted = only("table_name = 'warehouse' and record_id = '" + id + "' and action = 'delete'");
        assertThat(node(deleted, "old_values").get("name").asText()).isEqualTo("AUDIT ONE");
        assertThat(deleted.get("new_values")).isNull();
        assertThat(deleted).containsEntry("username", "admin");
    }

    // ---------------------------------------------------------------- bulk paths and the system actor

    @Test
    void bulkSaveOutsideARequestIsLoggedPerRowAsSystem() {
        List<Warehouse> batch = new ArrayList<>();
        for (int i = 1; i <= 3; i++) {
            Warehouse w = new Warehouse();
            w.setCode("BLK" + i);
            w.setName("BULK " + i);
            batch.add(w);
        }
        warehouses.saveAll(batch);      // no HTTP request, no signed-in user: what a scheduled job looks like

        List<Map<String, Object>> rows = rows("table_name = 'warehouse' and action = 'create' and new_values ->> 'code' like 'BLK%'");
        assertThat(rows).hasSize(3);
        assertThat(rows).allSatisfy(r -> {
            assertThat(r).containsEntry("username", "system").containsEntry("user_name", "system")
                .containsEntry("user_role", "SYSTEM").containsEntry("module", "system");
            assertThat(r.get("user_id")).isNull();
        });
    }

    @Test
    void bulkRawSqlUpdateAndDeleteAreLoggedPerRow() {
        for (int i = 1; i <= 4; i++) jdbc.update("insert into warehouse (code, name) values (?, ?)", "RAW" + i, "RAW " + i);

        // one statement, four rows, no ORM involved
        assertThat(jdbc.update("update warehouse set address = 'bulk moved' where code like 'RAW%'")).isEqualTo(4);
        List<Map<String, Object>> updates = rows("table_name = 'warehouse' and action = 'update' and new_values ->> 'address' = 'bulk moved'");
        assertThat(updates).hasSize(4);
        assertThat(updates).allSatisfy(r -> assertThat(fieldNames(node(r, "new_values"))).containsExactly("address"));

        assertThat(jdbc.update("delete from warehouse where code like 'RAW%'")).isEqualTo(4);
        assertThat(count("table_name = 'warehouse' and action = 'delete' and old_values ->> 'code' like 'RAW%'")).isEqualTo(4);
    }

    @Test
    void documentWithLinesReceiptAndCsvImportAreAllLogged() {
        String supplier = call(HttpMethod.POST, "/api/master/suppliers", adminToken, Map.of("code", "SUPA", "name", "Audit Supplier"), 200).get("id").asText();
        String product = call(HttpMethod.POST, "/api/master/products", adminToken,
            Map.of("sku", "AUD-1", "name", "AUDIT HINGE", "type", "HARDWARE", "unit", "PCS"), 200).get("id").asText();
        String warehouse = call(HttpMethod.POST, "/api/master/warehouses", adminToken, Map.of("code", "ATW", "name", "audit store"), 200).get("id").asText();

        // purchase order: header + cascaded lines, one transaction
        JsonNode po = call(HttpMethod.POST, "/api/purchase/orders", adminToken, Map.of("supplierId", supplier,
            "lines", List.of(Map.of("productId", product, "qty", 10, "unitPrice", 50, "freeProduct", false))), 200);
        String poId = text(po, "id", "poId");
        assertThat(count("table_name = 'purchase_order' and action = 'create' and record_id = '" + poId + "' and module = 'purchase'")).isEqualTo(1);
        Map<String, Object> line = only("table_name = 'po_line' and action = 'create' and new_values ->> 'po_id' = '" + poId + "'");
        assertThat(line).containsEntry("username", "admin").containsEntry("module", "purchase");

        // goods receipt: stock layers, stock movements and the auto-posted journal come from services, not the controller
        String poLineId = (String) line.get("record_id");
        call(HttpMethod.POST, "/api/purchase/orders/" + poId + "/receive", adminToken, Map.of("warehouseId", warehouse,
            "lines", List.of(Map.of("poLineId", poLineId, "qtyReceived", 4))), 200);
        for (String table : List.of("goods_receipt", "grn_line", "stock_layer", "stock_movement", "journal_entry", "journal_line"))
            assertThat(count("table_name = '" + table + "' and action = 'create' and username = 'admin' and module = 'purchase'"))
                .as("rows logged for " + table).isGreaterThan(0);
        // the PO line's received quantity moved: an update with only the changed columns
        assertThat(count("table_name = 'po_line' and action = 'update' and record_id = '" + poLineId + "'")).isGreaterThan(0);

        // CSV import
        long before = count("table_name = 'stock_layer' and action = 'create' and module = 'inventory'");
        HttpHeaders h = headers(adminToken);
        h.setContentType(MediaType.parseMediaType("text/csv"));
        ResponseEntity<String> imp = rest.exchange("/api/inventory/opening-import?dryRun=false", HttpMethod.POST,
            new HttpEntity<>("product_name,warehouse_name,qty,unit_cost\nAUDIT HINGE,AUDIT STORE,7,40\n", h), String.class);
        assertThat(imp.getStatusCode().value()).as(imp.getBody()).isEqualTo(200);
        assertThat(count("table_name = 'stock_layer' and action = 'create' and module = 'inventory'")).isGreaterThan(before);
        assertThat(count("table_name = 'stock_movement' and action = 'create' and module = 'inventory' and username = 'admin'")).isGreaterThan(0);
    }

    // ---------------------------------------------------------------- secrets, roles, soft delete

    @Test
    void passwordsAreMaskedAndRoleAndActiveChangesAreTagged() {
        JsonNode u = call(HttpMethod.POST, "/api/users", adminToken, Map.of("username", "auditee", "password", "S3cret-pass",
            "fullName", "Audit Ee", "role", "ACCOUNTANT", "shopIds", List.of()), 200);
        String id = u.get("id").asText();
        Map<String, Object> created = only("table_name = 'app_user' and record_id = '" + id + "' and action = 'create'");
        assertThat(node(created, "new_values").get("password_hash").asText()).isEqualTo("***");
        assertThat(created).containsEntry("module", "users");

        // password change: logged as a change, value masked on both sides
        call(HttpMethod.PUT, "/api/users/" + id, adminToken, Map.of("password", "An0ther-pass", "role", "ACCOUNTANT", "shopIds", List.of()), 200);
        Map<String, Object> pw = only("table_name = 'app_user' and record_id = '" + id + "' and action = 'update'");
        assertThat(fieldNames(node(pw, "new_values"))).containsExactly("password_hash");
        assertThat(node(pw, "new_values").get("password_hash").asText()).isEqualTo("***");
        assertThat(node(pw, "old_values").get("password_hash").asText()).isEqualTo("***");

        // role change
        call(HttpMethod.PUT, "/api/users/" + id, adminToken, Map.of("role", "ADMIN", "shopIds", List.of()), 200);
        Map<String, Object> role = only("table_name = 'app_user' and record_id = '" + id + "' and action = 'role_change'");
        assertThat(node(role, "old_values").get("role").asText()).isEqualTo("ACCOUNTANT");
        assertThat(node(role, "new_values").get("role").asText()).isEqualTo("ADMIN");

        // shop assignment is a permission change too (user_shop has a composite key)
        String shop = call(HttpMethod.POST, "/api/master/shops", adminToken,
            Map.of("code", "ATS", "name", "Audit Shop", "primaryLine", "BOARD", "monthlyTarget", 0, "pettyCashFloat", 0), 200).get("id").asText();
        call(HttpMethod.PUT, "/api/users/" + id, adminToken, Map.of("role", "MANAGER", "shopIds", List.of(shop)), 200);
        Map<String, Object> grant = only("table_name = 'user_shop' and action = 'role_change'");
        assertThat(grant.get("record_id")).isEqualTo(id + "," + shop);

        // deactivate = soft delete, reactivate = restore
        call(HttpMethod.PUT, "/api/users/" + id, adminToken, Map.of("role", "MANAGER", "shopIds", List.of(shop), "active", false), 200);
        assertThat(count("table_name = 'app_user' and record_id = '" + id + "' and action = 'delete'")).isEqualTo(1);
        call(HttpMethod.PUT, "/api/users/" + id, adminToken, Map.of("role", "MANAGER", "shopIds", List.of(shop), "active", true), 200);
        assertThat(count("table_name = 'app_user' and record_id = '" + id + "' and action = 'restore'")).isEqualTo(1);

        // nothing secret anywhere in the log: no plain password, no bcrypt hash
        assertThat(count("old_values::text ~ '(S3cret-pass|An0ther-pass|\\$2[aby]\\$)' or new_values::text ~ '(S3cret-pass|An0ther-pass|\\$2[aby]\\$)'")).isZero();
    }

    @Test
    void secretLookingSettingsAreMasked() {
        jdbc.update("insert into app_setting (key, value) values ('whatsapp_api_token', 'tok-12345')");
        Map<String, Object> row = only("table_name = 'app_setting' and record_id = 'whatsapp_api_token'");
        assertThat(node(row, "new_values").get("value").asText()).isEqualTo("***");
        jdbc.update("delete from app_setting where key = 'whatsapp_api_token'");
    }

    // ---------------------------------------------------------------- sign-in events

    @Test
    void loginFailedLoginAndLogoutAreLogged() {
        call(HttpMethod.POST, "/api/users", adminToken, Map.of("username", "signer", "password", "Sign-in-1",
            "fullName", "Sign Er", "role", "ACCOUNTANT", "shopIds", List.of()), 200);

        post("/api/auth/login", null, Map.of("username", "signer", "password", "wrong-guess"), 422);
        Map<String, Object> failed = only("action = 'login_failed' and username = 'signer'");
        assertThat(node(failed, "new_values").get("reason").asText()).isEqualTo("wrong_password");
        assertThat(failed).containsEntry("module", "auth").containsEntry("ip_address", IP).containsEntry("user_role", "ACCOUNTANT");
        assertThat(failed.get("user_id")).isNotNull();

        post("/api/auth/login", null, Map.of("username", "nobody-here", "password", "x"), 422);
        Map<String, Object> unknown = only("action = 'login_failed' and username = 'nobody-here'");
        assertThat(unknown.get("user_id")).isNull();
        assertThat(node(unknown, "new_values").get("reason").asText()).isEqualTo("unknown_user");

        String token = login("signer", "Sign-in-1");
        assertThat(only("action = 'login' and username = 'signer'")).containsEntry("user_name", "Sign Er");

        post("/api/auth/logout", token, null, 200);
        assertThat(only("action = 'logout' and username = 'signer'")).containsEntry("user_role", "ACCOUNTANT");

        assertThat(count("new_values::text ~ '(wrong-guess|Sign-in-1)'")).isZero();
    }

    // ---------------------------------------------------------------- tamper-proofing and access

    @Test
    void auditEntriesCannotBeChangedDeletedOrTruncated() {
        jdbc.update("insert into app_setting (key, value) values ('audit_probe', '1')");
        long id = jdbc.queryForObject("select max(id) from audit_log", Long.class);
        long before = count("true");

        assertThatThrownBy(() -> jdbc.update("update audit_log set username = 'someone-else' where id = ?", id))
            .isInstanceOf(DataAccessException.class).hasMessageContaining("cannot be changed or deleted");
        assertThatThrownBy(() -> jdbc.update("delete from audit_log where id = ?", id))
            .isInstanceOf(DataAccessException.class).hasMessageContaining("cannot be changed or deleted");
        assertThatThrownBy(() -> jdbc.execute("truncate audit_log"))
            .isInstanceOf(DataAccessException.class).hasMessageContaining("cannot be changed or deleted");

        assertThat(count("true")).isEqualTo(before);
        // and the API offers no way in either, even to an admin
        for (HttpMethod m : List.of(HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE)) {
            assertThat(status(m, "/api/audit-log", adminToken, Map.of())).as(m + " /api/audit-log").isGreaterThanOrEqualTo(400);
            assertThat(status(m, "/api/audit-log/" + id, adminToken, Map.of())).as(m + " /api/audit-log/{id}").isGreaterThanOrEqualTo(400);
        }
        assertThat(count("true")).isEqualTo(before);
    }

    @Test
    void aFailingAuditWriteRollsTheChangeBack() {
        // force the audit insert to fail (module longer than its column) on the very connection that writes
        assertThatThrownBy(() -> jdbc.execute((java.sql.Connection c) -> {
            try (var st = c.createStatement()) {
                st.execute("select set_config('mim.audit_module', repeat('x', 60), false)");
                st.executeUpdate("insert into warehouse (code, name) values ('RBK', 'ROLLED BACK')");
            }
            return null;
        })).isInstanceOf(DataAccessException.class);

        assertThat(jdbc.queryForObject("select count(*) from warehouse where code = 'RBK'", Long.class))
            .as("the warehouse must not exist without its audit entry").isZero();
    }

    @Test
    void activityLogIsAdminOnly() {
        call(HttpMethod.POST, "/api/users", adminToken, Map.of("username", "bookkeeper", "password", "Books-123",
            "fullName", "Book Keeper", "role", "ACCOUNTANT", "shopIds", List.of()), 200);
        String accountant = login("bookkeeper", "Books-123");

        for (String path : List.of("/api/audit-log", "/api/audit-log/1", "/api/audit-log/facets", "/api/audit-log/export"))
            assertThat(status(HttpMethod.GET, path, accountant, null)).as("non-admin GET " + path).isEqualTo(403);
        assertThat(status(HttpMethod.GET, "/api/audit-log", null, null)).as("anonymous").isIn(401, 403);

        // the master-data fix: a non-admin can no longer edit or delete master records
        String anyId = "00000000-0000-0000-0000-000000000000";
        assertThat(status(HttpMethod.PUT, "/api/master/warehouses/" + anyId, accountant, Map.of("code", "X", "name", "X"))).isEqualTo(403);
        assertThat(status(HttpMethod.DELETE, "/api/master/products/" + anyId, accountant, null)).isEqualTo(403);
    }

    @Test
    void adminCanPageFilterOpenAndExport() {
        String id = call(HttpMethod.POST, "/api/master/warehouses", adminToken, Map.of("code", "FLT", "name", "filter me"), 200).get("id").asText();
        String adminId = jdbc.queryForObject("select id::text from app_user where username = 'admin'", String.class);
        String today = jdbc.queryForObject("select (now() at time zone 'Asia/Dhaka')::date::text", String.class);

        JsonNode page = call(HttpMethod.GET, "/api/audit-log?size=5", adminToken, null, 200);
        assertThat(page.get("items").size()).isLessThanOrEqualTo(5);
        assertThat(page.get("total").asLong()).isGreaterThan(0);
        long first = page.get("items").get(0).get("id").asLong();
        assertThat(first).as("newest first").isEqualTo(jdbc.queryForObject("select max(id) from audit_log", Long.class));

        JsonNode filtered = call(HttpMethod.GET, "/api/audit-log?module=master&action=create&user=" + adminId
            + "&recordId=" + id + "&from=" + today + "&to=" + today + "&q=FILTER", adminToken, null, 200);
        assertThat(filtered.get("total").asLong()).isEqualTo(1);
        JsonNode item = filtered.get("items").get(0);
        assertThat(item.get("tableName").asText()).isEqualTo("warehouse");
        assertThat(item.get("userName").asText()).isEqualTo("System Administrator");
        assertThat(item.get("login").asText()).isEqualTo("admin");
        assertThat(item.get("userRole").asText()).isEqualTo("ADMIN");
        assertThat(item.get("ipAddress").asText()).isEqualTo(IP);

        assertThat(call(HttpMethod.GET, "/api/audit-log?user=system&module=nonexistent", adminToken, null, 200).get("total").asLong()).isZero();

        JsonNode one = call(HttpMethod.GET, "/api/audit-log/" + item.get("id").asLong(), adminToken, null, 200);
        assertThat(one.get("newValues").get("name").asText()).isEqualTo("FILTER ME");
        assertThat(one.get("oldValues").isNull()).isTrue();

        JsonNode facets = call(HttpMethod.GET, "/api/audit-log/facets", adminToken, null, 200);
        assertThat(facets.get("modules").toString()).contains("master");

        ResponseEntity<String> csv = rest.exchange("/api/audit-log/export?recordId=" + id, HttpMethod.GET,
            new HttpEntity<>(headers(adminToken)), String.class);
        assertThat(csv.getStatusCode().value()).isEqualTo(200);
        assertThat(csv.getHeaders().getContentType().toString()).startsWith("text/csv");
        assertThat(csv.getBody()).contains("ID,Time (Asia/Dhaka),User,Username").contains("FILTER ME").contains(id);
        assertThat(csv.getBody().lines().count()).isEqualTo(2);     // header + the one matching entry
    }

    // ---------------------------------------------------------------- helpers

    private String login(String username, String password) {
        return post("/api/auth/login", null, Map.of("username", username, "password", password), 200).get("token").asText();
    }

    private HttpHeaders headers(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.set("User-Agent", UA);
        h.set("X-Forwarded-For", IP);
        if (token != null) h.setBearerAuth(token);
        return h;
    }

    private JsonNode post(String path, String token, Object body, int expected) {
        return call(HttpMethod.POST, path, token, body, expected);
    }

    private JsonNode call(HttpMethod method, String path, String token, Object body, int expected) {
        ResponseEntity<String> res = rest.exchange(path, method, new HttpEntity<>(body, headers(token)), String.class);
        assertThat(res.getStatusCode().value()).as(method + " " + path + " -> " + res.getBody()).isEqualTo(expected);
        try {
            return res.getBody() == null || res.getBody().isBlank() ? json.nullNode() : json.readTree(res.getBody());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private int status(HttpMethod method, String path, String token, Object body) {
        return rest.exchange(path, method, new HttpEntity<>(body, headers(token)), String.class).getStatusCode().value();
    }

    private static final String ROW =
        "select id, user_id, username, user_name, user_role, action, module, table_name, record_id, "
      + "old_values::text as old_values, new_values::text as new_values, ip_address, user_agent from audit_log where ";

    private List<Map<String, Object>> rows(String where) {
        return jdbc.queryForList(ROW + where + " order by id");
    }

    private Map<String, Object> only(String where) {
        List<Map<String, Object>> rows = rows(where);
        assertThat(rows).as("audit rows where " + where).hasSize(1);
        return rows.get(0);
    }

    private long count(String where) {
        return jdbc.queryForObject("select count(*) from audit_log where " + where, Long.class);
    }

    private JsonNode node(Map<String, Object> row, String column) {
        try {
            return json.readTree((String) row.get(column));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static List<String> fieldNames(JsonNode n) {
        List<String> names = new ArrayList<>();
        n.fieldNames().forEachRemaining(names::add);
        return names;
    }

    private static String text(JsonNode n, String... candidates) {
        for (String c : candidates) if (n.hasNonNull(c)) return n.get(c).asText();
        throw new IllegalStateException("none of " + List.of(candidates) + " in " + n);
    }
}
