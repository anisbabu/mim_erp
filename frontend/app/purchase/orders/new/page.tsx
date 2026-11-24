"use client";
import { useEffect, useMemo, useState } from "react";
import { endpoints, type Product, type Supplier } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { productKeywords } from "@/lib/productSearch";
import { TrashIcon } from "@/components/Icons";
import DateInput from "@/components/DateInput";
import { today } from "@/lib/fmt";
import TopMessage from "@/components/TopMessage";
import { useStepCheck, type Problem } from "@/lib/useStepCheck";

type Line = { productId: string; qty: string; unitPrice: string; free: boolean };

export default function NewPoPage() {
  const { t, dn } = useI18n();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts]   = useState<Product[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote]   = useState("");
  const [poNo, setPoNo]   = useState("");
  const [orderDate, setOrderDate] = useState(today());   // purchase date; earlier dates allowed, not future
  const [lines, setLines] = useState<Line[]>([{ productId: "", qty: "", unitPrice: "", free: false }]);
  const [msg, setMsg]     = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy]   = useState(false);

  useEffect(() => {
    endpoints.suppliers().then(setSuppliers).catch(() => {});
    endpoints.products().then(setProducts).catch(() => {});
  }, []);

  const productById  = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const supplierOpts: Option[] = useMemo(
    () => suppliers.map((s) => ({ value: s.id, label: dn(s), sublabel: s.code })), [suppliers, dn]);
  const supplierById = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers]);
  const productOpts: Option[] = useMemo(
    () => products
      .filter((p) => !supplierId || p.supplierId === supplierId)
      .map((p) => ({
        value: p.id, label: p.fullName || (dn(p) + (p.thicknessMm ? ` (${p.thicknessMm}mm)` : "")), sublabel: p.sku,
        keywords: productKeywords(p, p.supplierId ? supplierById[p.supplierId] : undefined),
      })),
    [products, dn, supplierId, supplierById]);

  const update     = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine    = () => setLines((ls) => [...ls, { productId: "", qty: "", unitPrice: "", free: false }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  const totalQty   = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const totalValue = lines.reduce((s, l) => s + (l.free ? 0 : (Number(l.qty) * Number(l.unitPrice) || 0)), 0);

  /**
   * First thing missing, in the order of the form: supplier, purchase date, then line by line
   * product -> qty -> unit price. A line left completely empty is skipped (unless it is the only one).
   */
  const problem = useMemo((): Problem => {
    if (!supplierId) return { key: "supplier", text: t("Select a supplier.") };
    if (!orderDate) return { key: "date", text: t("Enter the purchase date.") };
    if (orderDate > today()) return { key: "date", text: t("The purchase date can't be in the future") };
    const used = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.productId || l.qty || l.unitPrice);
    const check = used.length ? used : [{ l: lines[0], i: 0 }];
    for (const { l, i } of check) {
      const row = check.length > 1 || lines.length > 1 ? ` (${t("line")} ${i + 1})` : "";
      if (!l.productId) return { key: `product-${i}`, text: t("Select a product.") + row };
      if (!(Number(l.qty) > 0)) return { key: `qty-${i}`, text: t("Enter the quantity.") + row };
      if (!l.free && !(Number(l.unitPrice) > 0)) return { key: `price-${i}`, text: t("Enter the unit price (or tick Free).") + row };
    }
    return null;
  }, [supplierId, orderDate, lines, t]);

  const check = useStepCheck(problem);
  const bad = check.bad;

  async function submit() {
    setMsg(null);
    if (check.stop()) return;

    const payload = {
      supplierId, note,
      manualPoNo: poNo.trim() || undefined,
      orderDate: orderDate || undefined,
      lines: lines.filter((l) => l.productId && Number(l.qty) > 0).map((l) => ({
        productId: l.productId, qty: Number(l.qty),
        unitPrice: l.free ? 0 : Number(l.unitPrice), freeProduct: l.free,
      })),
    };
    setBusy(true);
    try {
      const po: any = await endpoints.createPo(payload);
      setMsg({ kind: "ok", text: `${t("New purchase order")} ${po.poNo} ✓` });
      setLines([{ productId: "", qty: "", unitPrice: "", free: false }]); setNote(""); setPoNo(""); check.reset();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="page-title mb-5">{t("New purchase order")}</h1>

      <div className="form-grid cols-4 mb-5">
        <div className="field"><label>{t("PO no")}</label>
          <input className="inp" value={poNo} onChange={(e) => setPoNo(e.target.value)}
            placeholder={t("Manual / Auto-generated")} /></div>
        <div className="field"><label>{t("Purchase date")} <span className="req">*</span></label>
          <DateInput className={`inp ${bad("date")}`} max={today()} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
        <div className={`field ${bad("supplier")}`}><label>{t("Supplier")} <span className="req">*</span></label>
          <SearchSelect options={supplierOpts} value={supplierId}
            onChange={(v) => {
              setSupplierId(v);
              setLines((ls) => ls.map((l) => (l.productId && productById[l.productId]?.supplierId !== v)
                ? { ...l, productId: "" } : l));
            }} placeholder={t("Search…")} /></div>
        <div className="field"><label>{t("Note")}</label>
          <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional note" /></div>
      </div>

      <div className="card table-wrap mb-4">
        <table className="tbl">
          <thead><tr>
            <th style={{ minWidth: 220 }}>{t("Product")}</th>
            <th>{t("Free")}</th>
            <th>{t("Qty")}</th>
            <th>{t("Unit price")}</th>
            <th>{t("Line total")}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {lines.map((l, i) => {
              return (
                <tr key={i}>
                  <td className="align-top">
                    <div className={bad(`product-${i}`)}>
                      <SearchSelect options={productOpts} value={l.productId}
                        onChange={(v) => update(i, { productId: v })} placeholder={t("Search…")} /></div>
                    <div className="h-4 mt-1" />
                  </td>
                  <td className="text-center align-top pt-2">
                    <input type="checkbox" checked={l.free}
                      onChange={(e) => update(i, { free: e.target.checked, unitPrice: e.target.checked ? "" : l.unitPrice })} />
                    <div className="h-4 mt-1" />
                  </td>
                  <td className="text-right align-top">
                    <input className={`inp num ${bad(`qty-${i}`)}`} style={{ width: 80, marginLeft: "auto" }} type="number" min={0}
                      value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} />
                    <div className="h-4 mt-1" />
                  </td>
                  <td className="text-right align-top">
                    <input className={`inp num ${bad(`price-${i}`)}`} style={{ width: 100, marginLeft: "auto" }}
                      type="number" min={0}
                      value={l.free ? "" : l.unitPrice} disabled={l.free}
                      onChange={(e) => update(i, { unitPrice: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && i === lines.length - 1 && addLine()}
                      placeholder={l.free ? t("Free") : ""} />
                    <div className="h-4 mt-1" />
                  </td>
                  <td className="num align-top">
                    {l.free
                      ? <span className="muted text-sm">{t("Free")}</span>
                      : (Number(l.qty) * Number(l.unitPrice) || 0).toFixed(2)}
                    <div className="h-4 mt-1" />
                  </td>
                  <td className="text-right align-top pt-2">
                    {lines.length > 1 && (
                      <button className="btn-icon btn-icon-del" title="Remove" onClick={() => removeLine(i)}><TrashIcon /></button>
                    )}
                    <div className="h-4 mt-1" />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="text-right font-medium">{t("Total")}</td>
              <td className="num font-medium">{totalQty}</td>
              <td></td>
              <td className="num font-medium">{totalValue.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        <div className="px-4 py-3 border-t border-line flex justify-end">
          <button className="btn-ghost btn-sm" onClick={addLine}>+ {t("Add")}</button>
        </div>
      </div>

      <button className="btn" onClick={submit} disabled={busy}>{busy ? "…" : t("Save")}</button>
      <TopMessage msg={check.msg ?? msg} />
    </div>
  );
}