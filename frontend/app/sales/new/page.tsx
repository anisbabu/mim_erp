"use client";

import { useEffect, useMemo, useState } from "react";
import {
  endpoints, type Product, type Warehouse, type Shop, type Customer, type WarehouseStock, type UserView,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

// New-sale screen (SO_FIRST workflow).
// Pick a product -> the system shows available stock per warehouse with qty.
// Salesperson allocates qty from one or more warehouses and enters a negotiated
// price (unit OR gross total — each fills the other). Price band is checked client-side
// for instant feedback; the backend re-validates and is the source of truth.
type Line = {
  productId: string;
  warehouseId: string;
  qty: string;
  unitPrice: string;
  discountAmt: string;
};

export default function NewSalePage() {
  const { activeShopId } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stockByProduct, setStockByProduct] = useState<Record<string, WarehouseStock[]>>({});
  const [authorisers, setAuthorisers] = useState<UserView[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [paymentMode, setPaymentMode] = useState<"CASH" | "CREDIT">("CASH");
  const [lines, setLines] = useState<Line[]>([{ productId: "", warehouseId: "", qty: "", unitPrice: "", discountAmt: "" }]);
  const [overrideBy, setOverrideBy] = useState("");
  const [discountBy, setDiscountBy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.products().then(setProducts).catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
    endpoints.shops().then(setShops).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
    endpoints.users().then((u) => setAuthorisers(u.filter((x) => x.active && (x.role === "MANAGER" || x.role === "ADMIN")))).catch(() => {});
  }, []);

  const activeShopName = shops.find((s) => s.id === activeShopId)?.name;

  const productById = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const warehouseById = useMemo(
    () => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function loadStock(productId: string) {
    if (!productId || stockByProduct[productId]) return;
    const s = await endpoints.availability(productId);
    setStockByProduct((m) => ({ ...m, [productId]: s }));
  }

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  const addLine = () => setLines((ls) => [...ls, { productId: "", warehouseId: "", qty: "", unitPrice: "", discountAmt: "" }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  // band check uses GROSS unit price (discount is separately authorised)
  function bandState(l: Line): "ok" | "out" | "none" {
    const p = productById[l.productId];
    const price = Number(l.unitPrice);
    if (!p || !l.unitPrice) return "none";
    if (p.priceLower != null && price < p.priceLower) return "out";
    if (p.priceUpper != null && price > p.priceUpper) return "out";
    return "ok";
  }

  const anyOutOfBand = lines.some((l) => bandState(l) === "out");
  const anyDiscount = lines.some((l) => Number(l.discountAmt) > 0);

  const grandGross    = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
  const totalDiscount = lines.reduce((s, l) => s + (Number(l.discountAmt) || 0), 0);
  const netTotal      = grandGross - totalDiscount;

  function applyNetTotal(newNet: number) {
    if (grandGross <= 0) return;
    const newTotalDisc = Math.max(0, grandGross - newNet);
    setLines((ls) => {
      const grosses = ls.map((l) => Number(l.qty) * Number(l.unitPrice));
      const sumGross = grosses.reduce((a, b) => a + b, 0);
      if (sumGross === 0) return ls;
      let assigned = 0;
      return ls.map((l, i) => {
        const isLast = i === ls.length - 1;
        const disc = isLast
          ? Math.round((newTotalDisc - assigned) * 100) / 100
          : Math.round((newTotalDisc * grosses[i] / sumGross) * 100) / 100;
        if (!isLast) assigned += disc;
        return { ...l, discountAmt: disc > 0 ? String(disc) : "" };
      });
    });
  }

  async function submit() {
    setMsg(null);
    const allocations = lines
      .filter((l) => l.productId && l.warehouseId && Number(l.qty) > 0)
      .map((l) => ({
        productId: l.productId, warehouseId: l.warehouseId,
        qty: Number(l.qty), unitPrice: Number(l.unitPrice),
        discountAmt: Number(l.discountAmt) || 0,
      }));
    if (!activeShopId) { setMsg({ kind: "err", text: "No active shop set for your account." }); return; }
    if (!customerId) { setMsg({ kind: "err", text: "Select a customer." }); return; }
    if (allocations.length === 0) { setMsg({ kind: "err", text: "Add at least one allocation with qty." }); return; }
    if (anyOutOfBand && !overrideBy.trim()) {
      setMsg({ kind: "err", text: "A price is out of band — enter the authoriser name to override." });
      return;
    }
    if (anyDiscount && !discountBy.trim()) {
      setMsg({ kind: "err", text: "Discount requires an authoriser — enter their name." });
      return;
    }

    setBusy(true);
    try {
      const res: any = await endpoints.createOrder({
        shopId: activeShopId, customerId, paymentMode, allocations,
        creditOverrideBy: overrideBy || null,
        priceOverrideBy: anyOutOfBand ? overrideBy : null,
        discountBy: anyDiscount ? discountBy : null,
      });
      const margin = (res.totalValue - res.totalCost).toFixed(2);
      setMsg({ kind: "ok", text: `Sale ${res.soNo} created · ${res.challanIds.length} challan(s) · margin ${margin}` });
      const used = new Set(allocations.map((a) => a.productId));
      for (const pid of used) {
        const s = await endpoints.availability(pid);
        setStockByProduct((m) => ({ ...m, [pid]: s }));
      }
    } catch (e: any) {
      setMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-medium mb-1">New sale</h1>
      <p className="text-sm text-[#6b6960] mb-6">
        Order-first workflow. Choose a product to see available stock per warehouse, allocate
        quantity, and enter the negotiated price. The system splits delivery into one challan per warehouse.
      </p>

      <div className="form-grid cols-2 mb-5">
        <div className="field">
          <label>Customer</label>
          <select className="inp" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
          </select>
        </div>
        <div className="field">
          <label>Payment</label>
          <select className="inp" value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as "CASH" | "CREDIT")}>
            <option value="CASH">Cash</option>
            <option value="CREDIT">Credit (party)</option>
          </select>
        </div>
      </div>

      <div className="card table-wrap mb-4">
        <table className="tbl">
          <thead>
            <tr>
              <th>Product</th>
              <th>Warehouse (available)</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Unit price</th>
              <th className="text-right">Gross total</th>
              <th className="text-right">Discount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const p = productById[l.productId];
              const stock = l.productId ? (stockByProduct[l.productId] ?? []) : [];
              const band = bandState(l);
              const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
              const discAmt = Number(l.discountAmt) || 0;
              return (
                <tr key={i}>
                  <td className="align-top">
                    <select className="inp" value={l.productId}
                      onChange={(e) => { update(i, { productId: e.target.value, warehouseId: "" }); loadStock(e.target.value); }}>
                      <option value="">Select…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.fullName || (p.name + (p.thicknessMm ? ` (${p.thicknessMm}mm)` : ""))}
                        </option>
                      ))}
                    </select>
                    <div className="text-[11px] text-[#6b6960] mt-1 h-4 leading-4">
                      {p && `band ${p.priceLower ?? "—"}–${p.priceUpper ?? "—"}`}
                    </div>
                  </td>
                  <td className="align-top">
                    <select className="inp" value={l.warehouseId}
                      onChange={(e) => update(i, { warehouseId: e.target.value })}
                      disabled={!l.productId}>
                      <option value="">Select warehouse…</option>
                      {stock.filter((s) => s.qty > 0).map((s) => (
                        <option key={s.warehouseId} value={s.warehouseId}>
                          {warehouseById[s.warehouseId]?.name ?? s.warehouseId} · {s.qty} avail
                        </option>
                      ))}
                    </select>
                    <div className="text-[11px] text-amberwarn mt-1 h-4 leading-4">
                      {l.productId && stock.length === 0 && "no stock in any warehouse"}
                    </div>
                  </td>
                  <td className="text-right">
                    <input className="inp text-right tabular-nums" style={{ width: 80, marginLeft: "auto" }}
                      type="number" min={0} value={l.qty}
                      onChange={(e) => update(i, { qty: e.target.value })} />
                    <div className="h-4 mt-1" />
                  </td>
                  <td className="text-right">
                    <input className="inp text-right tabular-nums"
                      style={{ width: 96, marginLeft: "auto",
                               borderColor: band === "out" ? "#b4690e" : undefined }}
                      type="number" min={0} value={l.unitPrice}
                      onChange={(e) => update(i, { unitPrice: e.target.value })} />
                    <div className="text-[11px] text-amberwarn mt-1 h-4 leading-4">
                      {band === "out" && "out of band"}
                    </div>
                  </td>
                  <td className="text-right">
                    <input className="inp text-right tabular-nums" style={{ width: 110, marginLeft: "auto" }}
                      type="number" min={0} value={grossTotal ? grossTotal.toFixed(2) : ""}
                      onChange={(e) => {
                        const t = Number(e.target.value); const q = Number(l.qty);
                        if (q > 0) update(i, { unitPrice: String(t / q) });
                      }}
                      placeholder="0.00" />
                    <div className="h-4 mt-1" />
                  </td>
                  <td className="text-right">
                    <input className="inp text-right tabular-nums" style={{ width: 96, marginLeft: "auto" }}
                      type="number" min={0} value={l.discountAmt}
                      onChange={(e) => update(i, { discountAmt: e.target.value })}
                      placeholder="0.00" />
                    <div className="text-[11px] text-[#6b6960] mt-1 h-4 leading-4">
                      {discAmt > 0 && grossTotal > 0 && `net ${(grossTotal - discAmt).toFixed(2)}`}
                    </div>
                  </td>
                  <td className="text-right">
                    {lines.length > 1 && (
                      <button className="text-[#9a2b22] text-sm" onClick={() => removeLine(i)}>remove</button>
                    )}
                    <div className="h-4 mt-1" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-line">
          <button className="btn-ghost" onClick={addLine}>+ Add line</button>
        </div>
      </div>

      {grandGross > 0 && (
        <div className="mb-4 flex justify-end">
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", rowGap: 6, columnGap: 24, alignItems: "center" }}>
            <span className="text-xs text-[#6b6960] text-right">Gross</span>
            <span className="tabular-nums text-right">{grandGross.toFixed(2)}</span>
            {totalDiscount > 0 && <>
              <span className="text-xs text-[#6b6960] text-right">Discount</span>
              <span className="tabular-nums text-right text-[#b4690e]">− {totalDiscount.toFixed(2)}</span>
            </>}
            <span className="text-xs text-[#6b6960] font-semibold text-right">Net total (customer pays)</span>
            <input
              className="inp text-right tabular-nums font-semibold"
              style={{ width: 150 }}
              type="number" min={0}
              value={netTotal > 0 ? netTotal.toFixed(2) : ""}
              onChange={(e) => applyNetTotal(Number(e.target.value))}
              placeholder="0.00"
            />
          </div>
        </div>
      )}

      {anyDiscount && (
        <div className="mb-4">
          <label className="text-xs text-[#6b6960]">Discount authorised by <span className="text-[#9a2b22]">*</span></label>
          <select className="inp mt-1" style={{ maxWidth: 320, borderColor: !discountBy ? "#b4690e" : undefined }}
            value={discountBy} onChange={(e) => setDiscountBy(e.target.value)}>
            <option value="">Select authoriser…</option>
            {authorisers.map((u) => (
              <option key={u.id} value={u.fullName || u.username}>
                {u.fullName || u.username} ({u.role})
              </option>
            ))}
          </select>
          {!discountBy && (
            <p className="text-xs mt-1" style={{ color: "#b4690e" }}>
              Discount entered — select an authorised person before saving.
            </p>
          )}
        </div>
      )}

      {(anyOutOfBand || paymentMode === "CREDIT") && (
        <div className="mb-4">
          <label className="text-xs text-[#6b6960]">
            Authoriser (required for out-of-band price or over-limit credit)
          </label>
          <input className="inp mt-1" style={{ maxWidth: 320 }}
            placeholder="Manager / authority name"
            value={overrideBy} onChange={(e) => setOverrideBy(e.target.value)} />
        </div>
      )}

      <button className="btn" onClick={submit} disabled={busy}>
        {busy ? "Creating…" : "Create sale & deliver"}
      </button>

      {msg && (
        <div className="mt-4 text-sm rounded-lg px-4 py-3"
             style={{ background: msg.kind === "ok" ? "#e6efe9" : "#fbeceb",
                      color: msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}