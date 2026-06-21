"use client";
import { useEffect, useState } from "react";
import { endpoints, type Shop } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function ShopsPage() {
  const { t, dn } = useI18n();
  const [rows, setRows] = useState<Shop[]>([]);
  const [f, setF] = useState<Partial<Shop>>({ primaryLine: "BOARD" });
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = () => endpoints.shops().then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  const filtered = rows
    .filter((r) => { const v=q.trim().toLowerCase(); return !v || [r.code,r.name,r.nameBn].filter(Boolean).some((x)=>x!.toLowerCase().includes(v)); })
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));

  function reset() { setF({ primaryLine: "BOARD" }); setEditId(null); }

  async function save() {
    setMsg(null);
    if (!f.code || !f.name) { setMsg({ kind: "err", text: "Code and name are required." }); return; }
    try {
      if (editId) await endpoints.updateShop(editId, f);
      else await endpoints.saveShop(f);
      setMsg({ kind: "ok", text: t("Saved.") }); reset(); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  async function remove(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    setMsg(null);
    try { await endpoints.deleteShop(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  function edit(s: Shop) { setF(s); setEditId(s.id); window.scrollTo({ top: 0, behavior: "smooth" }); }

  return (
    <div>
      <h1 className="text-2xl font-medium mb-5">{t("Shops")}</h1>

      <div className="card p-5 mb-6">
        <div className="form-grid cols-3">
          <div className="field"><label>{t("Code")}</label>
            <input className="inp" value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label>{t("Name")}</label>
            <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label>{t("Name (Bangla)")}</label>
            <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
          <div className="field"><label>{t("Primary line")}</label>
            <select className="inp" value={f.primaryLine} onChange={(e) => setF({ ...f, primaryLine: e.target.value })}>
              <option value="BOARD">{t("Board")}</option><option value="HARDWARE">{t("Hardware")}</option>
            </select></div>
          <div className="field"><label>{t("Mobile")}</label>
            <input className="inp" value={f.mobile ?? ""} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
          <div className="field"><label>{t("Location")}</label>
            <input className="inp" value={f.location ?? ""} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
          <div className="field"><label>{t("Monthly target")}</label>
            <input className="inp num" type="number" value={f.monthlyTarget ?? ""} onChange={(e) => setF({ ...f, monthlyTarget: Number(e.target.value) })} /></div>
          <div className="field"><label>{t("Petty cash float")}</label>
            <input className="inp num" type="number" value={f.pettyCashFloat ?? ""} onChange={(e) => setF({ ...f, pettyCashFloat: Number(e.target.value) })} /></div>
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
          <thead><tr><th>{t("Code")}</th><th>{t("Name")}</th><th>{t("Name (Bangla)")}</th><th>{t("Primary line")}</th>
            <th className="text-right">{t("Monthly target")}</th><th className="text-right">{t("Actions")}</th></tr></thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td className="font-mono text-[13px]">{s.code}</td>
                <td>{dn(s)}</td>
                <td className="muted">{s.nameBn ?? "—"}</td>
                <td className="text-xs">{s.primaryLine === "BOARD" ? t("Board") : t("Hardware")}</td>
                <td className="num">{s.monthlyTarget ?? 0}</td>
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
