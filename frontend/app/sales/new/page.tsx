"use client";

import { useEffect, useMemo, useState } from "react";
import {
  endpoints, type Product, type Warehouse, type Shop, type Customer, type WarehouseStock, type UserView,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TrashIcon } from "@/components/Icons";

type Line = { productId: string; warehouseId: string; qty: string; unitPrice: string };

export default function NewSalePage() {
  const { activeShopId } = useAuth();
  const [products, setProducts]     = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shops, setShops]           = useState<Shop[]>([]);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [authorisers, setAuthorisers] = useState<UserView[]>([]);

  const [customerId, setCustomerId]     = useState("");
  const [localShopId, setLocalShopId]   = useState("");
  const [paymentMode, setPaymentMode]   = useState<"CASH" | "CREDIT">("CASH");
  const [lines, setLines] = useState<Line[]>([{ productId: "", warehouseId: "", qty: "", unitPrice: "", discountAmt: "" }]);
  const [overrideBy, setOverrideBy] = useState("");
  const [discountBy, setDiscountBy] = useState("");
  const [discount, setDiscount]     = useState("");
  const [transport, setTransport]   = useState("");
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
  const addLine    = () => setLines((ls) => [...ls, { productId: "", warehouseId: "", qty: "", unitPrice: "" }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  function bandState(l: Line): "ok" | "out" | "none" {
    const p = productById[l.productId];
    const price = Number(l.unitPrice);
    if (!p || !l.unitPrice) return "none";
    if (p.priceLower != null && price < p.priceLower) return "out";
    if (p.priceUpper != null && price > p.priceUpper) return "out";
    return "ok";
  }

  const anyOutOfBand  = lines.some((l) => bandState(l) === "out");
  const grandGross    = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
  const totalDiscount = Math.min(Number(discount) || 0, grandGross);
  const totalTransport = Number(transport) || 0;
  const netTotal      = grandGross - totalDiscount + totalTransport;
  const anyDiscount   = totalDiscount > 0;

  const shopId = activeShopId || localShopId;

  async function submit() {
    setMsg(null);
    if (!shopId)      { setMsg({ kind: "err", text: "Select a shop." }); return; }
    if (!customerId)  { setMsg({ kind: "err", text: "Select a customer." }); return; }
    const validLines = lines.filter((l) => l.productId && l.warehouseId && Number(l.qty) > 0);
    const sumGross = validLines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
    let assigned = 0;
    const allocations = validLines.map((l, i) => {
      const lineGross = Number(l.qty) * Number(l.unitPrice);
      const isLast = i === validLines.length - 1;
      const lineDisc = sumGross > 0
        ? isLast
          ? Math.round((totalDiscount - assigned) * 100) / 100
          : Math.round((totalDiscount * lineGross / sumGross) * 100) / 100
        : 0;
      if (!isLast) assigned += lineDisc;
      return { productId: l.productId, warehouseId: l.warehouseId, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountAmt: lineDisc };
    });
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
        creditOverrideBy:    overrideBy || null,
        priceOverrideBy:     anyOutOfBand ? overrideBy : null,
        discountBy:          anyDiscount  ? discountBy : null,
        transportAndLifting: totalTransport || null,
      });
      const margin = (res.totalValue - res.totalCost).toFixed(2);
      setMsg({ kind: "ok", text: `Sale ${res.soNo} created · ${res.challanIds.length} challan(s) · margin ${margin}` });
      setDiscount(""); setTransport("");
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
        <h1 className="page-title">Sales invoice</h1>
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
                <th style={{ width: 150 }}>Warehouse</th>
                <th className="text-right" style={{ width: 90 }}>Qty</th>
                <th className="text-right" style={{ width: 110 }}>Unit price</th>
                <th className="text-right" style={{ width: 120 }}>Gross total</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = productById[l.productId];
                const band = bandState(l);
                const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
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
                    <td className="align-top">
                      <select className="inp" value={l.warehouseId} onChange={(e) => update(i, { warehouseId: e.target.value })}>
                        <option value="">Select…</option>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      <div className="h-4 mt-1" />
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
                    <td className="text-right align-top pt-2">
                      {lines.length > 1 && (
                        <button className="btn-icon btn-icon-del" title="Remove" onClick={() => removeLine(i)}>
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
                <div className="field">
                  <label className="text-xs muted block mb-1">Warehouse</label>
                  <select className="inp" value={l.warehouseId} onChange={(e) => update(i, { warehouseId: e.target.value })}>
                    <option value="">Select…</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
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
            <span className="text-xs muted text-right">Discount</span>
            <input className="inp text-right tabular-nums" style={{ width: 120 }}
              type="number" min={0} max={grandGross} placeholder="0"
              value={discount} onChange={(e) => setDiscount(e.target.value)} />
            <span className="text-xs muted text-right">Transport &amp; Lifting</span>
            <input className="inp text-right tabular-nums" style={{ width: 120 }}
              type="number" min={0} placeholder="0"
              value={transport} onChange={(e) => setTransport(e.target.value)} />
            <span className="text-xs muted font-semibold text-right">Net total</span>
            <span className="tabular-nums font-bold text-right text-base" style={{ color: "#0f766e" }}>
              {netTotal.toFixed(2)}
            </span>
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
        {busy ? "Creating…" : "Create invoice & deliver"}
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