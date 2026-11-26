"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  endpoints, type Product, type Warehouse, type Shop, type Customer, type Supplier, type WarehouseStock, type UserView, type StockStatusRow,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TrashIcon } from "@/components/Icons";
import { Store } from "lucide-react";
import QuickCustomer from "@/components/QuickCustomer";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { productKeywords } from "@/lib/productSearch";
import { useI18n } from "@/lib/i18n";
import TopMessage from "@/components/TopMessage";
import { useStepCheck, type Problem } from "@/lib/useStepCheck";

type Line = { productId: string; qty: string; unitPrice: string };

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
  const [lines, setLines] = useState<Line[]>([{ productId: "", qty: "", unitPrice: "" }]);
  const [overrideBy, setOverrideBy] = useState("");
  const [discountBy, setDiscountBy] = useState("");
  const [discount, setDiscount]     = useState("");
  const [transport, setTransport]   = useState("");
  const [msg, setMsg]   = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ id: string; code: string; skipped: string[] } | null>(null);
  const [newCust, setNewCust] = useState(false);
  const [demoLoaded, setDemoLoaded] = useState(false);
  const [focusLine, setFocusLine] = useState<number | null>(null);

  // stock-by-warehouse reference panel for whichever line's product was picked last — informational only;
  // delivery (which warehouse, how much now vs pending) is decided later on Sales orders → Fulfill.
  const [stockPanel, setStockPanel]         = useState<WarehouseStock[]>([]);
  const [panelProductId, setPanelProductId] = useState("");

  useEffect(() => {
    endpoints.products().then(setProducts).catch(() => {});
    loadStock();
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
        next.push({ productId: p.id, qty: String(l.qty), unitPrice: String(l.unitPrice) });
      }
      if (next.length) setLines(next);
      if (disc > 0) setDiscount(String(disc));
      setDemo({ id: d.id, code: d.code, skipped: [...skipped, ...(cust ? [] : [t("Customer not found - pick one")])] });
    }).catch((e: any) => setMsg({ kind: "err", text: e.message }));
  }, [products, customers, salespeople, demoLoaded]);

  const supplierById  = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers]);
  const warehouseById = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  const customerOpts: Option[] = useMemo(
    () => customers.map((c) => ({ value: c.id, label: `${dn(c)} (${t(c.type)})`, sublabel: c.mobile })),
    [customers, lang]);
  const needsSalesperson = user?.role !== "SALESPERSON";
  const salespersonOpts: Option[] = useMemo(
    () => salespeople.map((s) => ({ value: s.id, label: s.fullName || s.username })),
    [salespeople]);
  // stock colour in the product list: green = free to sell, amber = on hand but all sold (awaiting pickup), red = none
  const [stockStatus, setStockStatus] = useState<Record<string, StockStatusRow>>({});
  function loadStock() {
    endpoints.stockStatus().then((r) => setStockStatus(Object.fromEntries(r.map((x) => [x.productId, x])))).catch(() => {});
  }
  const productOpts: Option[] = useMemo(
    () => products.filter((p) => p.active !== false).map((p) => {
      const supplierName = p.supplierId && supplierById[p.supplierId] ? dn(supplierById[p.supplierId]) : undefined;
      const thickness = p.thicknessLabel ?? (p.thicknessMm != null ? `${p.thicknessMm}mm` : undefined);
      const st = stockStatus[p.id];
      const onHand = Number(st?.onHand ?? 0), avail = Number(st?.available ?? 0);
      const tone: Option["tone"] = avail > 0 ? "ok" : onHand > 0 ? "warn" : "bad";
      const stockText = tone === "ok" ? `${t("In stock")} ${avail}`
        : tone === "warn" ? `${t("All sold, awaiting pickup")} ${onHand}` : t("Out of stock");
      const sub = [stockText, p.sku, supplierName, thickness].filter(Boolean).join(" · ");
      return { value: p.id, label: lang === "bn" && p.nameBn ? p.nameBn : p.fullName || (p.name + (p.thicknessMm ? ` (${p.thicknessMm}mm)` : "")), sublabel: sub,
        tone, keywords: productKeywords(p, p.supplierId ? supplierById[p.supplierId] : undefined) };
    }),
    [products, supplierById, lang, stockStatus]);   // eslint-disable-line react-hooks/exhaustive-deps

  // choosing a customer fills the delivery address/mobile from their record; both stay editable
  function pickCustomer(id: string, fresh?: Customer) {
    setCustomerId(id);
    const c = fresh ?? customers.find((x) => x.id === id);
    setDeliveryAddress(c ? (c.deliveryAddress || c.address || "") : "");
    setDeliveryMobile(c ? (c.deliveryContactPhone || c.mobile || "") : "");
  }

  async function selectProduct(i: number, productId: string) {
    update(i, { productId });
    if (!productId) return;
    setPanelProductId(productId);
    try {
      const s = await endpoints.availability(productId);
      setStockPanel(s);
      // unit price defaults to the FIFO cost of whichever warehouse has it first — just a starting point
      const first = s.filter((x) => x.qty > 0)[0];
      if (first?.unitCost != null) update(i, { unitPrice: String(first.unitCost) });
    } catch { setStockPanel([]); }
  }

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  const addLine    = () => setLines((ls) => [...ls, { productId: "", qty: "", unitPrice: "" }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  // Enter in a line's qty / price / total goes to the next line's product, adding the line
  // when this is the last one. The product search handles its own Enter (it is rendered outside the row).
  function lineEnter(e: KeyboardEvent<HTMLElement>, i: number) {
    const el = e.target as HTMLElement;
    if (e.key !== "Enter" || !e.currentTarget.contains(el) || (el.tagName !== "INPUT" && el.tagName !== "SELECT")) return;
    e.preventDefault();
    if (i === lines.length - 1) {
      if (!lines[i].productId) return;   // nothing entered yet: no point stacking empty lines
      addLine();
    }
    setFocusLine(i + 1);
  }

  // focus the product field of a line once it is on screen (desktop row or mobile card, whichever shows)
  useEffect(() => {
    if (focusLine == null || focusLine >= lines.length) return;
    const btn = Array.from(document.querySelectorAll<HTMLElement>(`[data-line="${focusLine}"] button.inp`))
      .find((b) => b.offsetParent !== null);
    btn?.focus();
    setFocusLine(null);
  }, [focusLine, lines.length]);

  const grandGross    = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
  const totalDiscount = Math.min(Number(discount) || 0, grandGross);
  const totalTransport = Number(transport) || 0;
  const netTotal      = grandGross - totalDiscount + totalTransport;
  const anyDiscount   = totalDiscount > 0;

  const shopId = activeShopId || localShopId;

  /** First thing missing, in form order: shop, customer, salesperson, then line by line product -> qty -> price, then discount authoriser. */
  const problem = useMemo((): Problem => {
    if (!shopId) return { key: "shop", text: t("Select a shop.") };
    if (!customerId) return { key: "customer", text: t("Select a customer.") };
    if (needsSalesperson && !salespersonId) return { key: "salesperson", text: t("Select a salesperson.") };
    const used = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.productId || l.qty || l.unitPrice);
    const check = used.length ? used : [{ l: lines[0], i: 0 }];
    for (const { l, i } of check) {
      const row = lines.length > 1 ? ` (${t("line")} ${i + 1})` : "";
      if (!l.productId) return { key: `product-${i}`, text: t("Select a product.") + row };
      if (!(Number(l.qty) > 0)) return { key: `qty-${i}`, text: t("Enter the quantity.") + row };
      if (!(Number(l.unitPrice) > 0)) return { key: `price-${i}`, text: t("Enter the unit price.") + row };
    }
    if (anyDiscount && !discountBy.trim()) return { key: "discountBy", text: t("Discount requires an authoriser — enter their name.") };
    return null;
  }, [shopId, customerId, needsSalesperson, salespersonId, lines, anyDiscount, discountBy, t]);
  const check = useStepCheck(problem);

  async function submit() {
    setMsg(null);
    if (check.stop()) return;
    const validLines = lines.filter((l) => l.productId && Number(l.qty) > 0);
    const sumGross = validLines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
    let assigned = 0;
    // a sales order only — nothing is delivered here; warehouse, Take now and the resulting
    // token/challan all happen later on Sales orders → Fulfill (full or partial, as the customer takes it)
    const allocations = validLines.map((l, i) => {
      const lineGross = Number(l.qty) * Number(l.unitPrice);
      const isLast = i === validLines.length - 1;
      const lineDisc = sumGross > 0
        ? isLast
          ? Math.round((totalDiscount - assigned) * 100) / 100
          : Math.round((totalDiscount * lineGross / sumGross) * 100) / 100
        : 0;
      if (!isLast) assigned += lineDisc;
      return { productId: l.productId, warehouseId: null, qty: Number(l.qty),
               unitPrice: Number(l.unitPrice), discountAmt: lineDisc, deliverQty: null };
    });
    // no price band on a new sales order: any price saves; the placeholder authoriser keeps the
    // backend's band / below-cost check from blocking and marks such lines in the audit column
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
      setMsg({ kind: "ok", text: `${t("Sale")} ${res.soNo} ${t("created")} — ${t("fulfill it from Sales orders to deliver")}` });
      setLines([{ productId: "", qty: "", unitPrice: "" }]);
      setDiscount(""); setTransport(""); setDeliveryAddress(""); setDeliveryMobile("");
      setPanelProductId(""); setStockPanel([]);
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
          {/* the shop this sale is for: first thing on the form, always visible */}
          <div className={`shop-bar ${shopId ? "is-set" : "is-missing"}${check.flagged === "shop" ? " is-error" : ""}`}>
            <Store size={18} />
            <span className="shop-bar-label">{t("Shop")} <span className="req">*</span></span>
            {activeShopId
              ? <b>{shops.find((x) => x.id === activeShopId) ? dn(shops.find((x) => x.id === activeShopId)!) : "…"}</b>
              : <select className="shop-bar-select" value={localShopId} onChange={(e) => { setLocalShopId(e.target.value); setMsg(null); }}>
                  <option value="">{t("Select shop…")}</option>
                  {shops.map((x) => <option key={x.id} value={x.id}>{dn(x)}</option>)}
                </select>}
          </div>
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
                {stockPanel.map((s, idx) => (
                  <tr key={s.warehouseId} style={{ background: idx % 2 === 0 ? "var(--surface)" : "var(--bg)" }}>
                    <td className="px-3 py-1.5 text-sm">{warehouseById[s.warehouseId] ? dn(warehouseById[s.warehouseId]) : s.warehouseId}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-sm"
                        style={{ color: s.qty === 0 ? "#b4690e" : "var(--brand)" }}>{s.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <QuickCustomer open={newCust} onClose={() => setNewCust(false)} existing={customers}
        onCreated={(c) => { setCustomers((cs) => [...cs, c]); pickCustomer(c.id, c); }} />

      {demo && (
        <div className="note mb-4">
          {t("From demo invoice")} <b className="font-mono">{demo.code}</b> - {t("check the lines, then save the order.")}
          {demo.skipped.length > 0 && <div className="mt-1" style={{ color: "#b4690e" }}>{t("Not in the product list, add by hand")}: {demo.skipped.join(", ")}</div>}
        </div>
      )}

      {/* Header fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <div className={`field ${check.bad("customer")}`}>
          <label className="flex items-center justify-between"><span>{t("Customer")} <span className="req">*</span></span>
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
          <div className={`field ${check.bad("salesperson")}`}>
            <label>{t("Salesperson")} <span className="req">*</span></label>
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
                <th className="text-right" style={{ width: 90 }}>{t("Qty")}</th>
                <th className="text-right" style={{ width: 110 }}>{t("Unit price")}</th>
                <th className="text-right" style={{ width: 120 }}>{t("Gross total")}</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
                return (
                  <tr key={i} data-line={i} onKeyDown={(e) => lineEnter(e, i)}>
                    <td className="align-top">
                      <div className={check.bad(`product-${i}`)}><SearchSelect options={productOpts} value={l.productId}
                        onChange={(v) => selectProduct(i, v)} placeholder={t("Search name, code, supplier, mm…")} /></div>
                      <div className="h-4 mt-1" />
                    </td>
                    <td className="text-right align-top">
                      <input className={`inp text-right tabular-nums ${check.bad(`qty-${i}`)}`} style={{ width: 75, marginLeft: "auto" }}
                        type="number" min={0} value={l.qty}
                        onChange={(e) => update(i, { qty: e.target.value })} />
                      <div className="h-4 mt-1" />
                    </td>
                    <td className="text-right align-top">
                      <input className={`inp text-right tabular-nums ${check.bad(`price-${i}`)}`}
                        style={{ width: 96, marginLeft: "auto" }}
                        type="number" min={0} value={l.unitPrice}
                        onChange={(e) => update(i, { unitPrice: e.target.value })} />
                      <div className="h-4 mt-1" />
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
            const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
            return (
              <div key={i} data-line={i} onKeyDown={(e) => lineEnter(e, i)} className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs muted font-medium">{t("Product")}</span>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} title={t("Remove")}
                      className="text-[#9a2b22] hover:text-[#7a1c16] transition-colors">
                      <TrashIcon />
                    </button>
                  )}
                </div>
                <div className={check.bad(`product-${i}`)}><SearchSelect options={productOpts} value={l.productId}
                  onChange={(v) => selectProduct(i, v)} placeholder={t("Search name, code, supplier, mm…")} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs muted block mb-1">{t("Qty")}</label>
                    <input className={`inp text-right tabular-nums w-full ${check.bad(`qty-${i}`)}`} type="number" min={0}
                      value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs muted block mb-1">{t("Unit price")}</label>
                    <input className={`inp text-right tabular-nums w-full ${check.bad(`price-${i}`)}`}
                      type="number" min={0} value={l.unitPrice}
                      onChange={(e) => update(i, { unitPrice: e.target.value })} />
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
          <select className={`inp mt-1 ${check.bad("discountBy")}`} style={{ maxWidth: 320 }}
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
        <label className="text-xs muted">{t("Authoriser (required for over-limit credit)")}</label>
        <input className="inp mt-1" style={{ maxWidth: 320 }}
          placeholder={t("Manager / authority name")}
          value={overrideBy} onChange={(e) => setOverrideBy(e.target.value)} />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button className="btn w-full sm:w-auto shrink-0" onClick={submit} disabled={busy}>
          {busy ? t("Creating…") : t("Save order")}
        </button>
        <TopMessage msg={check.msg ?? msg} />
      </div>
    </div>
  );
}
