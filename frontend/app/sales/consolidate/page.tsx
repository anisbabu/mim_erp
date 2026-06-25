"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, type DeliveryChallan, type Customer, type ChallanLineView, type UserView, type Warehouse } from "@/lib/api";

type LineEdit = { unitPrice: string };

function bandStatus(l: ChallanLineView, edit: LineEdit): "out" | "ok" | "none" {
  const price = Number(edit.unitPrice);
  if (!price) return "none";
  if (l.priceLower == null && l.priceUpper == null) return "none";
  if (l.priceLower != null && price < l.priceLower) return "out";
  if (l.priceUpper != null && price > l.priceUpper) return "out";
  return "ok";
}

export default function ConsolidatePage() {
  const [challans, setChallans]   = useState<DeliveryChallan[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [warehouseById, setWarehouseById] = useState<Record<string, Warehouse>>({});
  const [authorisers, setAuthorisers] = useState<UserView[]>([]);
  const [customerId, setCustomerId]   = useState("");
  const [paymentMode, setPaymentMode] = useState<"CASH" | "CREDIT">("CASH");
  const [overrideBy, setOverrideBy]   = useState("");
  const [discount, setDiscount]       = useState("");
  const [transport, setTransport]     = useState("");
  const [lines, setLines]             = useState<ChallanLineView[]>([]);
  const [edits, setEdits]             = useState<Record<string, LineEdit>>({});
  const [linesLoading, setLinesLoading] = useState(false);
  const [msg, setMsg]   = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function loadChallans() {
    endpoints.openChallans().then(setChallans).catch(() => {});
  }
  useEffect(() => {
    loadChallans();
    endpoints.warehouses()
      .then((ws) => setWarehouseById(Object.fromEntries(ws.map((w) => [w.id, w]))))
      .catch(() => {});
    endpoints.customers()
      .then((c) => setCustomers(Object.fromEntries(c.map((x) => [x.id, x]))))
      .catch(() => {});
    endpoints.users()
      .then((u) => setAuthorisers(u.filter((x) => x.active && (x.role === "MANAGER" || x.role === "ADMIN"))))
      .catch(() => {});
  }, []);

  async function selectCustomer(cid: string) {
    setCustomerId(cid);
    setLines([]); setEdits([]); setMsg(null);
    if (!cid) return;
    setLinesLoading(true);
    try {
      const ls = await endpoints.openChallanLines(cid);
      setLines(ls);
      const init: Record<string, LineEdit> = {};
      for (const l of ls) init[l.dcLineId] = { unitPrice: String(l.unitPrice) };
      setEdits(init);
    } catch { setLines([]); }
    finally { setLinesLoading(false); }
  }

  function updateEdit(dcLineId: string, patch: Partial<LineEdit>) {
    setEdits((e) => ({ ...e, [dcLineId]: { ...e[dcLineId], ...patch } }));
  }

  const byCustomer = useMemo(() => {
    const m: Record<string, DeliveryChallan[]> = {};
    for (const dc of challans) (m[dc.customerId] ??= []).push(dc);
    return m;
  }, [challans]);

  const grouped = useMemo(() => {
    const m: Record<string, ChallanLineView[]> = {};
    for (const l of lines) (m[l.dcNo] ??= []).push(l);
    return m;
  }, [lines]);

  const anyOut = lines.some((l) => bandStatus(l, edits[l.dcLineId] ?? { unitPrice: String(l.unitPrice) }) === "out");

  const grandGross = lines.reduce((s, l) => {
    const e = edits[l.dcLineId];
    return s + l.qty * Number(e?.unitPrice ?? l.unitPrice);
  }, 0);
  const totalDiscount = Math.min(Number(discount) || 0, grandGross);
  const totalTransport = Number(transport) || 0;
  const netTotal = grandGross - totalDiscount + totalTransport;

  async function submit() {
    setMsg(null);
    if (!customerId) { setMsg({ kind: "err", text: "Select a customer." }); return; }
    if (anyOut && !overrideBy.trim()) {
      setMsg({ kind: "err", text: "Price out of band — enter authoriser name." }); return;
    }
    setBusy(true);
    try {
      const r: any = await endpoints.consolidate({
        customerId, paymentMode,
        creditOverrideBy: overrideBy || null,
        priceOverrideBy:  anyOut ? overrideBy : null,
        discountBy:       totalDiscount > 0 ? (overrideBy || null) : null,
        transportAndLifting: totalTransport || null,
        lineOverrides: lines.map((l) => {
          const lineGross = l.qty * Number(edits[l.dcLineId]?.unitPrice ?? l.unitPrice);
          const lineDisc  = grandGross > 0 ? (lineGross / grandGross) * totalDiscount : 0;
          return {
            dcLineId:    l.dcLineId,
            unitPrice:   Number(edits[l.dcLineId]?.unitPrice ?? l.unitPrice),
            discountAmt: Math.round(lineDisc * 100) / 100,
          };
        }),
      });
      setMsg({ kind: "ok", text: `Invoice ${r.soNo} · ${r.challanIds.length} challan(s) · net ${Number(r.totalValue).toFixed(2)}` });
      setCustomerId(""); setLines([]); setEdits({}); setOverrideBy(""); setDiscount(""); setTransport("");
      loadChallans();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="page-title mb-5">Day-end consolidate</h1>

      {/* Customer picker */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-2 text-xs font-semibold muted border-b border-[var(--border)] uppercase tracking-wide">
          Open challans by customer
        </div>
        <table className="tbl w-full">
          <thead><tr><th></th><th>Customer</th><th className="text-right">Open challans</th></tr></thead>
          <tbody>
            {Object.keys(byCustomer).length === 0 && (
              <tr><td colSpan={3} className="muted">No open challans.</td></tr>
            )}
            {Object.keys(byCustomer).map((cid) => (
              <tr key={cid} className="cursor-pointer" onClick={() => selectCustomer(cid)}
                style={{ background: customerId === cid ? "var(--brand-muted, #e6efe9)" : undefined }}>
                <td><input type="radio" readOnly checked={customerId === cid} /></td>
                <td>
                  {customers[cid]?.name ?? cid}
                  {customers[cid] && <span className="text-xs muted ml-2">({customers[cid].type})</span>}
                </td>
                <td className="text-right tabular-nums">{byCustomer[cid].length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Line review form */}
      {customerId && (
        <>
          {linesLoading && <div className="muted text-sm mb-4">Loading lines…</div>}

          {!linesLoading && lines.length > 0 && (
            <div className="card overflow-hidden mb-4">
              <div className="px-4 py-2 text-xs font-semibold muted border-b border-[var(--border)] uppercase tracking-wide">
                Review &amp; edit lines before invoicing
              </div>
              <div className="overflow-x-auto">
                <table className="tbl w-full">
                  <thead>
                    <tr>
                      <th>Challan</th>
                      <th>Product</th>
                      <th style={{ width: 130 }}>Warehouse</th>
                      <th className="text-right" style={{ width: 70 }}>Qty</th>
                      <th className="text-right" style={{ width: 120 }}>Unit price</th>
                      <th className="text-right" style={{ width: 110 }}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(grouped).map(([dcNo, dcLines]) =>
                      dcLines.map((l, idx) => {
                        const e = edits[l.dcLineId] ?? { unitPrice: String(l.unitPrice) };
                        const band = bandStatus(l, e);
                        const hasBand = l.priceLower != null || l.priceUpper != null;
                        const gross = l.qty * Number(e.unitPrice);
                        return (
                          <tr key={l.dcLineId}>
                            {idx === 0 && (
                              <td rowSpan={dcLines.length}
                                className="text-xs font-mono font-semibold muted align-top pt-3">
                                {dcNo}
                              </td>
                            )}
                            <td className="align-top">
                              <div className="text-sm">{l.productName}</div>
                              <div className="text-[11px] mt-0.5 h-4 leading-4"
                                style={{ color: band === "out" ? "#b3261e" : "var(--muted)" }}>
                                {hasBand
                                  ? `band ${l.priceLower ?? "—"}–${l.priceUpper ?? "—"}${band === "out" ? " · out of band" : ""}`
                                  : "no band"}
                              </div>
                            </td>
                            <td className="align-top pt-1 text-sm">
                              {l.warehouseId ? (warehouseById[l.warehouseId]?.name ?? "—") : "—"}
                            </td>
                            <td className="text-right tabular-nums align-top pt-1">{l.qty}</td>
                            <td className="text-right align-top">
                              <input className="inp text-right tabular-nums"
                                style={{ width: 100, marginLeft: "auto", borderColor: band === "out" ? "#b3261e" : undefined }}
                                type="number" min={0} value={e.unitPrice}
                                onChange={(ev) => updateEdit(l.dcLineId, { unitPrice: ev.target.value })} />
                              <div className="h-4 mt-0.5" />
                            </td>
                            <td className="text-right tabular-nums align-top pt-1 font-medium">
                              {gross.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="text-right text-sm muted">Gross</td>
                      <td colSpan={2} className="text-right tabular-nums muted">{grandGross.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td colSpan={4} className="text-right text-sm muted">Discount</td>
                      <td colSpan={2} className="text-right">
                        <input className="inp text-right tabular-nums"
                          style={{ width: 100, marginLeft: "auto" }}
                          type="number" min={0} max={grandGross} placeholder="0"
                          value={discount}
                          onChange={(e) => setDiscount(e.target.value)} />
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={4} className="text-right text-sm muted">Transport &amp; Lifting</td>
                      <td colSpan={2} className="text-right">
                        <input className="inp text-right tabular-nums"
                          style={{ width: 100, marginLeft: "auto" }}
                          type="number" min={0} placeholder="0"
                          value={transport}
                          onChange={(e) => setTransport(e.target.value)} />
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={4} className="text-right font-semibold">Net total</td>
                      <td colSpan={2} className="text-right tabular-nums font-bold text-base" style={{ color: "#0f766e" }}>
                        {netTotal.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Payment + authorisers + submit */}
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <div className="field">
              <label>Payment</label>
              <select className="inp mt-1" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as "CASH" | "CREDIT")}>
                <option value="CASH">Cash</option>
                <option value="CREDIT">Credit (party)</option>
              </select>
            </div>
            {(anyOut || paymentMode === "CREDIT") && (
              <div className="field flex-1" style={{ minWidth: 200 }}>
                <label>Authoriser {anyOut ? "(price out of band)" : "(credit limit)"}</label>
                <select className="inp mt-1" value={overrideBy} onChange={(e) => setOverrideBy(e.target.value)}
                  style={{ borderColor: (anyOut || paymentMode === "CREDIT") && !overrideBy ? "#b3261e" : undefined }}>
                  <option value="">Select…</option>
                  {authorisers.map((u) => (
                    <option key={u.id} value={u.fullName || u.username}>{u.fullName || u.username} ({u.role})</option>
                  ))}
                </select>
              </div>
            )}
            <button className="btn" onClick={submit} disabled={busy || linesLoading}>
              {busy ? "Consolidating…" : "Consolidate to invoice"}
            </button>
          </div>
        </>
      )}

      {msg && (
        <div className="mt-2 text-sm rounded-lg px-4 py-3"
          style={{ background: msg.kind === "ok" ? "#e6efe9" : "#fbeceb",
                   color:      msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}