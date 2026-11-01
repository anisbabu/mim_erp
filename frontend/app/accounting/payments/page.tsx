"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { endpoints, type Supplier, type Customer } from "@/lib/api";

export default function PaymentsPage() {
  const { t, dn } = useI18n();
  const [direction, setDirection] = useState<"OUT" | "IN">("OUT");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "BANK">("CASH");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.suppliers().then(setSuppliers).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
  }, []);

  const isPay = direction === "OUT";

  async function submit() {
    setMsg(null);
    if (!partyId || !(Number(amount) > 0)) { setMsg({ kind: "err", text: t("Select a party and enter an amount.") }); return; }
    setBusy(true);
    try {
      const p: any = await endpoints.payment({
        direction, partyType: isPay ? "SUPPLIER" : "CUSTOMER",
        partyId, amount: Number(amount), method, note,
      });
      setMsg({ kind: "ok", text: `${isPay ? t("Payment") : t("Receipt")} ${p.paymentNo} ${t("recorded.")}` });
      setAmount(""); setNote("");
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-lg">
      <h1 className="page-title mb-1">{t("Payments & receipts")}</h1>
      <p className="text-sm text-[#6b6960] mb-6">
        {t("Pay a supplier to settle payables, or receive from a customer to settle receivables. Each posts a balanced entry.")}
      </p>
      <div className="flex gap-1 mb-5 text-sm">
        {(["OUT", "IN"] as const).map((d) => (
          <button key={d} onClick={() => { setDirection(d); setPartyId(""); }}
            className="px-3 py-1.5 rounded-lg" style={{ background: direction === d ? "#1d5e4f" : "#fff",
              color: direction === d ? "#fff" : "#1c1b19", border: "1px solid #d8d4ca" }}>
            {d === "OUT" ? t("Pay supplier") : t("Receive from customer")}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs text-[#6b6960]">{isPay ? t("Supplier") : t("Customer")}</label>
          <select className="inp mt-1" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">{t("Select…")}</option>
            {(isPay ? suppliers : customers).map((x) => <option key={x.id} value={x.id}>{dn(x)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#6b6960]">{t("Amount")}</label>
            <input className="inp mt-1 text-right tabular-nums" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#6b6960]">{t("Method")}</label>
            <select className="inp mt-1" value={method} onChange={(e) => setMethod(e.target.value as "CASH" | "BANK")}>
              <option value="CASH">{t("Cash")}</option><option value="BANK">{t("Bank")}</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">{t("Note (optional)")}</label>
          <input className="inp mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="btn" onClick={submit} disabled={busy}>
          {busy ? t("Recording…") : isPay ? t("Record payment") : t("Record receipt")}
        </button>
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
