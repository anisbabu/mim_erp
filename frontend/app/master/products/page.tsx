"use client";
import { useEffect, useMemo, useState } from "react";
import { endpoints, type Product, type Supplier } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EditIcon, TrashIcon } from "@/components/Icons";

const CATEGORIES  = ["MDF", "PLY", "Melamine", "HPL", "Acrylic Sheet", "Formica", "PVC"];
const THICKNESSES = [6, 12, 13, 16.3, 18, 19, 25];
const COLORS = [
  "ASH", "Amble teak", "American Cherry", "BT", "BT Apple", "BT Crown Elite",
  "BT Shady grain", "BT- Lime", "Beech", "Black Chapeli", "Brown Gorjan",
  "Burma Teak Flowery", "CROWN OAK", "CT", "Califonia Ebony", "Cedar", "Champa",
  "Chestnut", "Coco Brown", "Commercial", "Curly Teak", "Fish Ash", "Garjon",
  "Golden Ornate Teak", "Golden Teak", "Marine BT", "Marine CT", "Marine Red Oak",
  "Marine US Walnut", "Marine garjon", "Mehogony Crown", "Pine", "RUSTIC", "Radient",
  "Red Oak", "Royel Crown Teak", "Shuttering", "Super Alien", "Super Sapelli",
  "Super Straight Teak", "Super White Ash", "SuperTeak", "Swiss Walnut",
  "USA Black Walnut", "Urban Teak", "Wenge", "White oak",
];
const HW_UNITS   = ["PCS", "SET", "KG", "MTR", "BOX", "ROLL", "PAIR", "DOZ"];
const CAT_CODE: Record<string, string> = {
  "MDF": "M", "PLY": "P", "Melamine": "ML", "HPL": "H",
  "Acrylic Sheet": "A", "Formica": "F", "PVC": "PV",
};

function genBoardSku(
  f: { thicknessMm?: number; name?: string; category?: string; color?: string; supplierId?: string },
  suppliers: { id: string; name: string }[],
): string {
  const th  = f.thicknessMm ? String(Math.round(f.thicknessMm)) : "";
  const n   = f.name?.trim()[0]?.toUpperCase() ?? "";
  const c   = CAT_CODE[f.category ?? ""] ?? "";
  const col = f.color?.trim()[0]?.toUpperCase() ?? "";
  const sup = suppliers.find((s) => s.id === f.supplierId)?.name?.trim()[0]?.toUpperCase() ?? "";
  return `${th}${n}${c}${col}${sup}`;
}

function genHardwareSku(
  f: { name?: string; supplierId?: string },
  suppliers: { id: string; name: string }[],
): string {
  const n   = f.name?.trim().slice(0, 2).toUpperCase() ?? "";
  const sup = suppliers.find((s) => s.id === f.supplierId)?.name?.trim().slice(0, 2).toUpperCase() ?? "";
  return `${n}${sup}`;
}

function genFullName(
  f: { type?: string; thicknessMm?: number; name?: string; category?: string; color?: string; supplierId?: string },
  suppliers: { id: string; name: string }[],
): string {
  if (f.type === "BOARD") {
    const supWord = suppliers.find((s) => s.id === f.supplierId)?.name?.trim().split(/\s+/)[0];
    const supPart = supWord ? `(${supWord})` : "";
    return [
      f.thicknessMm != null ? `${f.thicknessMm}MM` : "",
      f.name?.trim() ?? "",
      f.category?.trim() ?? "",
      f.color?.trim() ?? "",
      supPart,
    ].filter(Boolean).join("-");
  }
  return f.name?.trim() ?? "";
}

const R = () => <span className="text-red-500 ml-0.5">*</span>;

export default function ProductsPage() {
  const { t, dn } = useI18n();
  const [rows, setRows]         = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [f, setF]               = useState<Partial<Product>>({ type: "BOARD", unit: "PCS" });
  const [editId, setEditId]     = useState<string | null>(null);
  const [manualSku, setManualSku] = useState(false);
  const [q, setQ]               = useState("");
  const [msg, setMsg]           = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = () => endpoints.products().then(setRows).catch(() => {});
  useEffect(() => { load(); endpoints.suppliers().then(setSuppliers).catch(() => {}); }, []);

  // Auto-generate SKU when creating new
  useEffect(() => {
    if (manualSku) return;
    const sku = f.type === "BOARD"
      ? genBoardSku(f, suppliers)
      : genHardwareSku(f, suppliers);
    if (sku) setF((prev) => ({ ...prev, sku }));
  }, [f.thicknessMm, f.name, f.category, f.color, f.supplierId, f.type, manualSku, suppliers]);

  // Auto-generate full name
  useEffect(() => {
    const fn = genFullName(f, suppliers);
    setF((prev) => ({ ...prev, fullName: fn || undefined }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.type, f.thicknessMm, f.name, f.category, f.color, f.supplierId, suppliers]);

  function reset() { setF({ type: "BOARD", unit: "PCS" }); setEditId(null); setManualSku(false); }

  function handleType(type: "BOARD" | "HARDWARE") {
    setF({ type, unit: type === "BOARD" ? "PCS" : undefined, thicknessMm: undefined });
  }

  async function save() {
    setMsg(null);
    const isBoard = f.type === "BOARD";
    const missing: string[] = [];
    if (!f.name)                        missing.push(t("Name"));
    if (!f.nameBn)                      missing.push(t("Name (Bangla)"));
    if (isBoard && !f.thicknessMm)      missing.push(t("Thickness"));
    if (isBoard && !f.category)         missing.push(t("Category"));
    if (isBoard && !f.supplierId)       missing.push(t("Supplier"));
    if (!f.unit)                        missing.push(t("Unit"));
    if (!f.priceLower)                  missing.push(t("Price (low)"));
    if (!f.priceUpper)                  missing.push(t("Price (high)"));
    if (missing.length) { setMsg({ kind: "err", text: `${t("Required")}: ${missing.join(", ")}` }); return; }
    const body = { ...f, thicknessMm: isBoard ? f.thicknessMm : undefined };
    try {
      if (editId) await endpoints.updateProduct(editId, body);
      else        await endpoints.saveProduct(body);
      setMsg({ kind: "ok", text: t("Saved.") }); reset(); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  async function remove(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    setMsg(null);
    try { await endpoints.deleteProduct(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  function edit(p: Product) { setF(p); setEditId(p.id); setManualSku(false); window.scrollTo({ top: 0, behavior: "smooth" }); }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((p) =>
      [p.sku, p.name, p.nameBn, p.category].filter(Boolean).some((v) => v!.toLowerCase().includes(s)));
  }, [q, rows]);

  const isBoard = f.type === "BOARD";

  return (
    <div>
      <h1 className="page-title mb-5">{t("Products")}</h1>

      <div className="card p-5 mb-6">
        {isBoard ? (
          <div className="form-grid cols-3">
            {/* row 1 */}
            <div className="field"><label>{t("Type")} <R /></label>
              <select className="inp" value={f.type} onChange={(e) => handleType(e.target.value as "BOARD" | "HARDWARE")}>
                <option value="BOARD">{t("Board")}</option>
                <option value="HARDWARE">{t("Hardware")}</option>
              </select></div>
            <div className="field"><label>{t("Thickness")} <R /></label>
              <div className="flex items-center gap-2">
                <select className="inp flex-1" value={f.thicknessMm ?? ""} onChange={(e) => setF({ ...f, thicknessMm: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">— {t("Select")} —</option>
                  {THICKNESSES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <span className="text-sm font-semibold muted">MM</span>
              </div></div>
            <div className="field"><label>{t("Name")} <R /></label>
              <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            {/* row 2 */}
            <div className="field"><label>{t("Name (Bangla)")} <R /></label>
              <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
            <div className="field"><label>{t("Category")} <R /></label>
              <select className="inp" value={f.category ?? ""} onChange={(e) => setF({ ...f, category: e.target.value || undefined })}>
                <option value="">— {t("Select")} —</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            <div className="field"><label>{t("Color")}</label>
              <select className="inp" value={f.color ?? ""} onChange={(e) => setF({ ...f, color: e.target.value || undefined })}>
                <option value="">— {t("Select")} —</option>
                {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            {/* row 3 */}
            <div className="field"><label>{t("Unit")}</label>
              <input className="inp" value="PCS" disabled /></div>
            <div className="field"><label>{t("Supplier")} <R /></label>
              <select className="inp" value={f.supplierId ?? ""} onChange={(e) => setF({ ...f, supplierId: e.target.value || undefined })}>
                <option value="">— {t("Select")} —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="field"><label>{t("Price")} ({t("low")}) <R /></label>
              <input className="inp num" type="number" value={f.priceLower ?? ""}
                onChange={(e) => setF({ ...f, priceLower: e.target.value ? Number(e.target.value) : undefined })} /></div>
            {/* row 4 */}
            <div className="field"><label>{t("Price")} ({t("high")}) <R /></label>
              <input className="inp num" type="number" value={f.priceUpper ?? ""}
                onChange={(e) => setF({ ...f, priceUpper: e.target.value ? Number(e.target.value) : undefined })} /></div>
            <div className="field"><label>{t("Code")} (auto)</label>
              <input className="inp font-mono" value={f.sku ?? ""}
                onChange={(e) => { setManualSku(true); setF((prev) => ({ ...prev, sku: e.target.value })); }} /></div>
            <div className="field"><label>{t("Full Name")} (auto)</label>
              <input className="inp" value={f.fullName ?? ""}
                onChange={(e) => setF((prev) => ({ ...prev, fullName: e.target.value || undefined }))} /></div>
          </div>
        ) : (
          <div className="form-grid cols-3">
            {/* row 1 */}
            <div className="field"><label>{t("Type")} <R /></label>
              <select className="inp" value={f.type} onChange={(e) => handleType(e.target.value as "BOARD" | "HARDWARE")}>
                <option value="BOARD">{t("Board")}</option>
                <option value="HARDWARE">{t("Hardware")}</option>
              </select></div>
            <div className="field"><label>{t("Name")} <R /></label>
              <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label>{t("Name (Bangla)")} <R /></label>
              <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
            {/* row 2 */}
            <div className="field"><label>{t("Supplier")}</label>
              <select className="inp" value={f.supplierId ?? ""} onChange={(e) => setF({ ...f, supplierId: e.target.value || undefined })}>
                <option value="">— {t("None")} —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="field"><label>{t("Unit")} <R /></label>
              <select className="inp" value={f.unit ?? ""} onChange={(e) => setF({ ...f, unit: e.target.value || undefined })}>
                <option value="">— {t("Select")} —</option>
                {HW_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select></div>
            <div className="field"><label>{t("Price")} ({t("low")}) <R /></label>
              <input className="inp num" type="number" value={f.priceLower ?? ""}
                onChange={(e) => setF({ ...f, priceLower: e.target.value ? Number(e.target.value) : undefined })} /></div>
            {/* row 3 */}
            <div className="field"><label>{t("Price")} ({t("high")}) <R /></label>
              <input className="inp num" type="number" value={f.priceUpper ?? ""}
                onChange={(e) => setF({ ...f, priceUpper: e.target.value ? Number(e.target.value) : undefined })} /></div>
            <div className="field"><label>{t("Code")} (auto)</label>
              <input className="inp font-mono" value={f.sku ?? ""}
                onChange={(e) => { setManualSku(true); setF((prev) => ({ ...prev, sku: e.target.value })); }} /></div>
            <div className="field"><label>{t("Full Name")} (auto)</label>
              <input className="inp" value={f.fullName ?? ""}
                onChange={(e) => setF((prev) => ({ ...prev, fullName: e.target.value || undefined }))} /></div>
          </div>
        )}

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
          <thead><tr>
            <th>{t("Name")}</th><th>{t("Full Name")}</th><th>{t("Type")}</th>
            <th>{t("Category")}</th><th>{t("Color")}</th><th>{t("Supplier")}</th>
            <th className="text-right">{t("Thickness")}</th>
            <th>{t("Unit")}</th>
            <th className="text-right">{t("Price band")}</th>
            <th className="text-right">{t("Actions")}</th>
          </tr></thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td><div className="font-medium">{dn(p)}</div>
                  {p.sku && <div className="font-mono text-[11px] muted">{p.sku}</div>}</td>
                <td className="text-sm">{p.fullName ?? "—"}</td>
                <td className="text-xs">{p.type === "BOARD" ? t("Board") : t("Hardware")}</td>
                <td className="muted text-sm">{p.category ?? "—"}</td>
                <td className="muted text-sm">{p.color ?? "—"}</td>
                <td className="muted text-sm">{suppliers.find((s) => s.id === p.supplierId)?.name ?? "—"}</td>
                <td className="num">{p.thicknessMm ?? "—"}</td>
                <td className="text-sm muted">{p.unit ?? "—"}</td>
                <td className="num">{p.priceLower ?? "—"}–{p.priceUpper ?? "—"}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn-icon btn-icon-edit mr-1" title="Edit" onClick={() => edit(p)}><EditIcon /></button>
                  <button className="btn-icon btn-icon-del" title="Delete" onClick={() => remove(p.id)}><TrashIcon /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
