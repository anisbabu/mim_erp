"use client";
import { useEffect, useMemo, useState } from "react";
import { endpoints, type Product } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function ProductsPage() {
  const { t, dn } = useI18n();
  const [rows, setRows] = useState<Product[]>([]);
  const [f, setF] = useState<Partial<Product>>({ type: "BOARD", unit: "PCS" });
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = () => endpoints.products().then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  function reset() { setF({ type: "BOARD", unit: "PCS" }); setEditId(null); }

  async function save() {
    setMsg(null);
    if (!f.sku || !f.name) { setMsg({ kind: "err", text: "SKU and name are required." }); return; }
    const body = { ...f, thicknessMm: f.type === "BOARD" ? f.thicknessMm : undefined };
    try {
      if (editId) await endpoints.updateProduct(editId, body);
      else await endpoints.saveProduct(body);
      setMsg({ kind: "ok", text: t("Saved.") }); reset(); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  async function remove(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    setMsg(null);
    try { await endpoints.deleteProduct(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  function edit(p: Product) { setF(p); setEditId(p.id); window.scrollTo({ top: 0, behavior: "smooth" }); }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((p) =>
      [p.sku, p.name, p.nameBn].filter(Boolean).some((v) => v!.toLowerCase().includes(s)));
  }, [q, rows]);

  return (
    <div>
      <h1 className="text-2xl font-medium mb-5">{t("Products")}</h1>

      <div className="card p-5 mb-6">
        <div className="form-grid cols-3">
          <div className="field"><label>{t("Code")}</label>
            <input className="inp" value={f.sku ?? ""} onChange={(e) => setF({ ...f, sku: e.target.value })} /></div>
          <div className="field"><label>{t("Name")}</label>
            <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label>{t("Name (Bangla)")}</label>
            <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
          <div className="field"><label>{t("Type")}</label>
            <select className="inp" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as "BOARD" | "HARDWARE" })}>
              <option value="BOARD">{t("Board")}</option><option value="HARDWARE">{t("Hardware")}</option>
            </select></div>
          {f.type === "BOARD" && (
            <div className="field"><label>{t("Thickness")} (mm)</label>
              <input className="inp num" type="number" value={f.thicknessMm ?? ""} onChange={(e) => setF({ ...f, thicknessMm: Number(e.target.value) })} /></div>
          )}
          <div className="field"><label>{t("Unit")}</label>
            <input className="inp" value={f.unit ?? ""} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
          <div className="field"><label>{t("Price band")} ({t("low")})</label>
            <input className="inp num" type="number" value={f.priceLower ?? ""} onChange={(e) => setF({ ...f, priceLower: Number(e.target.value) })} /></div>
          <div className="field"><label>{t("Price band")} ({t("high")})</label>
            <input className="inp num" type="number" value={f.priceUpper ?? ""} onChange={(e) => setF({ ...f, priceUpper: Number(e.target.value) })} /></div>
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
          <thead><tr><th>{t("Code")}</th><th>{t("Name")}</th><th>{t("Type")}</th>
            <th className="text-right">{t("Thickness")}</th><th className="text-right">{t("Price band")}</th>
            <th className="text-right">{t("Actions")}</th></tr></thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td className="font-mono text-[13px]">{p.sku}</td>
                <td>{dn(p)}</td>
                <td className="text-xs">{p.type === "BOARD" ? t("Board") : t("Hardware")}</td>
                <td className="num">{p.thicknessMm ?? "—"}</td>
                <td className="num">{p.priceLower ?? "—"}–{p.priceUpper ?? "—"}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn-ghost btn-sm mr-2" onClick={() => edit(p)}>{t("Edit")}</button>
                  <button className="btn-ghost btn-sm btn-danger-ghost" onClick={() => remove(p.id)}>{t("Delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
