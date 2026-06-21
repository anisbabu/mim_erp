"use client";

import { useEffect, useMemo, useState } from "react";
import {
  endpoints, type Product, type Warehouse, type Shop, type Customer, type WarehouseStock, type UserView,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Line = { productId: string; qty: string; unitPrice: string; discountAmt: string };

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>
);

export default function NewSalePage() {
  const { activeShopId } = useAuth();
  const [products, setProducts]     = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shops, setShops]           = useState<Shop[]>([]);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [authorisers, setAuthorisers] = useState<UserView[]>([]);

  const [customerId, setCustomerId]     = useState("");
  const [warehouseId, setWarehouseId]   = useState("");
  const [localShopId, setLocalShopId]   = useState("");
  const [paymentMode, setPaymentMode]   = useState<"CASH" | "CREDIT">("CASH");
  const [lines, setLines] = useState<Line[]>([{ productId: "", qty: "", unitPrice: "", discountAmt: "" }]);
  const [overrideBy, setOverrideBy] = useState("");
  const [discountBy, setDiscountBy] = useState("");
  const [msg, setMsg]   = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [stockPanel, setStockPanel]         = useState<WarehouseStock[]>([]);
  const [panelProductId, setPanelProductId] = useState("");

  useEffect(() => {
    endpoints.products().then(setProducts).catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
    endpoints.shops().then(setShops).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
    endpoints.users()
      .then((u) => setAuthorisers(u.filter((x) => x.active && (x.role === "MANAGER" || x.role === "ADMIN"))))
      .catch(() => {});
  }, []);

  const productById   = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const warehouseById = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function selectProduct(i: number, productId: string) {
    update(i, { productId });
    if (!productId) return;
    setPanelProductId(productId);
    try { setStockPanel(await endpoints.availability(productId)); }
    catch { setStockPanel([]); }
  }

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  const addLine    = () => setLines((ls) => [...ls, { productId: "", qty: "", unitPrice: "", discountAmt: "" }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  function bandState(l: Line): "ok" | "out" | "none" {
    const p = productById[l.productId];
    const price = Number(l.unitPrice);
    if (!p || !l.unitPrice) return "none";
    if (p.priceLower != null && price < p.priceLower) return "out";
    if (p.priceUpper != null && price > p.priceUpper) return "out";
    return "ok";
  }

  const anyOutOfBand = lines.some((l) => bandState(l) === "out");
  const anyDiscount  = lines.some((l) => Number(l.discountAmt) > 0);
  const grandGross   = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
  const totalDiscount = lines.reduce((s, l) => s + (Number(l.discountAmt) || 0), 0);
  const netTotal      = grandGross - totalDiscount;

  function applyNetTotal(newNet: number) {
    if (grandGross <= 0) return;
    const newTotalDisc = Math.max(0, grandGross - newNet);
    setLines((ls) => {
      const grosses  = ls.map((l) => Number(l.qty) * Number(l.unitPrice));
      const sumGross = grosses.reduce((a, b) => a + b, 0);
      if (sumGross === 0) return ls;
      let assigned = 0;
      return ls.map((l, i) => {
        const isLast = i === ls.length - 1;
        const disc   = isLast
          ? Math.round((newTotalDisc - assigned) * 100) / 100
          : Math.round((newTotalDisc * grosses[i] / sumGross) * 100) / 100;
        if (!isLast) assigned += disc;
        return { ...l, discountAmt: disc > 0 ? String(disc) : "" };
      });
    });
  }

  const shopId = activeShopId || localShopId;

  async function submit() {
    setMsg(null);
    if (!shopId)      { setMsg({ kind: "err", text: "Select a shop." }); return; }
    if (!customerId)  { setMsg({ kind: "err", text: "Select a customer." }); return; }
    if (!warehouseId) { setMsg({ kind: "err", text: "Select a warehouse." }); return; }
    const allocations = lines
      .filter((l) => l.productId && Number(l.qty) > 0)
      .map((l) => ({
        productId: l.productId, warehouseId,
        qty: Number(l.qty), unitPrice: Number(l.unitPrice),
        discountAmt: Number(l.discountAmt) || 0,
      }));
    if (!allocations.length) { setMsg({ kind: "err", text: "Add at least one line with qty." }); return; }
    if (anyOutOfBand && !overrideBy.trim()) {
      setMsg({ kind: "err", text: "A price is out of band — enter the authoriser name to override." }); return;
    }
    if (anyDiscount && !discountBy.trim()) {
      setMsg({ kind: "err", text: "Discount requires an authoriser — enter their name." }); return;
    }
    setBusy(true);
    try {
      const res: any = await endpoints.createOrder({
        shopId, customerId, paymentMode, allocations,
        creditOverrideBy: overrideBy || null,
        priceOverrideBy:  anyOutOfBand ? overrideBy : null,
        discountBy:       anyDiscount  ? discountBy : null,
      });
      const margin = (res.totalValue - res.totalCost).toFixed(2);
      setMsg({ kind: "ok", text: `Sale ${res.soNo} created · ${res.challanIds.length} challan(s) · margin ${margin}` });
      if (panelProductId) {
        const s = await endpoints.availability(panelProductId);
        setStockPanel(s);
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally { setBusy(false); }
  }

  return (
    <div>
      {/* Header + stock panel */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <h1 className="text-2xl font-medium">New sale</h1>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {!activeShopId && (
          <div className="field">
            <label>Shop</label>
            <select className="inp" value={localShopId} onChange={(e) => setLocalShopId(e.target.value)}>
              <option value="">Select shop…</option>
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label>Customer</label>
          <select className="inp" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
          </select>
        </div>
        <div className="field">
          <label>Warehouse</label>
          <select className="inp" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Select warehouse…</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Payment</label>
          <select className="inp" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as "CASH" | "CREDIT")}>
            <option value="CASH">Cash</option>
            <option value="CREDIT">Credit (party)</option>
          </select>
        </div>
      </div>

      {/* Lines — table desktop, cards mobile */}
      <div className="card overflow-hidden mb-4">

        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="tbl w-full">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right" style={{ width: 90 }}>Qty</th>
                <th className="text-right" style={{ width: 110 }}>Unit price</th>
                <th className="text-right" style={{ width: 120 }}>Gross total</th>
                <th className="text-right" style={{ width: 100 }}>Discount</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = productById[l.productId];
                const band = bandState(l);
                const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
                const discAmt    = Number(l.discountAmt) || 0;
                return (
                  <tr key={i}>
                    <td className="align-top">
                      <select className="inp" value={l.productId}
                        onChange={(e) => selectProduct(i, e.target.value)}>
                        <option value="">Select…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.fullName || (p.name + (p.thicknessMm ? ` (${p.thicknessMm}mm)` : ""))}
                          </option>
                        ))}
                      </select>
                      <div className="text-[11px] mt-1 h-4 leading-4"
                        style={{ color: band === "out" ? "#b3261e" : "var(--muted)" }}>
                        {p ? `band ${p.priceLower ?? "—"}–${p.priceUpper ?? "—"}${band === "out" ? " · out of band" : ""}` : ""}
                      </div>
                    </td>
                    <td className="text-right align-top">
                      <input className="inp text-right tabular-nums" style={{ width: 75, marginLeft: "auto" }}
                        type="number" min={0} value={l.qty}
                        onChange={(e) => update(i, { qty: e.target.value })} />
                      <div className="h-4 mt-1" />
                    </td>
                    <td className="text-right align-top">
                      <input className="inp text-right tabular-nums"
                        style={{ width: 96, marginLeft: "auto", borderColor: band === "out" ? "#b3261e" : undefined }}
                        type="number" min={0} value={l.unitPrice}
                        onChange={(e) => update(i, { unitPrice: e.target.value })} />
                      <div className="text-[11px] mt-1 h-4 leading-4" style={{ color: "#b3261e" }}>
                        {band === "out" && "✕"}
                      </div>
                    </td>
                    <td className="text-right align-top">
                      <input className="inp text-right tabular-nums" style={{ width: 105, marginLeft: "auto" }}
                        type="number" min={0} value={grossTotal ? grossTotal.toFixed(2) : ""}
                        onChange={(e) => { const t = Number(e.target.value), q = Number(l.qty); if (q > 0) update(i, { unitPrice: String(t / q) }); }}
                        placeholder="0.00" />
                      <div className="h-4 mt-1" />
                    </td>
                    <td className="text-right align-top">
                      <input className="inp text-right tabular-nums" style={{ width: 86, marginLeft: "auto" }}
                        type="number" min={0} value={l.discountAmt}
                        onChange={(e) => update(i, { discountAmt: e.target.value })} placeholder="0.00" />
                      <div className="text-[11px] text-[#6b6960] mt-1 h-4 leading-4">
                        {discAmt > 0 && grossTotal > 0 && `net ${(grossTotal - discAmt).toFixed(2)}`}
                      </div>
                    </td>
                    <td className="text-right align-top pt-2">
                      {lines.length > 1 && (
                        <button onClick={() => removeLine(i)} title="Remove"
                          className="text-[#9a2b22] hover:text-[#7a1c16] transition-colors">
                          <TrashIcon />
                        </button>
                      )}
                      <div className="h-4 mt-1" />
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
            const band = bandState(l);
            const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
            const discAmt    = Number(l.discountAmt) || 0;
            return (
              <div key={i} className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs muted font-medium">Product</span>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} title="Remove"
                      className="text-[#9a2b22] hover:text-[#7a1c16] transition-colors">
                      <TrashIcon />
                    </button>
                  )}
                </div>
                <select className="inp" value={l.productId} onChange={(e) => selectProduct(i, e.target.value)}>
                  <option value="">Select…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName || (p.name + (p.thicknessMm ? ` (${p.thicknessMm}mm)` : ""))}
                    </option>
                  ))}
                </select>
                <div className="text-[11px] -mt-1" style={{ color: band === "out" ? "#b3261e" : "var(--muted)" }}>
                  {p ? `band ${p.priceLower ?? "—"}–${p.priceUpper ?? "—"}${band === "out" ? " · out of band" : ""}` : ""}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs muted block mb-1">Qty</label>
                    <input className="inp text-right tabular-nums w-full" type="number" min={0}
                      value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">Unit price</label>
                    <input className="inp text-right tabular-nums w-full"
                      style={{ borderColor: band === "out" ? "#b3261e" : undefined }}
                      type="number" min={0} value={l.unitPrice}
                      onChange={(e) => update(i, { unitPrice: e.target.value })} />
                    {band === "out" && <div className="text-[11px] mt-0.5" style={{ color: "#b3261e" }}>✕ out of band</div>}
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">Gross total</label>
                    <input className="inp text-right tabular-nums w-full" type="number" min={0}
                      value={grossTotal ? grossTotal.toFixed(2) : ""}
                      onChange={(e) => { const t = Number(e.target.value), q = Number(l.qty); if (q > 0) update(i, { unitPrice: String(t / q) }); }}
                      placeholder="0.00" />
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">Discount</label>
                    <input className="inp text-right tabular-nums w-full" type="number" min={0}
                      value={l.discountAmt} onChange={(e) => update(i, { discountAmt: e.target.value })} placeholder="0.00" />
                    {discAmt > 0 && grossTotal > 0 && (
                      <div className="text-[11px] muted mt-0.5">net {(grossTotal - discAmt).toFixed(2)}</div>
                    )}
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
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", rowGap: 6, columnGap: 24, alignItems: "center" }}>
            <span className="text-xs muted text-right">Gross</span>
            <span className="tabular-nums text-right">{grandGross.toFixed(2)}</span>
            {totalDiscount > 0 && <>
              <span className="text-xs muted text-right">Discount</span>
              <span className="tabular-nums text-right text-[#b4690e]">− {totalDiscount.toFixed(2)}</span>
            </>}
            <span className="text-xs muted font-semibold text-right">Net total</span>
            <input className="inp text-right tabular-nums font-semibold" style={{ width: 150 }}
              type="number" min={0}
              value={netTotal > 0 ? netTotal.toFixed(2) : ""}
              onChange={(e) => applyNetTotal(Number(e.target.value))}
              placeholder="0.00" />
          </div>
        </div>
      )}

      {anyDiscount && (
        <div className="mb-4">
          <label className="text-xs muted">Discount authorised by <span className="text-[#9a2b22]">*</span></label>
          <select className="inp mt-1" style={{ maxWidth: 320, borderColor: !discountBy ? "#b4690e" : undefined }}
            value={discountBy} onChange={(e) => setDiscountBy(e.target.value)}>
            <option value="">Select authoriser…</option>
            {authorisers.map((u) => (
              <option key={u.id} value={u.fullName || u.username}>{u.fullName || u.username} ({u.role})</option>
            ))}
          </select>
        </div>
      )}

      {(anyOutOfBand || paymentMode === "CREDIT") && (
        <div className="mb-4">
          <label className="text-xs muted">Authoriser (required for out-of-band price or over-limit credit)</label>
          <input className="inp mt-1" style={{ maxWidth: 320 }}
            placeholder="Manager / authority name"
            value={overrideBy} onChange={(e) => setOverrideBy(e.target.value)} />
        </div>
      )}

      <button className="btn w-full sm:w-auto" onClick={submit} disabled={busy}>
        {busy ? "Creating…" : "Create sale & deliver"}
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