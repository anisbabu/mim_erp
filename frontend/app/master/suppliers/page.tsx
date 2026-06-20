"use client";
import { useEffect, useMemo, useState } from "react";
import { endpoints, type Supplier } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function SuppliersPage() {
  const { t, dn } = useI18n();
  const [rows, setRows] = useState<Supplier[]>([]);
  const [f, setF] = useState<Partial<Supplier>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = () => endpoints.suppliers().then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  function reset() { setF({}); setEditId(null); }

  async function save() {
    setMsg(null);
    if (!f.code || !f.name) { setMsg({ kind: "err", text: "Code and name are required." }); return; }
    try {
      if (editId) await endpoints.updateSupplier(editId, f); else await endpoints.saveSupplier(f);
      setMsg({ kind: "ok", text: t("Saved.") }); reset(); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  async function remove(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    try { await endpoints.deleteSupplier(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  function edit(s: Supplier) { setF(s); setEditId(s.id); window.scrollTo({ top: 0, behavior: "smooth" }); }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.code, r.name, r.nameBn, r.mobile].filter(Boolean).some((v) => v!.toLowerCase().includes(s)));
  }, [q, rows]);

  return (
    <div>
      <h1 className="text-2xl font-medium mb-5">{t("Suppliers")}</h1>
      <div className="card p-5 mb-6">
        <div className="form-grid cols-3">
          <div className="field"><label>{t("Code")}</label>
            <input className="inp" value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label>{t("Name")}</label>
            <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label>{t("Name (Bangla)")}</label>
            <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
          <div className="field"><label>{t("Mobile")}</label>
            <input className="inp" value={f.mobile ?? ""} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Address")}</label>
            <input className="inp" value={f.address ?? ""} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button className="btn" onClick={save}>{editId ? t("Update") : t("Add")}</button>
          {editId && <button className="btn-ghost" onClick={reset}>{t("Cancel")}</button>}
          {msg && <span className="text-sm ml-1" style={{ color: msg.kind === "ok" ? "#2f6f5e" : "#b3261e" }}>{msg.text}</span>}
        </div>
      </div>
      <div className="mb-3" style={{ maxWidth: 320 }}>
        <input className="inp" placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr><th>{t("Code")}</th><th>{t("Name")}</th><th>{t("Mobile")}</th><th>{t("Address")}</th><th className="text-right">{t("Actions")}</th></tr></thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td className="font-mono text-[13px]">{s.code}</td>
                <td>{dn(s)}</td><td>{s.mobile ?? "—"}</td><td className="muted">{s.address ?? "—"}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn-ghost btn-sm mr-2" onClick={() => edit(s)}>{t("Edit")}</button>
                  <button className="btn-ghost btn-sm btn-danger-ghost" onClick={() => remove(s.id)}>{t("Delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
