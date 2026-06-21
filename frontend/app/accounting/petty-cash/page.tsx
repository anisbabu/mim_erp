"use client";
import { useEffect, useState } from "react";
import { endpoints, type Shop, type Account } from "@/lib/api";

export default function PettyCashPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [shopId, setShopId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.shops().then(setShops).catch(() => {});
    endpoints.accounts().then((a) => setAccounts(a.filter((x) => x.type === "EXPENSE"))).catch(() => {});
  }, []);

  async function submit() {
    setMsg(null);
    if (!shopId || !expenseAccountId || !(Number(amount) > 0)) {
      setMsg({ kind: "err", text: "Shop, expense account and amount are required." }); return;
    }
    setBusy(true);
    try {
      const v: any = await endpoints.pettyCash({ shopId, expenseAccountId, amount: Number(amount), description });
      setMsg({ kind: "ok", text: `Voucher ${v.voucherNo} posted (Dr expense / Cr petty cash).` });
      setAmount(""); setDescription("");
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-lg">
      <h1 className="page-title mb-1">Petty cash voucher</h1>
      <p className="text-sm text-[#6b6960] mb-6">Record a small shop expense paid from the petty-cash float (imprest system).</p>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-[#6b6960]">Shop</label>
          <select className="inp mt-1" value={shopId} onChange={(e) => setShopId(e.target.value)}>
            <option value="">Select shop…</option>
            {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">Expense account</label>
          <select className="inp mt-1" value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}>
            <option value="">Select…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">Amount</label>
          <input className="inp mt-1 text-right tabular-nums" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">Description</label>
          <input className="inp mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? "Posting…" : "Post voucher"}</button>
      </div>
      {msg && (
        <div className="mt-4 text-sm rounded-lg px-4 py-3"
             style={{ background: msg.kind === "ok" ? "#e6efe9" : "#fbeceb", color: msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
