"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, type DeliveryChallan, type Customer } from "@/lib/api";

// Day-end consolidation (DC_FIRST workflow).
// Shows open (un-consolidated) challans grouped by customer. Pick a customer and
// roll their challans for today into ONE sales order / invoice — no new challan is
// created. Revenue posts here; COGS already posted at each challan's delivery.
export default function ConsolidatePage() {
  const [challans, setChallans] = useState<DeliveryChallan[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [customerId, setCustomerId] = useState("");
  const [paymentMode, setPaymentMode] = useState<"CASH" | "CREDIT">("CASH");
  const [overrideBy, setOverrideBy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    endpoints.openChallans().then(setChallans).catch(() => {});
  }
  useEffect(() => {
    load();
    endpoints.customers().then((c) => setCustomers(Object.fromEntries(c.map((x) => [x.id, x])))).catch(() => {});
  }, []);

  // group open challans by customer
  const byCustomer = useMemo(() => {
    const m: Record<string, DeliveryChallan[]> = {};
    for (const dc of challans) (m[dc.customerId] ??= []).push(dc);
    return m;
  }, [challans]);

  const customerIds = Object.keys(byCustomer);

  async function submit() {
    setMsg(null);
    if (!customerId) { setMsg({ kind: "err", text: "Select a customer to consolidate." }); return; }
    setBusy(true);
    try {
      const r: any = await endpoints.consolidate({ customerId, paymentMode, creditOverrideBy: overrideBy || null });
      setMsg({ kind: "ok", text: `Invoice ${r.soNo} created from ${r.challanIds.length} challan(s) · total ${Number(r.totalValue).toFixed(2)}` });
      setCustomerId(""); setOverrideBy("");
      load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="text-2xl font-medium mb-1">Day-end consolidate</h1>
      <p className="text-sm text-[#6b6960] mb-6">
        Roll a customer&apos;s open challans into a single invoice. Choose cash or credit — credit is checked
        against the party&apos;s limit. No new challan is generated.
      </p>

      <div className="border border-line rounded-xl bg-white overflow-hidden mb-6">
        <div className="px-4 py-2 text-sm font-medium border-b border-line">Open challans by customer</div>
        <table className="tbl">
          <thead><tr><th></th><th>Customer</th><th className="text-right">Open challans</th></tr></thead>
          <tbody>
            {customerIds.length === 0 && <tr><td colSpan={3} className="text-[#6b6960]">No open challans to consolidate.</td></tr>}
            {customerIds.map((cid) => (
              <tr key={cid} className="cursor-pointer" onClick={() => setCustomerId(cid)}
                  style={{ background: customerId === cid ? "#e6efe9" : undefined }}>
                <td><input type="radio" checked={customerId === cid} onChange={() => setCustomerId(cid)} /></td>
                <td>{customers[cid]?.name ?? cid}
                    {customers[cid] && <span className="text-xs text-[#6b6960] ml-2">({customers[cid].type})</span>}</td>
                <td className="text-right tabular-nums">{byCustomer[cid].length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {customerId && (
        <div className="flex items-end gap-3 mb-4">
          <div>
            <label className="text-xs text-[#6b6960]">Payment</label>
            <select className="inp mt-1" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as "CASH" | "CREDIT")}>
              <option value="CASH">Cash</option><option value="CREDIT">Credit (party)</option>
            </select>
          </div>
          {paymentMode === "CREDIT" && (
            <div className="flex-1">
              <label className="text-xs text-[#6b6960]">Authoriser (if over credit limit)</label>
              <input className="inp mt-1" style={{ maxWidth: 280 }} value={overrideBy} onChange={(e) => setOverrideBy(e.target.value)} />
            </div>
          )}
          <button className="btn" onClick={submit} disabled={busy}>{busy ? "Consolidating…" : "Consolidate to invoice"}</button>
        </div>
      )}

      {msg && (
        <div className="mt-2 text-sm rounded-lg px-4 py-3"
             style={{ background: msg.kind === "ok" ? "#e6efe9" : "#fbeceb", color: msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
