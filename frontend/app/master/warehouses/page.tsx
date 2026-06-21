"use client";
import { useEffect, useState } from "react";
import { endpoints, type Warehouse } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EditIcon, TrashIcon } from "@/components/Icons";

export default function WarehousesPage() {
  const { t, dn } = useI18n();
  const [rows, setRows] = useState<Warehouse[]>([]);
  const [f, setF] = useState<Partial<Warehouse>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = () => endpoints.warehouses().then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  const filtered = rows.filter((r) => { const v=q.trim().toLowerCase(); return !v || [r.code,r.name,r.nameBn].filter(Boolean).some((x)=>x!.toLowerCase().includes(v)); });

  function reset() { setF({}); setEditId(null); }

  async function save() {
    setMsg(null);
    if (!f.code || !f.name) { setMsg({ kind: "err", text: "Code and name are required." }); return; }
    try {
      if (editId) await endpoints.updateWarehouse(editId, f);
      else await endpoints.saveWarehouse(f);
      setMsg({ kind: "ok", text: t("Saved.") }); reset(); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  async function remove(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    setMsg(null);
    try { await endpoints.deleteWarehouse(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  function edit(w: Warehouse) { setF(w); setEditId(w.id); window.scrollTo({ top: 0, behavior: "smooth" }); }

  return (
    <div>
      <h1 className="page-title mb-5">{t("Warehouses")}</h1>

      <div className="card p-5 mb-6">
        <div className="form-grid cols-4">
          <div className="field"><label>{t("Code")}</label>
            <input className="inp" value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label>{t("Name")}</label>
            <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Name (Bangla)")}</label>
            <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>Branch</label>
            <input className="inp" value={f.branch ?? ""} onChange={(e) => setF({ ...f, branch: e.target.value })} /></div>
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
          <thead><tr><th>{t("Code")}</th><th>{t("Name")}</th><th>{t("Name (Bangla)")}</th><th>Branch</th><th>{t("Address")}</th><th className="text-right">{t("Actions")}</th></tr></thead>
          <tbody>
            {filtered.map((w) => (
              <tr key={w.id}>
                <td className="font-mono text-[13px]">{w.code}</td>
                <td>{dn(w)}</td>
                <td className="muted">{w.nameBn ?? "—"}</td>
                <td className="muted">{w.branch ?? "—"}</td>
                <td className="muted">{w.address ?? "—"}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn-icon btn-icon-edit mr-1" title="Edit" onClick={() => edit(w)}><EditIcon /></button>
                  <button className="btn-icon btn-icon-del" title="Delete" onClick={() => remove(w.id)}><TrashIcon /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
