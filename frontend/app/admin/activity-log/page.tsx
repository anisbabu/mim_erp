"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import {
  endpoints, type AuditAction, type AuditDetail, type AuditEntry, type AuditFacets, type AuditFilter,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import Drawer from "@/components/Drawer";

const PAGE_SIZE = 50;
const EMPTY: AuditFilter = { user: "", module: "", action: "", from: "", to: "", recordId: "", q: "" };

const ACTION_LABEL: Record<AuditAction, string> = {
  create: "Created", update: "Updated", delete: "Deleted", restore: "Restored", role_change: "Role change",
  login: "Signed in", logout: "Signed out", login_failed: "Failed sign-in",
};
const ACTION_CHIP: Record<AuditAction, string> = {
  create: "chip-posted", update: "chip-pending", delete: "chip-bounced", restore: "chip-cashed", role_change: "chip-hold",
  login: "chip-cancelled", logout: "chip-cancelled", login_failed: "chip-overdue",
};

/** A stored value as text: objects stay JSON, missing shows as a dash. */
function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Admin-only, read-only view of the audit log. The API answers 403 to every other role. */
export default function ActivityLogPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [filter, setFilter] = useState<AuditFilter>(EMPTY);
  const [applied, setApplied] = useState<AuditFilter>(EMPTY);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<AuditFacets>({ modules: [], actions: [], users: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);

  // typing in a filter applies it after a short pause and goes back to the first page
  useEffect(() => {
    const id = setTimeout(() => { setApplied(filter); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [filter]);

  useEffect(() => {
    if (!isAdmin) return;
    endpoints.auditFacets().then(setFacets).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let stale = false;
    setBusy(true);
    endpoints.auditLog(applied, page, PAGE_SIZE)
      .then((p) => { if (!stale) { setRows(p.items); setTotal(p.total); setErr(null); } })
      .catch((e: Error) => { if (!stale) setErr(e.message); })
      .finally(() => { if (!stale) setBusy(false); });
    return () => { stale = true; };
  }, [isAdmin, applied, page]);

  const closeDetail = useCallback(() => setDetail(null), []);
  const set = (k: keyof AuditFilter) => (e: { target: { value: string } }) => setFilter((f) => ({ ...f, [k]: e.target.value }));
  const actionLabel = (a: AuditAction) => t(ACTION_LABEL[a] ?? a);

  async function open(id: number) {
    try { setDetail(await endpoints.auditEntry(id)); }
    catch (e) { setErr((e as Error).message); }
  }

  async function exportCsv() {
    try {
      const blob = await endpoints.auditExport(applied);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr((e as Error).message); }
  }

  if (!isAdmin) {
    return (
      <div>
        <PageHeader crumbs={["Administration"]} title={t("Activity Log")} />
        <div className="card p-8 text-center">
          <div className="text-lg font-medium mb-1">{t("Access denied (403)")}</div>
          <div className="text-sm muted">{t("Only an administrator can view the activity log.")}</div>
        </div>
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);
  const filtered = Object.values(applied).some((v) => v);
  const fields = detail
    ? Array.from(new Set([...Object.keys(detail.oldValues ?? {}), ...Object.keys(detail.newValues ?? {})])).sort()
    : [];

  return (
    <div>
      <PageHeader crumbs={["Administration"]} title={t("Activity Log")}
        subtitle={t("Every create, update and delete, and who did it. Entries cannot be changed or removed.")}
        actions={<button className="btn-ghost" onClick={exportCsv}><Download size={14} className="mr-1.5" />{t("Export CSV")}</button>} />

      {/* toolbar: search + filters */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="field" style={{ width: 260 }}>
          <label>{t("Search…")}</label>
          <input className="inp" placeholder={t("Search user, table, record or value…")} value={filter.q} onChange={set("q")} />
        </div>
        <div className="field" style={{ width: 170 }}>
          <label>{t("User")}</label>
          <select className="inp" value={filter.user} onChange={set("user")}>
            <option value="">{t("All users")}</option>
            {facets.users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
            <option value="system">{t("System / unknown")}</option>
          </select>
        </div>
        <div className="field" style={{ width: 140 }}>
          <label>{t("Module")}</label>
          <select className="inp" value={filter.module} onChange={set("module")}>
            <option value="">{t("All modules")}</option>
            {facets.modules.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="field" style={{ width: 150 }}>
          <label>{t("Action")}</label>
          <select className="inp" value={filter.action} onChange={set("action")}>
            <option value="">{t("All actions")}</option>
            {(Object.keys(ACTION_LABEL) as AuditAction[]).map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
        </div>
        <div className="field" style={{ width: 140 }}>
          <label>{t("From")}</label>
          <input className="inp" type="date" value={filter.from} onChange={set("from")} />
        </div>
        <div className="field" style={{ width: 140 }}>
          <label>{t("To")}</label>
          <input className="inp" type="date" value={filter.to} onChange={set("to")} />
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>{t("Record ID")}</label>
          <input className="inp font-mono" value={filter.recordId} onChange={set("recordId")} />
        </div>
        {filtered && <button className="btn-ghost" onClick={() => setFilter(EMPTY)}>{t("Clear")}</button>}
      </div>

      {err && <div className="note note-err mb-3">{err}</div>}

      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr>
            <th style={{ textAlign: "left" }}>{t("Time")}</th><th style={{ textAlign: "left" }}>{t("User")}</th>
            <th style={{ textAlign: "left" }}>{t("Action")}</th><th style={{ textAlign: "left" }}>{t("Module")}</th>
            <th style={{ textAlign: "left" }}>{t("Record")}</th><th style={{ textAlign: "left" }}>{t("Changed fields")}</th>
            <th style={{ textAlign: "left" }}>{t("IP address")}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: "pointer" }}>
                <td className="whitespace-nowrap tabular-nums">{r.at}</td>
                <td>
                  <div>{r.userName}</div>
                  <div className="text-[11px] muted">{r.userRole.toLowerCase()}</div>
                </td>
                <td><span className={`chip ${ACTION_CHIP[r.action] ?? "chip-cancelled"}`}>{actionLabel(r.action)}</span></td>
                <td>{r.module}</td>
                <td>
                  <div>{r.tableName ?? "—"}</div>
                  {r.recordId && <div className="font-mono text-[11px] muted">{r.recordId}</div>}
                </td>
                <td className="text-[12px] muted" style={{ maxWidth: 260 }}><div className="truncate">{r.fields ?? ""}</div></td>
                <td className="font-mono text-[12px] whitespace-nowrap">{r.ipAddress ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="text-center muted py-6">{busy ? t("Loading…") : t("No activity found.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between mt-3 text-[13px]">
        <span className="muted tabular-nums">{first}–{last} {t("of")} {total.toLocaleString("en-IN")}</span>
        <div className="flex items-center gap-2">
          <button className="btn-ghost btn-sm" disabled={page === 0 || busy} onClick={() => setPage(page - 1)}>{t("Previous")}</button>
          <span className="muted tabular-nums">{page + 1} / {pages}</span>
          <button className="btn-ghost btn-sm" disabled={page + 1 >= pages || busy} onClick={() => setPage(page + 1)}>{t("Next")}</button>
        </div>
      </div>

      {/* detail: old and new values side by side */}
      <Drawer open={!!detail} onClose={closeDetail} title={t("Activity details")}
        subtitle={detail ? `#${detail.id} · ${detail.at}` : undefined}
        footer={<button className="btn-ghost" onClick={closeDetail}>{t("Close")}</button>}>
        {detail && (
          <div>
            <div className="mb-3"><span className={`chip ${ACTION_CHIP[detail.action] ?? "chip-cancelled"}`}>{actionLabel(detail.action)}</span></div>
            <dl className="grid gap-x-3 gap-y-1.5 text-[13px] mb-4" style={{ gridTemplateColumns: "110px 1fr" }}>
              <dt className="muted">{t("User")}</dt><dd>{detail.userName} ({detail.login})</dd>
              <dt className="muted">{t("Role")}</dt><dd>{detail.userRole}</dd>
              <dt className="muted">{t("Module")}</dt><dd>{detail.module}</dd>
              <dt className="muted">{t("Table")}</dt><dd>{detail.tableName ?? "—"}</dd>
              <dt className="muted">{t("Record ID")}</dt><dd className="font-mono text-[12px] break-all">{detail.recordId ?? "—"}</dd>
              <dt className="muted">{t("IP address")}</dt><dd className="font-mono text-[12px]">{detail.ipAddress ?? "—"}</dd>
              <dt className="muted">{t("User agent")}</dt><dd className="text-[12px] break-words">{detail.userAgent ?? "—"}</dd>
            </dl>

            {fields.length === 0 ? (
              <div className="text-[13px] muted">{t("No field values for this entry.")}</div>
            ) : (
              <table className="tbl" style={{ tableLayout: "fixed" }}>
                <thead><tr>
                  <th style={{ textAlign: "left", width: "30%" }}>{t("Field")}</th>
                  <th style={{ textAlign: "left" }}>{t("Old value")}</th>
                  <th style={{ textAlign: "left" }}>{t("New value")}</th>
                </tr></thead>
                <tbody>
                  {fields.map((k) => (
                    <tr key={k}>
                      <td className="font-mono text-[12px] break-all" style={{ verticalAlign: "top" }}>{k}</td>
                      <td className="text-[12px] break-words" style={{ verticalAlign: "top", color: "var(--note-err-fg)" }}>
                        {detail.oldValues ? show(detail.oldValues[k]) : "—"}</td>
                      <td className="text-[12px] break-words" style={{ verticalAlign: "top", color: "var(--note-ok-fg)" }}>
                        {detail.newValues ? show(detail.newValues[k]) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="text-[11px] muted mt-3">{t("Secret values are masked as ***.")}</div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
