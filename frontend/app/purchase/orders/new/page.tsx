"use client";
import { useEffect, useMemo, useState } from "react";
import { endpoints, type Product, type Supplier } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import SearchSelect, { type Option } from "@/components/SearchSelect";

type Line = { productId: string; qty: string; unitPrice: string; free: boolean };

export default function NewPoPage() {
  const { t, dn } = useI18n();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");
  const [poNo, setPoNo] = useState("");                 // manual PO number — blank = auto
  const [lines, setLines] = useState<Line[]>([{ productId: "", qty: "", unitPrice: "", free: false }]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.suppliers().then(setSuppliers).catch(() => {});
    endpoints.products().then(setProducts).catch(() => {});
  }, []);

  const supplierOpts: Option[] = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: dn(s), sublabel: s.code })), [suppliers, dn]);
  const productOpts: Option[] = useMemo(
    () => products.map((p) => ({ value: p.id, label: dn(p) + (p.thicknessMm ? ` (${p.thicknessMm}mm)` : ""), sublabel: p.sku })), [products, dn]);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { productId: "", qty: "", unitPrice: "", free: false }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const totalValue = lines.reduce((s, l) => s + (l.free ? 0 : (Number(l.qty) * Number(l.unitPrice) || 0)), 0);

  async function submit() {
    setMsg(null);
    if (!supplierId) { setMsg({ kind: "err", text: "Select a supplier." }); return; }
    const payload = {
      supplierId, note,
      manualPoNo: poNo.trim() || undefined,
      lines: lines.filter((l) => l.productId && Number(l.qty) > 0).map((l) => ({
        productId: l.productId, qty: Number(l.qty),
        unitPrice: l.free ? 0 : Number(l.unitPrice), freeProduct: l.free,
      })),
    };
    if (payload.lines.length === 0) { setMsg({ kind: "err", text: "Add at least one line with quantity." }); return; }
    setBusy(true);
    try {
      const po: any = await endpoints.createPo(payload);
      setMsg({ kind: "ok", text: `${t("New purchase order")} ${po.poNo} ✓` });
      setLines([{ productId: "", qty: "", unitPrice: "", free: false }]); setNote(""); setPoNo("");
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="text-2xl font-medium mb-5">{t("New purchase order")}</h1>

      <div className="form-grid cols-3 mb-5">
        <div className="field"><label>{t("PO no")}</label>
          <input className="inp" value={poNo} onChange={(e) => setPoNo(e.target.value)}
            placeholder={t("Auto-generated")} /></div>
        <div className="field"><label>{t("Supplier")}</label>
          <SearchSelect options={supplierOpts} value={supplierId} onChange={setSupplierId} placeholder={t("Search…")} /></div>
        <div className="field"><label>{t("Address")}</label>
          <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" /></div>
      </div>

      <div className="card table-wrap mb-4">
        <table className="tbl">
          <thead><tr>
            <th style={{ minWidth: 220 }}>{t("Product")}</th>
            <th className="text-center">{t("Free")}</th>
            <th className="text-right">{t("Qty")}</th>
            <th className="text-right">{t("Unit price")}</th>
            <th className="text-right">{t("Line total")}</th><th></th>
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><SearchSelect options={productOpts} value={l.productId}
                  onChange={(v) => update(i, { productId: v })} placeholder={t("Search…")} /></td>
                <td className="text-center">
                  <input type="checkbox" checked={l.free}
                    onChange={(e) => update(i, { free: e.target.checked, unitPrice: e.target.checked ? "" : l.unitPrice })} /></td>
                <td className="text-right">
                  <input className="inp num" style={{ width: 80, marginLeft: "auto" }} type="number" min={0}
                    value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} /></td>
                <td className="text-right">
                  <input className="inp num" style={{ width: 100, marginLeft: "auto" }} type="number" min={0}
                    value={l.free ? "" : l.unitPrice} disabled={l.free}
                    onChange={(e) => update(i, { unitPrice: e.target.value })}
                    placeholder={l.free ? t("Free") : ""} /></td>
                <td className="num">{l.free ? t("Free") : (Number(l.qty) * Number(l.unitPrice) || 0).toFixed(2)}</td>
                <td className="text-right">
                  {lines.length > 1 && <button className="text-[#b3261e] text-sm" onClick={() => removeLine(i)}>×</button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="text-right font-medium">{t("Total")}</td>
              <td className="num font-medium">{totalQty}</td>
              <td></td>
              <td className="num font-medium">{totalValue.toFixed(2)}</td><td></td>
            </tr>
          </tfoot>
        </table>
        <div className="px-4 py-3 border-t border-line"><button className="btn-ghost btn-sm" onClick={addLine}>+ {t("Add")}</button></div>
      </div>

      <button className="btn" onClick={submit} disabled={busy}>{busy ? "…" : t("Save")}</button>
      {msg && <div className={`note mt-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}
    </div>
  );
}
