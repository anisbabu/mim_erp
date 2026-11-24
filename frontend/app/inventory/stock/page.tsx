"use client";
import { today } from "@/lib/fmt";
import DateInput from "@/components/DateInput";
import PageHeader from "@/components/PageHeader";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { productKeywords } from "@/lib/productSearch";
import { useEffect, useState, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { endpoints, type DetailStockRow, type StockStatusRow, type StockSummaryRow, type PdfTable,
  type Product, type Warehouse, type Supplier } from "@/lib/api";

const PAGE_SIZE = 20;
type View = "all" | "product" | "warehouse" | "supplier" | "summary";

const monthStart = () => today().slice(0, 8) + "01";
const qtyText = (n: number) => String(Number(n.toFixed(3)));
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type ProductRow   = { productId: string; onHand: number; committed: number | null; available: number | null; onOrder: number | null; value: number };
type WarehouseRow = { warehouseId: string; qty: number; value: number };
type SupplierRow  = { supplierId: string | null; productId: string; qty: number; value: number };

export default function StockPage() {
  const { t, lang, dn } = useI18n();
  const [detail, setDetail]         = useState<DetailStockRow[]>([]);
  const [statusRows, setStatusRows] = useState<StockStatusRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<StockSummaryRow[]>([]);
  const [sumFrom, setSumFrom]     = useState(monthStart());
  const [sumTo, setSumTo]         = useState(today());
  const [sumErr, setSumErr]       = useState<string | null>(null);
  const [products, setProducts]   = useState<Record<string, Product>>({});
  const [warehouses, setWarehouses] = useState<Record<string, Warehouse>>({});
  const [suppliers, setSuppliers] = useState<Record<string, Supplier>>({});
  const [view, setView]           = useState<View>("all");
  // filters: pick any one, two or all three; they combine (AND)
  const [fProduct, setFProduct]   = useState("");
  const [fSupplier, setFSupplier] = useState("");
  const [fWarehouse, setFWarehouse] = useState("");
  const [search, setSearch]       = useState("");
  const [page, setPage]           = useState(1);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    endpoints.stockDetail().then(setDetail).catch(() => {});
    endpoints.stockStatus().then(setStatusRows).catch(() => {});
    endpoints.products().then((p) => setProducts(Object.fromEntries(p.map((x) => [x.id, x])))).catch(() => {});
    endpoints.warehouses().then((w) => setWarehouses(Object.fromEntries(w.map((x) => [x.id, x])))).catch(() => {});
    endpoints.suppliers().then((s) => setSuppliers(Object.fromEntries(s.map((x) => [x.id, x])))).catch(() => {});
  }, []);

  useEffect(() => { setPage(1); setSearch(""); }, [view]);
  useEffect(() => { setPage(1); }, [search, fProduct, fSupplier, fWarehouse]);

  useEffect(() => {
    if (view !== "summary") return;
    setSumErr(null);
    endpoints.stockSummary(sumFrom, sumTo, fWarehouse || undefined)
      .then(setSummaryRows)
      .catch((e) => setSumErr(e.message));
  }, [view, sumFrom, sumTo, fWarehouse]);

  const pName = (id: string) => {
    const p = products[id];
    if (!p) return id;
    return lang === "bn" && p.nameBn ? p.nameBn : p.fullName ?? p.name;
  };
  const wName = (id: string) => (warehouses[id] ? dn(warehouses[id]) : id);
  const sName = (id: string | null) => (id ? (suppliers[id] ? dn(suppliers[id]) : id) : t("No supplier"));

  // ---- dropdown options: only what is in stock, narrowed by the other filters ----
  const inStock = (skip: "p" | "s" | "w") => detail.filter((r) =>
    (skip === "p" || !fProduct || r.productId === fProduct) &&
    (skip === "s" || !fSupplier || r.supplierId === fSupplier) &&
    (skip === "w" || !fWarehouse || r.warehouseId === fWarehouse));
  const productOpts: Option[] = useMemo(() => {
    const ids = Array.from(new Set(inStock("p").map((r) => r.productId)));
    return ids.map((id) => {
      const p = products[id];
      return { value: id, label: pName(id), sublabel: p?.sku,
        keywords: p ? productKeywords(p, p.supplierId ? suppliers[p.supplierId] : undefined) : undefined };
    }).sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, products, suppliers, fSupplier, fWarehouse, lang]);
  const supplierOpts: Option[] = useMemo(() => {
    const ids = Array.from(new Set(inStock("s").map((r) => r.supplierId).filter((x): x is string => !!x)));
    return ids.map((id) => ({ value: id, label: sName(id), sublabel: [suppliers[id]?.code, suppliers[id]?.mobile].filter(Boolean).join(" · "),
      keywords: [suppliers[id]?.name, suppliers[id]?.nameBn, suppliers[id]?.mobile].filter(Boolean).join(" ") }))
      .sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, suppliers, fProduct, fWarehouse, lang]);
  const warehouseOpts: Option[] = useMemo(() => {
    const ids = Array.from(new Set(inStock("w").map((r) => r.warehouseId)));
    return ids.map((id) => ({ value: id, label: wName(id), sublabel: warehouses[id]?.code }))
      .sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, warehouses, fProduct, fSupplier, lang]);

  // ---- the stock rows that match the filters (supplier + product + warehouse level) ----
  const picked = useMemo(() => detail.filter((r) =>
    (!fProduct || r.productId === fProduct) &&
    (!fSupplier || r.supplierId === fSupplier) &&
    (!fWarehouse || r.warehouseId === fWarehouse)), [detail, fProduct, fSupplier, fWarehouse]);

  // committed / on order are company-wide figures: shown only when no supplier/warehouse filter splits the stock
  const companyWide = !fSupplier && !fWarehouse;

  const byProduct: ProductRow[] = useMemo(() => {
    const m = new Map<string, { qty: number; value: number }>();
    for (const r of picked) {
      const e = m.get(r.productId) ?? { qty: 0, value: 0 };
      m.set(r.productId, { qty: e.qty + Number(r.qty), value: e.value + Number(r.value) });
    }
    if (companyWide) {
      // stock status also lists products with nothing on hand but committed / on order
      return statusRows.filter((s) => !fProduct || s.productId === fProduct).map((s) => ({
        productId: s.productId, onHand: Number(s.onHand), committed: Number(s.committed),
        available: Number(s.available), onOrder: Number(s.onOrder), value: Number(s.value) }));
    }
    return Array.from(m.entries()).map(([productId, v]) => ({
      productId, onHand: v.qty, committed: null, available: null, onOrder: null, value: v.value }));
  }, [picked, statusRows, companyWide, fProduct]);

  const byWarehouse: WarehouseRow[] = useMemo(() => {
    const m = new Map<string, { qty: number; value: number }>();
    for (const r of picked) {
      const e = m.get(r.warehouseId) ?? { qty: 0, value: 0 };
      m.set(r.warehouseId, { qty: e.qty + Number(r.qty), value: e.value + Number(r.value) });
    }
    return Array.from(m.entries()).map(([warehouseId, v]) => ({ warehouseId, ...v }));
  }, [picked]);

  const bySupplier: SupplierRow[] = useMemo(() => {
    const m = new Map<string, SupplierRow>();
    for (const r of picked) {
      const k = (r.supplierId ?? "") + "|" + r.productId;
      const e = m.get(k) ?? { supplierId: r.supplierId, productId: r.productId, qty: 0, value: 0 };
      e.qty += Number(r.qty); e.value += Number(r.value);
      m.set(k, e);
    }
    return Array.from(m.values());
  }, [picked]);

  const summaryPicked = useMemo(() => summaryRows.filter((r) =>
    (!fProduct || r.productId === fProduct) &&
    (!fSupplier || products[r.productId]?.supplierId === fSupplier)), [summaryRows, fProduct, fSupplier, products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const has = (...xs: string[]) => !q || xs.some((x) => x.toLowerCase().includes(q));
    const byName = <T,>(rows: T[], key: (r: T) => string) =>
      rows.slice().sort((a, b) => key(a).localeCompare(key(b)));
    if (view === "all")
      return byName(picked.filter((r) => has(pName(r.productId), wName(r.warehouseId), sName(r.supplierId))),
        (r) => pName(r.productId) + wName(r.warehouseId));
    if (view === "product")   return byName(byProduct.filter((r) => has(pName(r.productId))), (r) => pName(r.productId));
    if (view === "warehouse") return byName(byWarehouse.filter((r) => has(wName(r.warehouseId))), (r) => wName(r.warehouseId));
    if (view === "summary")
      return summaryPicked.filter((r) => has(pName(r.productId), r.productGroup ?? ""));
    return byName(bySupplier.filter((r) => has(sName(r.supplierId), pName(r.productId))),
      (r) => sName(r.supplierId) + pName(r.productId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, search, picked, byProduct, byWarehouse, bySupplier, summaryPicked, products, warehouses, suppliers, lang]);

  const totals = useMemo(() => {
    const s = { qty: 0, value: 0, openingValue: 0, inwardValue: 0, outwardValue: 0, closingValue: 0 };
    for (const r of filtered as any[]) {
      s.qty   += Number(r.qty ?? r.onHand ?? 0);
      s.value += Number(r.value ?? 0);
      s.openingValue += Number(r.openingValue ?? 0); s.inwardValue  += Number(r.inwardValue ?? 0);
      s.outwardValue += Number(r.outwardValue ?? 0); s.closingValue += Number(r.closingValue ?? 0);
    }
    return s;
  }, [filtered]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const anyFilter  = !!(fProduct || fSupplier || fWarehouse || search.trim());
  const totalLabel = anyFilter ? t("Filtered total") : t("Total");

  // ---- PDF: the current tab, with the filters, every row (not just this page) ----
  function buildPdf(): PdfTable {
    const tabTitle: Record<View, string> = {
      all: t("Stock on hand"), product: t("Stock by product"), warehouse: t("Stock by warehouse"),
      supplier: t("Stock by supplier"), summary: t("Stock summary"),
    };
    const parts = [
      fProduct   && `${t("Product")}: ${pName(fProduct)}`,
      fSupplier  && `${t("Supplier")}: ${sName(fSupplier)}`,
      fWarehouse && `${t("Warehouse")}: ${wName(fWarehouse)}`,
      search.trim() && `${t("Search")}: "${search.trim()}"`,
      view === "summary" && `${sumFrom} → ${sumTo}`,
    ].filter(Boolean) as string[];
    const L = (label: string, weight?: number) => ({ label, align: "L" as const, weight });
    const R = (label: string, weight?: number) => ({ label, align: "R" as const, weight });
    const base = { title: tabTitle[view].toUpperCase(), subtitle: parts.join("  ·  ") };
    const blank = (n: number | null) => (n ? qtyText(n) : "");

    if (view === "all") return { ...base,
      columns: [L(t("Product"), 5), L(t("Supplier"), 3.2), L(t("Warehouse"), 2.4), R(t("Qty"), 1.3), R(t("Value (cost)"), 2)],
      rows: (filtered as DetailStockRow[]).map((r) => [pName(r.productId), sName(r.supplierId), wName(r.warehouseId),
        qtyText(Number(r.qty)), money(Number(r.value))]),
      total: ["", "", totalLabel, qtyText(totals.qty), money(totals.value)] };
    if (view === "product") return { ...base,
      columns: companyWide
        ? [L(t("Product"), 5), R(t("On hand")), R(t("Committed")), R(t("Available")), R(t("On order")), R(t("Value (cost)"), 2)]
        : [L(t("Product"), 6), R(t("On hand"), 1.5), R(t("Value (cost)"), 2)],
      rows: (filtered as ProductRow[]).map((r) => companyWide
        ? [pName(r.productId), qtyText(r.onHand), blank(r.committed), qtyText(r.available ?? 0), blank(r.onOrder), money(r.value)]
        : [pName(r.productId), qtyText(r.onHand), money(r.value)]),
      total: companyWide ? [totalLabel, qtyText(totals.qty), "", "", "", money(totals.value)]
                         : [totalLabel, qtyText(totals.qty), money(totals.value)] };
    if (view === "warehouse") return { ...base,
      columns: [L(t("Warehouse"), 5), R(t("Total Qty"), 2), R(t("Total Value (cost)"), 2.5)],
      rows: (filtered as WarehouseRow[]).map((r) => [wName(r.warehouseId), qtyText(r.qty), money(r.value)]),
      total: [totalLabel, qtyText(totals.qty), money(totals.value)] };
    if (view === "supplier") return { ...base,
      columns: [L(t("Supplier"), 3.5), L(t("Product"), 5), R(t("Qty"), 1.3), R(t("Value (cost)"), 2)],
      rows: (filtered as SupplierRow[]).map((r) => [sName(r.supplierId), pName(r.productId), qtyText(r.qty), money(r.value)]),
      total: ["", totalLabel, qtyText(totals.qty), money(totals.value)] };
    return { ...base,
      columns: [L(t("Product"), 4.5), L(t("Group"), 2),
        R(t("Opening") + " " + t("Qty")), R(t("Opening") + " " + t("Value"), 1.7),
        R(t("Inward") + " " + t("Qty")),  R(t("Inward") + " " + t("Value"), 1.7),
        R(t("Outward") + " " + t("Qty")), R(t("Outward") + " " + t("Value"), 1.7),
        R(t("Closing") + " " + t("Qty")), R(t("Closing") + " " + t("Value"), 1.7)],
      rows: (filtered as StockSummaryRow[]).map((r) => [pName(r.productId), r.productGroup ?? "",
        qtyText(Number(r.openingQty)), money(Number(r.openingValue)), qtyText(Number(r.inwardQty)), money(Number(r.inwardValue)),
        qtyText(Number(r.outwardQty)), money(Number(r.outwardValue)), qtyText(Number(r.closingQty)), money(Number(r.closingValue))]),
      total: [totalLabel, "", "", money(totals.openingValue), "", money(totals.inwardValue),
        "", money(totals.outwardValue), "", money(totals.closingValue)] };
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const blob = await endpoints.stockTablePdf(buildPdf(), lang);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stock-${view}-${today()}${lang === "bn" ? "-bn" : ""}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setSumErr(e.message); }
    finally { setDownloading(false); }
  }

  const tabs: { key: View; label: string }[] = [
    { key: "all",       label: t("All") },
    { key: "product",   label: t("By Product") },
    { key: "warehouse", label: t("By Warehouse") },
    { key: "supplier",  label: t("By Supplier") },
    { key: "summary",   label: t("Summary") },
  ];

  const filterBox = (label: string, opts: Option[], value: string, set: (v: string) => void) => (
    <div className="field min-w-[220px] flex-1">
      <label>{label}</label>
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0"><SearchSelect options={opts} value={value} onChange={set} placeholder={t("All")} /></div>
        {value && <button className="btn-ghost btn-sm" title={t("Clear")} onClick={() => set("")}>×</button>}
      </div>
    </div>
  );

  const empty = (cols: number) => pageItems.length === 0 && (
    <tr><td colSpan={cols} className="text-center" style={{ color: "var(--muted)" }}>
      {view === "summary" ? t("No stock movements in this period.") : anyFilter ? t("No matching stock.") : t("No stock yet.")}
    </td></tr>);

  return (
    <div>
      <PageHeader crumbs={["Inventory"]} title={t("Stock on hand")}
        subtitle={t("Live quantity and FIFO value per product and warehouse.")}
        actions={<button className="btn btn-print" onClick={downloadPdf} disabled={downloading || filtered.length === 0}>
          {downloading ? t("Generating…") : t("Download PDF")}</button>} />

      {/* filters: any one, or any combination */}
      <div className="card p-3 mb-3">
        <div className="flex flex-wrap items-end gap-3">
          {filterBox(t("Product"), productOpts, fProduct, setFProduct)}
          {filterBox(t("Supplier"), supplierOpts, fSupplier, setFSupplier)}
          {filterBox(t("Warehouse"), warehouseOpts, fWarehouse, setFWarehouse)}
          {view === "summary" && <>
            <div className="field"><label>{t("From")}</label>
              <DateInput className="inp" value={sumFrom} onChange={(e) => setSumFrom(e.target.value)} /></div>
            <div className="field"><label>{t("To")}</label>
              <DateInput className="inp" value={sumTo} onChange={(e) => setSumTo(e.target.value)} /></div>
          </>}
          {(fProduct || fSupplier || fWarehouse) &&
            <button className="btn-ghost btn-sm mb-0.5" onClick={() => { setFProduct(""); setFSupplier(""); setFWarehouse(""); }}>
              {t("Clear filters")}</button>}
        </div>
        <div className="h-4 leading-4 text-[11px] mt-1" style={{ color: sumErr ? "var(--role-danger)" : "var(--muted)" }}>
          {sumErr ?? `${filtered.length} ${t("rows")} · ${t("Qty")} ${qtyText(totals.qty)} · ${t("Value (cost)")} ${money(view === "summary" ? totals.closingValue : totals.value)}`}
        </div>
      </div>

      {/* toolbar: tabs + quick search */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tb) => (
            <button key={tb.key} onClick={() => setView(tb.key)}
              className={`filter-btn ${({ all: "tone-all", product: "tone-info", warehouse: "tone-teal", supplier: "tone-warn", summary: "tone-ok" } as const)[tb.key]}${view === tb.key ? " on" : ""}`}>{tb.label}</button>
          ))}
        </div>
        <input className="inp max-w-xs" placeholder={t("Search…")} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card table-wrap">
        {view === "all" && (
          <table className="tbl">
            <thead><tr><th>{t("Product")}</th><th>{t("Supplier")}</th><th>{t("Warehouse")}</th>
              <th className="num">{t("Qty")}</th><th className="num">{t("Value (cost)")}</th></tr></thead>
            <tbody>
              {empty(5)}
              {(pageItems as DetailStockRow[]).map((r, i) => (
                <tr key={i}>
                  <td>{pName(r.productId)}</td><td>{sName(r.supplierId)}</td><td>{wName(r.warehouseId)}</td>
                  <td className="num">{qtyText(Number(r.qty))}</td><td className="num">{money(Number(r.value))}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && <tfoot><tr>
              <td colSpan={3} className="text-right font-semibold">{totalLabel}</td>
              <td className="num font-semibold">{qtyText(totals.qty)}</td><td className="num font-semibold">{money(totals.value)}</td>
            </tr></tfoot>}
          </table>
        )}

        {view === "product" && (
          <table className="tbl">
            <thead><tr>
              <th>{t("Product")}</th>
              <th className="num">{t("On hand")}</th>
              {companyWide && <>
                <th className="num" title={t("Sold but not yet picked up by the customer")}>{t("Committed")}</th>
                <th className="num" title={t("On hand minus committed")}>{t("Available")}</th>
                <th className="num" title={t("Still due from suppliers on open purchase orders")}>{t("On order")}</th>
              </>}
              <th className="num">{t("Value (cost)")}</th>
            </tr></thead>
            <tbody>
              {empty(companyWide ? 6 : 3)}
              {(pageItems as ProductRow[]).map((r, i) => (
                <tr key={i}>
                  <td>{pName(r.productId)}</td>
                  <td className="num">{qtyText(r.onHand)}</td>
                  {companyWide && <>
                    <td className="num">{r.committed ? qtyText(r.committed) : ""}</td>
                    <td className="num" style={(r.available ?? 0) < 0 ? { color: "var(--role-danger)", fontWeight: 600 } : undefined}>
                      {qtyText(r.available ?? 0)}</td>
                    <td className="num">{r.onOrder ? qtyText(r.onOrder) : ""}</td>
                  </>}
                  <td className="num">{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && <tfoot><tr>
              <td className="text-right font-semibold">{totalLabel}</td>
              <td className="num font-semibold">{qtyText(totals.qty)}</td>
              {companyWide && <td colSpan={3} />}
              <td className="num font-semibold">{money(totals.value)}</td>
            </tr></tfoot>}
          </table>
        )}

        {view === "warehouse" && (
          <table className="tbl">
            <thead><tr><th>{t("Warehouse")}</th><th className="num">{t("Total Qty")}</th><th className="num">{t("Total Value (cost)")}</th></tr></thead>
            <tbody>
              {empty(3)}
              {(pageItems as WarehouseRow[]).map((r, i) => (
                <tr key={i}>
                  <td>{wName(r.warehouseId)}</td>
                  <td className="num">{qtyText(r.qty)}</td><td className="num">{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && <tfoot><tr>
              <td className="text-right font-semibold">{totalLabel}</td>
              <td className="num font-semibold">{qtyText(totals.qty)}</td><td className="num font-semibold">{money(totals.value)}</td>
            </tr></tfoot>}
          </table>
        )}

        {view === "supplier" && (
          <table className="tbl">
            <thead><tr><th>{t("Supplier")}</th><th>{t("Product")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Value (cost)")}</th></tr></thead>
            <tbody>
              {empty(4)}
              {(pageItems as SupplierRow[]).map((r, i) => (
                <tr key={i}>
                  <td>{sName(r.supplierId)}</td><td>{pName(r.productId)}</td>
                  <td className="num">{qtyText(r.qty)}</td><td className="num">{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && <tfoot><tr>
              <td colSpan={2} className="text-right font-semibold">{totalLabel}</td>
              <td className="num font-semibold">{qtyText(totals.qty)}</td><td className="num font-semibold">{money(totals.value)}</td>
            </tr></tfoot>}
          </table>
        )}

        {view === "summary" && (
          <table className="tbl">
            <thead>
              <tr>
                <th rowSpan={2}>{t("Product")}</th><th rowSpan={2}>{t("Group")}</th>
                <th colSpan={2} className="text-center">{t("Opening")}</th>
                <th colSpan={2} className="text-center">{t("Inward")}</th>
                <th colSpan={2} className="text-center">{t("Outward")}</th>
                <th colSpan={2} className="text-center">{t("Closing")}</th>
              </tr>
              <tr>
                {["Qty", "Value", "Qty", "Value", "Qty", "Value", "Qty", "Value"].map((h, i) =>
                  <th key={i} className="num">{t(h)}</th>)}
              </tr>
            </thead>
            <tbody>
              {empty(10)}
              {(pageItems as StockSummaryRow[]).map((r, i) => (
                <tr key={i}>
                  <td>{pName(r.productId)}</td>
                  <td>{r.productGroup ?? ""}</td>
                  <td className="num">{qtyText(Number(r.openingQty))}</td><td className="num">{money(Number(r.openingValue))}</td>
                  <td className="num">{qtyText(Number(r.inwardQty))}</td><td className="num">{money(Number(r.inwardValue))}</td>
                  <td className="num">{qtyText(Number(r.outwardQty))}</td><td className="num">{money(Number(r.outwardValue))}</td>
                  <td className="num">{qtyText(Number(r.closingQty))}</td><td className="num">{money(Number(r.closingValue))}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && <tfoot><tr>
              <td colSpan={2} className="text-right font-semibold">{totalLabel}</td>
              <td /><td className="num font-semibold">{money(totals.openingValue)}</td>
              <td /><td className="num font-semibold">{money(totals.inwardValue)}</td>
              <td /><td className="num font-semibold">{money(totals.outwardValue)}</td>
              <td /><td className="num font-semibold">{money(totals.closingValue)}</td>
            </tr></tfoot>}
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm" style={{ color: "var(--muted)" }}>
          <span>{filtered.length} {t("rows")} · {t("page")} {page} {t("of")} {totalPages}</span>
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>← {t("Prev")}</button>
            <button className="btn-ghost btn-sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>{t("Next")} →</button>
          </div>
        </div>
      )}
    </div>
  );
}
