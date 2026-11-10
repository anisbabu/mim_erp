"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, type Product, type Warehouse, type Shop, type Customer, type Supplier, type WarehouseStock, type UserView } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { TrashIcon } from "@/components/Icons";

type Line = { productId: string; warehouseId: string; qty: string; unitPrice: string };

export default function ChallanPage() {
  const { user, activeShopId } = useAuth();
  const { t, lang, dn } = useI18n();
  const [products, setProducts]     = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shops, setShops]           = useState<Shop[]>([]);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [suppliers, setSuppliers]   = useState<Supplier[]>([]);
  const [salespeople, setSalespeople] = useState<UserView[]>([]);
  const [customerId, setCustomerId]     = useState("");
  const [salespersonId, setSalespersonId] = useState("");
  const [localShopId, setLocalShopId]   = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", warehouseId: "", qty: "", unitPrice: "" }]);
  const [msg, setMsg]   = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [overrideBy, setOverrideBy] = useState("");
  const [stockPanel, setStockPanel]       = useState<WarehouseStock[]>([]);
  const [panelProductId, setPanelProductId] = useState("");
  const [panelLineIndex, setPanelLineIndex] = useState<number | null>(null);
  const [stockByProduct, setStockByProduct] = useState<Record<string, WarehouseStock[]>>({});

  useEffect(() => {
    endpoints.products().then(setProducts).catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
    endpoints.shops().then(setShops).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
    endpoints.suppliers().then(setSuppliers).catch(() => {});
    endpoints.users()
      .then((u) => setSalespeople(u.filter((x) => x.active && x.role === "SALESPERSON")))
      .catch(() => {});
  }, []);

  const warehouseById = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  const productById   = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const supplierById  = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers]);
  const productOpts: Option[] = useMemo(
    () => products.map((p) => {
      const supplierName = p.supplierId && supplierById[p.supplierId] ? dn(supplierById[p.supplierId]) : undefined;
      const thickness = p.thicknessLabel ?? (p.thicknessMm != null ? `${p.thicknessMm}mm` : undefined);
      const sub = [p.sku, supplierName, thickness].filter(Boolean).join(" · ");
      return { value: p.id, label: lang === "bn" && p.nameBn ? p.nameBn : p.fullName || p.name, sublabel: sub };
    }),
    [products, supplierById, lang]);
  const customerOpts: Option[] = useMemo(
    () => customers.map((c) => ({ value: c.id, label: `${dn(c)} (${t(c.type)})`, sublabel: c.mobile })),
    [customers, lang]);
  const needsSalesperson = user?.role !== "SALESPERSON";
  const salespersonOpts: Option[] = useMemo(
    () => salespeople.map((s) => ({ value: s.id, label: s.fullName || s.username })),
    [salespeople]);

  async function selectProduct(i: number, productId: string) {
    update(i, { productId, warehouseId: "" });
    if (!productId) return;
    setPanelProductId(productId);
    setPanelLineIndex(i);
    try {
      const s = await endpoints.availability(productId);
      setStockPanel(s);
      setStockByProduct((m) => ({ ...m, [productId]: s }));
      const stocked = s.filter((x) => x.qty > 0);
      if (stocked.length === 1) update(i, { warehouseId: stocked[0].warehouseId });
    } catch { setStockPanel([]); }
  }

  function pickWarehouseFromPanel(warehouseId: string) {
    if (panelLineIndex == null) return;
    update(panelLineIndex, { warehouseId });
  }

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine    = () => setLines((ls) => [...ls, { productId: "", warehouseId: "", qty: "", unitPrice: "" }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  function bandStatus(l: Line): "out" | "ok" | "none" {
    if (!l.productId || !l.unitPrice) return "none";
    const p = productById[l.productId];
    if (!p || (p.priceLower == null && p.priceUpper == null)) return "none";
    const price = Number(l.unitPrice);
    if (p.priceLower != null && price < p.priceLower) return "out";
    if (p.priceUpper != null && price > p.priceUpper) return "out";
    return "ok";
  }

  const grandGross = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);

  const shopId = activeShopId || localShopId;

  async function submit() {
    setMsg(null);
    if (!shopId)      { setMsg({ kind: "err", text: t("Select a shop.") }); return; }
    if (!customerId)  { setMsg({ kind: "err", text: t("Select a customer.") }); return; }
    if (needsSalesperson && !salespersonId) { setMsg({ kind: "err", text: t("Select a salesperson.") }); return; }
    const allocations = lines
      .filter((l) => l.productId && l.warehouseId && Number(l.qty) > 0)
      .map((l) => ({ productId: l.productId, warehouseId: l.warehouseId, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountAmt: 0 }));
    if (!allocations.length) { setMsg({ kind: "err", text: t("Add at least one line with product, warehouse and quantity.") }); return; }

    // A single delivery challan ships from one warehouse (DB constraint) — lines can
    // come from different warehouses, so split into one challan per warehouse.
    const byWarehouse = new Map<string, typeof allocations>();
    for (const a of allocations) {
      const g = byWarehouse.get(a.warehouseId) ?? [];
      g.push(a);
      byWarehouse.set(a.warehouseId, g);
    }

    setBusy(true);
    try {
      const dcNos: string[] = [];
      for (const [warehouseId, allocs] of byWarehouse) {
        const dc: any = await endpoints.issueChallan({
          shopId, customerId, salespersonId: needsSalesperson ? salespersonId : null, warehouseId, allocations: allocs,
          priceOverrideBy: overrideBy.trim() || "(not authorised)", discountBy: null,
        });
        dcNos.push(dc.dcNo);
      }
      setMsg({ kind: "ok", text: `${t(dcNos.length > 1 ? "Challans" : "Challan")} ${dcNos.join(", ")} ${t("issued.")}` });
      setLines([{ productId: "", warehouseId: "", qty: "", unitPrice: "" }]);
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {/* Header row: title + stock panel */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <h1 className="page-title">{t("Challan")}</h1>
        {panelProductId && (
          <div className="card overflow-hidden" style={{ minWidth: 200 }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--brand)" }}>
                  <th className="text-left text-xs font-semibold px-3 py-2 text-white">{t("Warehouse")}</th>
                  <th className="text-right text-xs font-semibold px-3 py-2 text-white">{t("Qty")}</th>
                </tr>
              </thead>
              <tbody>
                {stockPanel.length === 0 && (
                  <tr><td colSpan={2} className="muted text-xs px-3 py-2">{t("No stock")}</td></tr>
                )}
                {stockPanel.map((s, idx) => {
                  const selected = panelLineIndex != null && lines[panelLineIndex]?.warehouseId === s.warehouseId;
                  return (
                    <tr key={s.warehouseId}
                      onClick={() => s.qty > 0 && pickWarehouseFromPanel(s.warehouseId)}
                      style={{
                        background: selected ? "#d1fae5" : (idx % 2 === 0 ? "var(--surface)" : "var(--bg)"),
                        cursor: s.qty > 0 ? "pointer" : "default",
                      }}>
                      <td className="px-3 py-1.5 text-sm">{warehouseById[s.warehouseId] ? dn(warehouseById[s.warehouseId]) : s.warehouseId}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-sm"
                          style={{ color: s.qty === 0 ? "#b4690e" : "var(--brand)" }}>{s.qty}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Header fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        {!activeShopId && (
          <div className="field">
            <label>{t("Shop")}</label>
            <select className="inp inp-shop mt-1" value={localShopId} onChange={(e) => setLocalShopId(e.target.value)}>
              <option value="">{t("Select shop…")}</option>
              {shops.map((s) => <option key={s.id} value={s.id}>{dn(s)}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label>{t("Customer")}</label>
          <SearchSelect options={customerOpts} value={customerId}
            onChange={setCustomerId} placeholder={t("Search name or mobile…")} />
        </div>
        {needsSalesperson && (
          <div className="field">
            <label>{t("Salesperson")}</label>
            <SearchSelect options={salespersonOpts} value={salespersonId}
              onChange={setSalespersonId} placeholder={t("Search…")} />
          </div>
        )}
      </div>

      {/* Lines — table on md+, cards on mobile */}
      <div className="card overflow-hidden mb-4">

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>{t("Product")}</th>
                <th style={{ width: 150 }}>{t("Warehouse")}</th>
                <th className="text-right" style={{ width: 100 }}>{t("Qty")}</th>
                <th className="text-right" style={{ width: 130 }}>{t("Unit price")}</th>
                <th className="text-right" style={{ width: 130 }}>{t("Gross total")}</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = productById[l.productId];
                const band = bandStatus(l);
                const hasBand = p && (p.priceLower != null || p.priceUpper != null);
                const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
                const lineStock = l.productId ? stockByProduct[l.productId] : undefined;
                const qtyByWarehouse = Object.fromEntries((lineStock ?? []).map((s) => [s.warehouseId, s.qty]));
                const stockedWarehouses = lineStock ? warehouses.filter((w) => qtyByWarehouse[w.id] > 0) : warehouses;
                return (
                  <tr key={i}>
                    <td className="align-top">
                      <SearchSelect options={productOpts} value={l.productId}
                        onChange={(v) => selectProduct(i, v)} placeholder={t("Search name, code, supplier, mm…")} />
                      <div className="text-[11px] mt-1 h-4 leading-4"
                        style={{ color: band === "out" ? "#b3261e" : "var(--muted)" }}>
                        {hasBand
                          ? `${t("band")} ${p.priceLower ?? "—"}–${p.priceUpper ?? "—"}${band === "out" ? ` · ${t("out of band")}` : ""}`
                          : (p ? t("no band set") : "")}
                      </div>
                    </td>
                    <td className="align-top">
                      <select className="inp" value={l.warehouseId} onChange={(e) => update(i, { warehouseId: e.target.value })}>
                        <option value="">{t("Select…")}</option>
                        {stockedWarehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {dn(w)}{qtyByWarehouse[w.id] != null ? ` (${qtyByWarehouse[w.id]})` : ""}
                          </option>
                        ))}
                      </select>
                      <div className="text-[11px] mt-1 h-4 leading-4" style={{ color: "var(--muted)" }}>
                        {l.productId && lineStock && stockedWarehouses.length === 0 ? t("no stock") : ""}
                        {l.warehouseId && qtyByWarehouse[l.warehouseId] != null ? `${t("on hand")}: ${qtyByWarehouse[l.warehouseId]}` : ""}
                      </div>
                    </td>
                    <td className="text-right align-top">
                      <input className="inp text-right tabular-nums" style={{ width: 80, marginLeft: "auto" }}
                        type="number" min={0} value={l.qty}
                        onChange={(e) => update(i, { qty: e.target.value })} />
                      <div className="h-4 mt-1" />
                    </td>
                    <td className="text-right align-top">
                      <input className="inp text-right tabular-nums"
                        style={{ width: 100, marginLeft: "auto", borderColor: band === "out" ? "#b3261e" : undefined }}
                        type="number" min={0} value={l.unitPrice}
                        onChange={(e) => update(i, { unitPrice: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && i === lines.length - 1 && addLine()} />
                      <div className="text-[11px] mt-1 h-4 leading-4" style={{ color: "#b3261e" }}>
                        {band === "out" ? "✕" : ""}
                      </div>
                    </td>
                    <td className="text-right tabular-nums font-medium align-top">
                      {grossTotal > 0 ? grossTotal.toFixed(2) : ""}
                    </td>
                    <td className="text-right">
                      {lines.length > 1 && (
                        <button className="btn-icon btn-icon-del" title={t("Remove")} onClick={() => removeLine(i)}>
                          <TrashIcon />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-[var(--border)]">
          {lines.map((l, i) => {
            const p = productById[l.productId];
            const band = bandStatus(l);
            const hasBand = p && (p.priceLower != null || p.priceUpper != null);
            const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
            const lineStock = l.productId ? stockByProduct[l.productId] : undefined;
            const qtyByWarehouse = Object.fromEntries((lineStock ?? []).map((s) => [s.warehouseId, s.qty]));
            const stockedWarehouses = lineStock ? warehouses.filter((w) => qtyByWarehouse[w.id] > 0) : warehouses;
            return (
              <div key={i} className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs muted font-medium">{t("Product")}</span>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} title={t("Remove")}
                      className="text-[#9a2b22] hover:text-[#7a1c16] transition-colors">
                      <TrashIcon />
                    </button>
                  )}
                </div>
                <SearchSelect options={productOpts} value={l.productId}
                  onChange={(v) => selectProduct(i, v)} placeholder={t("Search name, code, supplier, mm…")} />
                <div className="text-[11px] -mt-1" style={{ color: band === "out" ? "#b3261e" : "var(--muted)" }}>
                  {hasBand
                    ? `${t("band")} ${p.priceLower ?? "—"}–${p.priceUpper ?? "—"}${band === "out" ? ` · ${t("out of band")}` : ""}`
                    : (p ? t("no band set") : "")}
                </div>
                <div className="field">
                  <label className="text-xs muted block mb-1">{t("Warehouse")}</label>
                  <select className="inp" value={l.warehouseId} onChange={(e) => update(i, { warehouseId: e.target.value })}>
                    <option value="">{t("Select…")}</option>
                    {stockedWarehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {dn(w)}{qtyByWarehouse[w.id] != null ? ` (${qtyByWarehouse[w.id]})` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
                    {l.productId && lineStock && stockedWarehouses.length === 0 ? t("no stock") : ""}
                    {l.warehouseId && qtyByWarehouse[l.warehouseId] != null ? `${t("on hand")}: ${qtyByWarehouse[l.warehouseId]}` : ""}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs muted block mb-1">{t("Qty")}</label>
                    <input className="inp text-right tabular-nums w-full" type="number" min={0}
                      value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs block mb-1" style={{ color: band === "out" ? "#b3261e" : "var(--muted)" }}>
                      {t("Unit price")} {band === "out" ? "✕" : ""}
                    </label>
                    <input className="inp text-right tabular-nums w-full" type="number" min={0}
                      style={{ borderColor: band === "out" ? "#b3261e" : undefined }}
                      value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && i === lines.length - 1 && addLine()} />
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">{t("Total")}</label>
                    <div className="inp text-right tabular-nums font-medium bg-transparent border-transparent">
                      {grossTotal > 0 ? grossTotal.toFixed(2) : "—"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 border-t border-[var(--border)]">
          <button className="btn-ghost" onClick={addLine}>+ {t("Add line")}</button>
        </div>
      </div>

      {grandGross > 0 && (
        <div className="mb-4 flex justify-end">
          <div className="flex items-center gap-6">
            <span className="text-sm muted font-semibold">{t("Total")}</span>
            <span className="tabular-nums font-semibold text-lg">{grandGross.toFixed(2)}</span>
          </div>
        </div>
      )}

      <div className="mb-4">
        <label className="text-xs muted">{t("Authoriser (required for out-of-band price or over-limit credit)")}</label>
        <input className="inp mt-1" style={{ maxWidth: 320 }}
          placeholder={t("Manager / authority name")}
          value={overrideBy} onChange={(e) => setOverrideBy(e.target.value)} />
      </div>

      <button className="btn w-full sm:w-auto" onClick={submit} disabled={busy}>
        {busy ? t("Issuing…") : t("Issue challan")}
      </button>

      {msg && (
        <div className="mt-4 text-sm rounded-lg px-4 py-3"
          style={{ background: msg.kind === "ok" ? "#e6efe9" : "#fbeceb",
                   color:      msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}