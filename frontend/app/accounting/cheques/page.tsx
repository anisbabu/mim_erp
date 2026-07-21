"use client";
import { useEffect, useState } from "react";
import { endpoints, fmtDate, type Customer, type Cheque } from "@/lib/api";

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function urgency(days: number): { bg: string; fg: string; label: string } {
  if (days < 0) return { bg: "#fbeceb", fg: "#9a2b22", label: "Overdue" };
  if (days === 0) return { bg: "#fbeceb", fg: "#9a2b22", label: "Due today" };
  if (days <= 7) return { bg: "#fdf0d5", fg: "#8a5a00", label: `Due in ${days}d` };
  return { bg: "#eef0ec", fg: "#5c5a52", label: `Due in ${days}d` };
}

const STATUS_STYLE: Record<Cheque["status"], { bg: string; fg: string }> = {
  PENDING: { bg: "#eef0ec", fg: "#5c5a52" },
  CLEARED: { bg: "#e6efe9", fg: "#1d5e4f" },
  BOUNCED: { bg: "#fbeceb", fg: "#9a2b22" },
};

export default function ChequesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    endpoints.cheques().then(setCheques).catch(() => {});
  }

  useEffect(() => {
    endpoints.customers().then(setCustomers).catch(() => {});
    load();
  }, []);

  const customerName = (id: string) => customers.find((c) => c.id === id)?.name ?? "—";

  async function submit() {
    setMsg(null);
    if (!customerId || !(Number(amount) > 0) || !chequeNo || !maturityDate) {
      setMsg({ kind: "err", text: "Customer, amount, cheque no. and maturity date are required." }); return;
    }
    setBusy(true);
    try {
      await endpoints.recordCheque({
        customerId, amount: Number(amount), chequeNo, bankName, maturityDate, note,
      });
      setMsg({ kind: "ok", text: `Cheque ${chequeNo} recorded.` });
      setAmount(""); setChequeNo(""); setBankName(""); setMaturityDate(""); setNote("");
      load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  async function act(id: string, action: "clear" | "bounce") {
    setMsg(null);
    try {
      action === "clear" ? await endpoints.clearCheque(id) : await endpoints.bounceCheque(id);
      load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  return (
    <div>
      <h1 className="page-title mb-1">Cheques received</h1>
      <p className="text-sm text-[#6b6960] mb-6">
        Record a customer cheque and track it to maturity. Cheques due soonest are listed first.
      </p>

      <div className="max-w-lg space-y-4 mb-8">
        <div>
          <label className="text-xs text-[#6b6960]">Customer</label>
          <select className="inp mt-1" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#6b6960]">Amount</label>
            <input className="inp mt-1 text-right tabular-nums" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#6b6960]">Maturity date</label>
            <input className="inp mt-1" type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#6b6960]">Cheque no.</label>
            <input className="inp mt-1" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#6b6960]">Bank</label>
            <input className="inp mt-1" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">Note (optional)</label>
          <input className="inp mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? "Recording…" : "Record cheque"}</button>
      </div>

      {msg && (
        <div className="max-w-lg mb-6 text-sm rounded-lg px-4 py-3"
             style={{ background: msg.kind === "ok" ? "#e6efe9" : "#fbeceb", color: msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>
          {msg.text}
        </div>
      )}

      <div className="section-label mb-2">All cheques</div>
      <div className="table-wrap card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Maturity</th><th>Customer</th><th>Cheque no.</th><th>Bank</th>
              <th>Amount</th><th>Received</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {cheques.map((c) => {
              const days = daysUntil(c.maturityDate);
              const u = c.status === "PENDING" ? urgency(days) : null;
              const s = STATUS_STYLE[c.status];
              return (
                <tr key={c.id}>
                  <td>
                    {fmtDate(c.maturityDate)}
                    {u && (
                      <span className="chip ml-2" style={{ background: u.bg, color: u.fg }}>{u.label}</span>
                    )}
                  </td>
                  <td>{customerName(c.customerId)}</td>
                  <td>{c.chequeNo}</td>
                  <td>{c.bankName || "—"}</td>
                  <td className="text-right tabular-nums">{c.amount.toLocaleString()}</td>
                  <td>{fmtDate(c.receiveDate)}</td>
                  <td><span className="chip" style={{ background: s.bg, color: s.fg }}>{c.status}</span></td>
                  <td className="whitespace-nowrap">
                    {c.status === "PENDING" && (
                      <>
                        <button className="btn-ghost text-xs mr-1" onClick={() => act(c.id, "clear")}>Clear</button>
                        <button className="btn-ghost text-xs" onClick={() => act(c.id, "bounce")}>Bounce</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {cheques.length === 0 && (
              <tr><td colSpan={8} className="text-center text-[#6b6960] py-6">No cheques recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
