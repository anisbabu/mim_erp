"use client";

import { useEffect, useMemo, useState } from "react";
import {
  endpoints, type Product, type Warehouse, type Shop, type Customer, type Supplier, type WarehouseStock, type UserView, type CommittedRow,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TrashIcon } from "@/components/Icons";
import QuickCustomer from "@/components/QuickCustomer";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { useI18n } from "@/lib/i18n";

type Line = { productId: string; warehouseId: string; qty: string; unitPrice: string };

export default function NewSalePage() {
  const { user, activeShopId } = useAuth();
  const { t, lang, dn } = useI18n();
  const [products, setProducts]     = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shops, setShops]           = useState<Shop[]>([]);
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [suppliers, setSuppliers]   = useState<Supplier[]>([]);
  const [authorisers, setAuthorisers] = useState<UserView[]>([]);
  const [salespeople, setSalespeople] = useState<UserView[]>([]);

  const [customerId, setCustomerId]     = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryMobile, setDeliveryMobile]   = useState("");
  const [salespersonId, setSalespersonId] = useState("");
  const [localShopId, setLocalShopId]   = useState("");
  const [paymentMode, setPaymentMode]   = useState<"CASH" | "CREDIT">("CASH");
  const [lines, setLines] = useState<Line[]>([{ productId: "", warehouseId: "", qty: "", unitPrice: "" }]);
  const [overrideBy, setOverrideBy] = useState("");
  const [discountBy, setDiscountBy] = useState("");
  const [discount, setDiscount]     = useState("");
  const [transport, setTransport]   = useState("");
  const [msg, setMsg]   = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ id: string; code: string; skipped: string[] } | null>(null);
  const [newCust, setNewCust] = useState(false);
  const [demoLoaded, setDemoLoaded] = useState(false);

  const [stockPanel, setStockPanel]         = useState<WarehouseStock[]>([]);
  const [panelProductId, setPanelProductId] = useState("");
  const [panelLineIndex, setPanelLineIndex] = useState<number | null>(null);
  const [stockByProduct, setStockByProduct] = useState<Record<string, WarehouseStock[]>>({});
  const [committedByProduct, setCommittedByProduct] = useState<Record<string, CommittedRow[]>>({});

  useEffect(() => {
    endpoints.products().then(setProducts).catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
    endpoints.shops().then(setShops).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
    endpoints.suppliers().then(setSuppliers).catch(() => {});
    endpoints.users()
      .then((u) => {
        setAuthorisers(u.filter((x) => x.active && (x.role === "MANAGER" || x.role === "ADMIN")));
        // admins and managers sell too; only accountants are left out
        setSalespeople(u.filter((x) => x.active && x.role !== "ACCOUNTANT")
          .sort((p, q) => (p.fullName || p.username).localeCompare(q.fullName || q.username)));
      })
      .catch(() => {});
  }, []);

  // a manager/admin is usually the seller: preselect themselves (still changeable)
  useEffect(() => {
    if (!user || user.role === "SALESPERSON" || salespersonId) return;
    const me = salespeople.find((x) => x.username === user.username);
    if (me) setSalespersonId(me.id);
  }, [salespeople, user, salespersonId]);

  // arriving from a demo invoice (?demo=id): prefill customer, salesperson and lines once master data is in
  useEffect(() => {
    if (demoLoaded || !products.length || !customers.length || !salespeople.length) return;
    const id = new URLSearchParams(window.location.search).get("demo");
    setDemoLoaded(true);
    if (!id) return;
    endpoints.demoInvoice(id).then((d) => {
      const r = d.request;
      const cust = (r.customerId && customers.find((c) => c.id === r.customerId))
        || customers.find((c) => c.mobile && r.customerMobile && c.mobile === r.customerMobile)
        || customers.find((c) => c.name === r.customerName);
      if (cust) setCustomerId(cust.id);
      // the slip carries the (possibly corrected) name/mobile/address: use them as delivery details
      setDeliveryAddress(r.customerAddress || (cust ? (cust.deliveryAddress || cust.address || "") : ""));
      setDeliveryMobile(r.customerMobile || (cust ? (cust.deliveryContactPhone || cust.mobile || "") : ""));
      const sp = salespeople.find((x) => (x.fullName || x.username) === r.salesperson);
      if (sp) setSalespersonId(sp.id);
      const skipped: string[] = [];
      const next: Line[] = [];
      let disc = 0;
      for (const l of r.lines) {
        const p = (l.productId && products.find((x) => x.id === l.productId)) || products.find((x) => x.name === l.name || x.fullName === l.name || x.nameBn === l.name);
        if (!p) { skipped.push(l.name); continue; }
        disc += Number(l.discount) || 0;
        next.push({ productId: p.id, warehouseId: "", qty: String(l.qty), unitPrice: String(l.unitPrice) });
      }
      if (next.length) {
        setLines(next);
        next.forEach((n) => endpoints.availability(n.productId).then((s) => setStockByProduct((m) => ({ ...m, [n.productId]: s }))).catch(() => {}));
      }
      if (disc > 0) setDiscount(String(disc));
      setDemo({ id: d.id, code: d.code, skipped: [...skipped, ...(cust ? [] : [t("Customer not found - pick one")])] });
    }).catch((e: any) => setMsg({ kind: "err", text: e.message }));
  }, [products, customers, salespeople, demoLoaded]);

  const productById   = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const warehouseById = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  const supplierById  = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers]);
  const customerOpts: Option[] = useMemo(
    () => customers.map((c) => ({ value: c.id, label: `${dn(c)} (${t(c.type)})`, sublabel: c.mobile })),
    [customers, lang]);
  const needsSalesperson = user?.role !== "SALESPERSON";
  const salespersonOpts: Option[] = useMemo(
    () => salespeople.map((s) => ({ value: s.id, label: s.fullName || s.username })),
    [salespeople]);
  const productOpts: Option[] = useMemo(
    () => products.filter((p) => p.active !== false).map((p) => {
      const supplierName = p.supplierId && supplierById[p.supplierId] ? dn(supplierById[p.supplierId]) : undefined;
      const thickness = p.thicknessLabel ?? (p.thicknessMm != null ? `${p.thicknessMm}mm` : undefined);
      const sub = [p.sku, supplierName, thickness].filter(Boolean).join(" · ");
      return { value: p.id, label: lang === "bn" && p.nameBn ? p.nameBn : p.fullName || (p.name + (p.thicknessMm ? ` (${p.thicknessMm}mm)` : "")), sublabel: sub };
    }),
    [products, supplierById, lang]);

  // choosing a customer fills the delivery address/mobile from their record; both stay editable
  function pickCustomer(id: string, fresh?: Customer) {
    setCustomerId(id);
    const c = fresh ?? customers.find((x) => x.id === id);
    setDeliveryAddress(c ? (c.deliveryAddress || c.address || "") : "");
    setDeliveryMobile(c ? (c.deliveryContactPhone || c.mobile || "") : "");
  }

  async function selectProduct(i: number, productId: string) {
    update(i, { productId, warehouseId: "" });
    if (!productId) return;
    setPanelProductId(productId);
    setPanelLineIndex(i);
    endpoints.committed(productId)
      .then((c) => setCommittedByProduct((m) => ({ ...m, [productId]: c })))
      .catch(() => {});
    try {
      const s = await endpoints.availability(productId);
      setStockPanel(s);
      setStockByProduct((m) => ({ ...m, [productId]: s }));
      const stocked = s.filter((x) => x.qty > 0);
      // unit price = FIFO cost from stock_layer (the only warehouse, or the first one until a warehouse is picked)
      const first = stocked[0];
      const patch: Partial<Line> = {};
      if (stocked.length === 1) patch.warehouseId = first.warehouseId;
      if (first?.unitCost != null) patch.unitPrice = String(first.unitCost);
      update(i, patch);
    } catch { setStockPanel([]); }
  }

  // choosing a warehouse also sets the unit price to that warehouse's next FIFO layer cost
  function pickWarehouse(i: number, warehouseId: string) {
    const cost = stockByProduct[lines[i]?.productId]?.find((s) => s.warehouseId === warehouseId)?.unitCost;
    update(i, cost != null ? { warehouseId, unitPrice: String(cost) } : { warehouseId });
  }

  function pickWarehouseFromPanel(warehouseId: string) {
    if (panelLineIndex == null) return;
    pickWarehouse(panelLineIndex, warehouseId);
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

  const grandGross    = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
  const totalDiscount = Math.min(Number(discount) || 0, grandGross);
  const totalTransport = Number(transport) || 0;
  const netTotal      = grandGross - totalDiscount + totalTransport;
  const anyDiscount   = totalDiscount > 0;

  const shopId = activeShopId || localShopId;

  const pendingWarnings = useMemo(() => {
    const wantByProduct: Record<string, number> = {};
    for (const l of lines) if (l.productId && l.warehouseId) wantByProduct[l.productId] = (wantByProduct[l.productId] ?? 0) + (Number(l.qty) || 0);
    return Object.entries(wantByProduct).flatMap(([pid, want]) => {
      const waiting = committedByProduct[pid] ?? [];
      if (!waiting.length || want <= 0) return [];
      const onHand = (stockByProduct[pid] ?? []).reduce((s, x) => s + Number(x.qty), 0);
      const committed = waiting.reduce((s, x) => s + Number(x.qtyPending), 0);
      if (onHand - committed >= want) return [];
      const p = productById[pid];
      return [{ pid, name: (lang === "bn" && p?.nameBn) || p?.fullName || p?.name || pid, onHand, committed, want, waiting }];
    });
  }, [lines, committedByProduct, stockByProduct, productById, lang]);

  async function submit() {
    setMsg(null);
    if (!shopId)      { setMsg({ kind: "err", text: t("Select a shop.") }); return; }
    if (!customerId)  { setMsg({ kind: "err", text: t("Select a customer.") }); return; }
    if (needsSalesperson && !salespersonId) { setMsg({ kind: "err", text: t("Select a salesperson.") }); return; }
    const validLines = lines.filter((l) => l.productId && Number(l.qty) > 0);
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
      return { productId: l.productId, warehouseId: l.warehouseId || null, qty: Number(l.qty),
               unitPrice: Number(l.unitPrice), discountAmt: lineDisc };
    });
    if (!allocations.length) { setMsg({ kind: "err", text: t("Add at least one line with qty.") }); return; }
    // out-of-band price is only a warning here (red hint stays on the line); the order still saves,
    // with a placeholder authoriser so the backend's audit column is filled
    if (anyDiscount && !discountBy.trim()) {
      setMsg({ kind: "err", text: t("Discount requires an authoriser — enter their name.") }); return;
    }
    setBusy(true);
    try {
      const res: any = await endpoints.createOrder({
        shopId, customerId, salespersonId: needsSalesperson ? salespersonId : null, paymentMode, allocations,
        creditOverrideBy:    overrideBy || null,
        priceOverrideBy:     overrideBy.trim() || "(not authorised)",   // server keeps it only on lines that need it (band or below FIFO cost)
        discountBy:          anyDiscount  ? discountBy : null,
        transportAndLifting: totalTransport || null,
        deliveryAddress:     deliveryAddress.trim() || null,
        deliveryMobile:      deliveryMobile.trim() || null,
      });
      if (demo) { endpoints.linkDemoInvoice(demo.id, res.soId).catch(() => {}); setDemo(null); }
      const margin = (res.totalValue - res.totalCost).toFixed(2);
      setMsg({ kind: "ok", text: `${t("Sale")} ${res.soNo} ${t("created")} · ${res.challanIds.length} ${t("challan(s)")} · ${t("margin")} ${margin}` });
      setDiscount(""); setTransport(""); setDeliveryAddress(""); setDeliveryMobile("");
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
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="page-title">{t("Sales invoice")}</h1>
          <a href="/sales/demo-invoice" className="btn-ghost btn-sm">{t("Demo invoice")}</a>
        </div>
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

      <QuickCustomer open={newCust} onClose={() => setNewCust(false)} existing={customers}
        onCreated={(c) => { setCustomers((cs) => [...cs, c]); pickCustomer(c.id, c); }} />

      {demo && (
        <div className="note mb-4">
          {t("From demo invoice")} <b className="font-mono">{demo.code}</b> - {t("check the lines, pick warehouses, then save the sale.")}
          {demo.skipped.length > 0 && <div className="mt-1" style={{ color: "#b4690e" }}>{t("Not in the product list, add by hand")}: {demo.skipped.join(", ")}</div>}
        </div>
      )}

      {/* Header fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {!activeShopId && (
          <div className="field">
            <label>{t("Shop")}</label>
            <select className="inp inp-shop" value={localShopId} onChange={(e) => setLocalShopId(e.target.value)}>
              <option value="">{t("Select shop…")}</option>
              {shops.map((s) => <option key={s.id} value={s.id}>{dn(s)}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label className="flex items-center justify-between">{t("Customer")}
            <button type="button" className="text-[12px] font-medium" style={{ color: "var(--brand)" }} onClick={() => setNewCust(true)}>+ {t("New customer")}</button></label>
          <SearchSelect options={customerOpts} value={customerId}
            onChange={pickCustomer} placeholder={t("Search name or mobile…")} />
        </div>
        <div className="field">
          <label>{t("Delivery address")}</label>
          <input className="inp" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)}
            placeholder={t("Delivery address")} />
        </div>
        <div className="field">
          <label>{t("Delivery mobile")}</label>
          <input className="inp" value={deliveryMobile} onChange={(e) => setDeliveryMobile(e.target.value)}
            placeholder={t("Delivery mobile")} />
        </div>
        {needsSalesperson && (
          <div className="field">
            <label>{t("Salesperson")}</label>
            <SearchSelect options={salespersonOpts} value={salespersonId}
              onChange={setSalespersonId} placeholder={t("Search…")} />
          </div>
        )}
        <div className="field">
          <label>{t("Payment")}</label>
          <select className="inp" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as "CASH" | "CREDIT")}>
            <option value="CASH">{t("Cash")}</option>
            <option value="CREDIT">{t("Credit (party)")}</option>
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
                <th>{t("Product")}</th>
                <th style={{ width: 150 }}>{t("Warehouse")}</th>
                <th className="text-right" style={{ width: 90 }}>{t("Qty")}</th>
                <th className="text-right" style={{ width: 110 }}>{t("Unit price")}</th>
                <th className="text-right" style={{ width: 120 }}>{t("Gross total")}</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const p = productById[l.productId];
                const band = bandState(l);
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
                        {p ? `${t("band")} ${p.priceLower ?? "—"}–${p.priceUpper ?? "—"}${band === "out" ? ` · ${t("out of band")}` : ""}` : ""}
                      </div>
                    </td>
                    <td className="align-top">
                      <select className="inp" value={l.warehouseId} onChange={(e) => pickWarehouse(i, e.target.value)}>
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
                        {!l.warehouseId && l.productId && Number(l.qty) > 0 ? t("all pending (no warehouse)") : ""}
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
                    <td className="text-right align-top pt-2">
                      {lines.length > 1 && (
                        <button className="btn-icon btn-icon-del" title={t("Remove")} onClick={() => removeLine(i)}>
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
            const lineStock = l.productId ? stockByProduct[l.productId] : undefined;
            const qtyByWarehouse = Object.fromEntries((lineStock ?? []).map((s) => [s.warehouseId, s.qty]));
            const stockedWarehouses = lineStock ? warehouses.filter((w) => qtyByWarehouse[w.id] > 0) : warehouses;
            return (
              <div key={i} className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
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
                  {p ? `${t("band")} ${p.priceLower ?? "—"}–${p.priceUpper ?? "—"}${band === "out" ? ` · ${t("out of band")}` : ""}` : ""}
                </div>
                <div className="field">
                  <label className="text-xs muted block mb-1">{t("Warehouse")}</label>
                  <select className="inp" value={l.warehouseId} onChange={(e) => pickWarehouse(i, e.target.value)}>
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
                    {!l.warehouseId && l.productId && Number(l.qty) > 0 ? t("all pending (no warehouse)") : ""}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs muted block mb-1">{t("Qty")}</label>
                    <input className="inp text-right tabular-nums w-full" type="number" min={0}
                      value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">{t("Unit price")}</label>
                    <input className="inp text-right tabular-nums w-full"
                      style={{ borderColor: band === "out" ? "#b3261e" : undefined }}
                      type="number" min={0} value={l.unitPrice}
                      onChange={(e) => update(i, { unitPrice: e.target.value })} />
                    {band === "out" && <div className="text-[11px] mt-0.5" style={{ color: "#b3261e" }}>✕ {t("out of band")}</div>}
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">{t("Gross total")}</label>
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
          <button className="btn-ghost" onClick={addLine}>+ {t("Add line")}</button>
        </div>
      </div>

      {grandGross > 0 && (
        <div className="mb-4 flex justify-end">
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", rowGap: 6, columnGap: 24, alignItems: "center" }}>
            <span className="text-xs muted text-right">{t("Gross")}</span>
            <span className="tabular-nums text-right">{grandGross.toFixed(2)}</span>
            <span className="text-xs muted text-right">{t("Discount")}</span>
            <input className="inp text-right tabular-nums" style={{ width: 120 }}
              type="number" min={0} max={grandGross} placeholder="0"
              value={discount} onChange={(e) => setDiscount(e.target.value)} />
            <span className="text-xs muted text-right">{t("Transport & Lifting")}</span>
            <input className="inp text-right tabular-nums" style={{ width: 120 }}
              type="number" min={0} placeholder="0"
              value={transport} onChange={(e) => setTransport(e.target.value)} />
            <span className="text-xs muted font-semibold text-right">{t("Net total")}</span>
            <span className="tabular-nums font-bold text-right text-base" style={{ color: "var(--brand)" }}>
              {netTotal.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {anyDiscount && (
        <div className="mb-4">
          <label className="text-xs muted">{t("Discount authorised by")} <span className="text-[#9a2b22]">*</span></label>
          <select className="inp mt-1" style={{ maxWidth: 320, borderColor: !discountBy ? "#b4690e" : undefined }}
            value={discountBy} onChange={(e) => setDiscountBy(e.target.value)}>
            <option value="">{t("Select authoriser…")}</option>
            {authorisers.map((u) => (
              <option key={u.id} value={u.fullName || u.username}>{u.fullName || u.username} ({t(u.role)})</option>
            ))}
          </select>
        </div>
      )}

      {/* always shown: a price below FIFO cost is only known to the server */}
      <div className="mb-4">
        <label className="text-xs muted">{t("Authoriser (required for out-of-band price or over-limit credit)")}</label>
        <input className="inp mt-1" style={{ maxWidth: 320 }}
          placeholder={t("Manager / authority name")}
          value={overrideBy} onChange={(e) => setOverrideBy(e.target.value)} />
      </div>

      {pendingWarnings.length > 0 && (
        <div className="mb-4 text-sm rounded-lg px-4 py-3" style={{ background: "#fdf3e1", color: "#7a4a06" }}>
          {pendingWarnings.map((w) => (
            <div key={w.pid} className="mb-1 last:mb-0">
              ⚠ <b>{w.name}</b>: {t("on hand")} {w.onHand}, {t("already sold but not picked up")} {w.committed}
              {" "}({t("waiting:")} {w.waiting.map((c) => `${c.customerName} ${Number(c.qtyPending)} (${c.soNo})`).join(", ")}).
              {" "}{t("Taking")} {w.want} {t("now may leave them short. You can still sell, at your own risk.")}
            </div>
          ))}
        </div>
      )}

      <button className="btn w-full sm:w-auto" onClick={submit} disabled={busy}>
        {busy ? t("Creating…") : t("Create invoice & deliver")}
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