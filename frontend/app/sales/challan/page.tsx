"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, type Product, type Warehouse, type Shop, type Customer, type WarehouseStock } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { TrashIcon } from "@/components/Icons";

type Line = { productId: string; warehouseId: string; qty: string; unitPrice: string };

export default function ChallanPage() {
  const { activeShopId } = useAuth();
  const [products, setProducts]     = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shops, setShops]           = useState<Shop[]>([]);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [customerId, setCustomerId]     = useState("");
  const [localShopId, setLocalShopId]   = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", warehouseId: "", qty: "", unitPrice: "" }]);
  const [msg, setMsg]   = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [stockPanel, setStockPanel]       = useState<WarehouseStock[]>([]);
  const [panelProductId, setPanelProductId] = useState("");

  useEffect(() => {
    endpoints.products().then(setProducts).catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
    endpoints.shops().then(setShops).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
  }, []);

  const warehouseById = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  const productById   = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const productOpts: Option[] = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.fullName || p.name, sublabel: p.sku })),
    [products]);

  async function selectProduct(i: number, productId: string) {
    update(i, { productId });
    if (!productId) return;
    setPanelProductId(productId);
    try { setStockPanel(await endpoints.availability(productId)); }
    catch { setStockPanel([]); }
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
    if (!shopId)      { setMsg({ kind: "err", text: "Select a shop." }); return; }
    if (!customerId)  { setMsg({ kind: "err", text: "Select a customer." }); return; }
    const allocations = lines
      .filter((l) => l.productId && l.warehouseId && Number(l.qty) > 0)
      .map((l) => ({ productId: l.productId, warehouseId: l.warehouseId, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountAmt: 0 }));
    if (!allocations.length) { setMsg({ kind: "err", text: "Add at least one line with product, warehouse and quantity." }); return; }
    setBusy(true);
    try {
      const dc: any = await endpoints.issueChallan({
        shopId, customerId, warehouseId: allocations[0].warehouseId, allocations,
        priceOverrideBy: null, discountBy: null,
      });
      setMsg({ kind: "ok", text: `Challan ${dc.dcNo} issued.` });
      setLines([{ productId: "", qty: "", unitPrice: "" }]);
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {/* Header row: title + stock panel */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <h1 className="page-title">Challan</h1>
        {panelProductId && (
          <div className="card overflow-hidden" style={{ minWidth: 200 }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#0f766e" }}>
                  <th className="text-left text-xs font-semibold px-3 py-2 text-white">Warehouse</th>
                  <th className="text-right text-xs font-semibold px-3 py-2 text-white">Qty</th>
                </tr>
              </thead>
              <tbody>
                {stockPanel.length === 0 && (
                  <tr><td colSpan={2} className="muted text-xs px-3 py-2">No stock</td></tr>
                )}
                {stockPanel.map((s, idx) => (
                  <tr key={s.warehouseId} style={{ background: idx % 2 === 0 ? "var(--surface)" : "var(--bg)" }}>
                    <td className="px-3 py-1.5 text-sm">{warehouseById[s.warehouseId]?.name ?? s.warehouseId}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-sm"
                        style={{ color: s.qty === 0 ? "#b4690e" : "#0f766e" }}>{s.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Header fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        {!activeShopId && (
          <div className="field">
            <label>Shop</label>
            <select className="inp inp-shop mt-1" value={localShopId} onChange={(e) => setLocalShopId(e.target.value)}>
              <option value="">Select shop…</option>
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label>Customer</label>
          <select className="inp mt-1" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
          </select>
        </div>
      </div>

      {/* Lines — table on md+, cards on mobile */}
      <div className="card overflow-hidden mb-4">

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ width: 150 }}>Warehouse</th>
                <th className="text-right" style={{ width: 100 }}>Qty</th>
                <th className="text-right" style={{ width: 130 }}>Unit price</th>
                <th className="text-right" style={{ width: 130 }}>Gross total</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = productById[l.productId];
                const band = bandStatus(l);
                const hasBand = p && (p.priceLower != null || p.priceUpper != null);
                const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
                return (
                  <tr key={i}>
                    <td className="align-top">
                      <SearchSelect options={productOpts} value={l.productId}
                        onChange={(v) => selectProduct(i, v)} placeholder="Search product…" />
                      <div className="text-[11px] mt-1 h-4 leading-4"
                        style={{ color: band === "out" ? "#b3261e" : "var(--muted)" }}>
                        {hasBand
                          ? `band ${p.priceLower ?? "—"}–${p.priceUpper ?? "—"}${band === "out" ? " · out of band" : ""}`
                          : (p ? "no band set" : "")}
                      </div>
                    </td>
                    <td className="align-top">
                      <select className="inp" value={l.warehouseId} onChange={(e) => update(i, { warehouseId: e.target.value })}>
                        <option value="">Select…</option>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      <div className="h-4 mt-1" />
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
                        <button className="btn-icon btn-icon-del" title="Remove" onClick={() => removeLine(i)}>
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
            return (
              <div key={i} className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs muted font-medium">Product</span>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} title="Remove"
                      className="text-[#9a2b22] hover:text-[#7a1c16] transition-colors">
                      <TrashIcon />
                    </button>
                  )}
                </div>
                <SearchSelect options={productOpts} value={l.productId}
                  onChange={(v) => selectProduct(i, v)} placeholder="Search product…" />
                <div className="text-[11px] -mt-1" style={{ color: band === "out" ? "#b3261e" : "var(--muted)" }}>
                  {hasBand
                    ? `band ${p.priceLower ?? "—"}–${p.priceUpper ?? "—"}${band === "out" ? " · out of band" : ""}`
                    : (p ? "no band set" : "")}
                </div>
                <div className="field">
                  <label className="text-xs muted block mb-1">Warehouse</label>
                  <select className="inp" value={l.warehouseId} onChange={(e) => update(i, { warehouseId: e.target.value })}>
                    <option value="">Select…</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs muted block mb-1">Qty</label>
                    <input className="inp text-right tabular-nums w-full" type="number" min={0}
                      value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs block mb-1" style={{ color: band === "out" ? "#b3261e" : "var(--muted)" }}>
                      Unit price {band === "out" ? "✕" : ""}
                    </label>
                    <input className="inp text-right tabular-nums w-full" type="number" min={0}
                      style={{ borderColor: band === "out" ? "#b3261e" : undefined }}
                      value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && i === lines.length - 1 && addLine()} />
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">Total</label>
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
          <button className="btn-ghost" onClick={addLine}>+ Add line</button>
        </div>
      </div>

      {grandGross > 0 && (
        <div className="mb-4 flex justify-end">
          <div className="flex items-center gap-6">
            <span className="text-sm muted font-semibold">Total</span>
            <span className="tabular-nums font-semibold text-lg">{grandGross.toFixed(2)}</span>
          </div>
        </div>
      )}

      <button className="btn w-full sm:w-auto" onClick={submit} disabled={busy}>
        {busy ? "Issuing…" : "Issue challan"}
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