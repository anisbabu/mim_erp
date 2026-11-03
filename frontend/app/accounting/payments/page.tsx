"use client";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { endpoints, fmtDate, type Supplier, type Customer, type PaymentRow } from "@/lib/api";

type Dir = "IN" | "OUT";
const money = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PaymentsPage() {
  const { t, dn, lang } = useI18n();
  const [tab, setTab] = useState<Dir>("IN");                 // IN = receipt from customer, OUT = payment to supplier
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "BANK">("CASH");
  const [note, setNote] = useState("");
  const [bankAcc, setBankAcc] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const isPay = tab === "OUT";

  useEffect(() => {
    endpoints.suppliers().then(setSuppliers).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
  }, []);

  function loadList(dir: Dir) {
    setLoading(true);
    endpoints.paymentList(dir).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }
  useEffect(() => { setRows([]); setQ(""); setPartyId(""); setMsg(null); loadList(tab); }, [tab]);

  const partyOpts: Option[] = useMemo(
    () => (isPay ? suppliers : customers).map((x: any) => ({ value: x.id, label: dn(x), sublabel: x.code })),
    [isPay, suppliers, customers, dn]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.payment_no, r.party_code, r.party_name, r.party_name_bn, r.note, r.method]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(s)));
  }, [rows, q]);
  const total = shown.reduce((s, r) => s + Number(r.amount), 0);

  async function submit() {
    setMsg(null);
    if (!partyId || !(Number(amount) > 0)) { setMsg({ kind: "err", text: t("Select a party and enter an amount.") }); return; }
    if (method === "BANK" && !bankAcc.trim()) { setMsg({ kind: "err", text: t("Enter the bank account number.") }); return; }
    setBusy(true);
    try {
      const p: any = await endpoints.payment({
        direction: tab, partyType: isPay ? "SUPPLIER" : "CUSTOMER",
        partyId, amount: Number(amount), method, note,
        bankAccountNo: method === "BANK" ? bankAcc.trim() : undefined,
        bankBranch: method === "BANK" ? bankBranch.trim() : undefined,
      });
      setMsg({ kind: "ok", text: `${isPay ? t("Payment") : t("Receipt")} ${p.paymentNo} ${t("recorded.")}` });
      setAmount(""); setNote(""); setPartyId(""); setBankAcc(""); setBankBranch("");
      loadList(tab);
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  const pname = (r: PaymentRow) => (lang === "bn" && r.party_name_bn ? r.party_name_bn : r.party_name) ?? "—";

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Transactions"]} title={t("Receipts & payments")}
        subtitle={t("Receive from a customer to settle receivables, or pay a supplier to settle payables. Each posts a balanced entry.")} />

      <div className="flex flex-wrap gap-2 mb-4">
        <button className={tab === "IN" ? "btn" : "btn-ghost"} onClick={() => setTab("IN")}>{t("Receive from customer")}</button>
        <button className={tab === "OUT" ? "btn" : "btn-ghost"} onClick={() => setTab("OUT")}>{t("Pay supplier")}</button>
      </div>

      {/* entry */}
      <div className="card p-5 mb-6">
        <div className="section-label mb-3">{isPay ? t("New payment") : t("New receipt")}</div>
        <div className="form-grid cols-4">
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>{isPay ? t("Supplier") : t("Customer")} *</label>
            <SearchSelect options={partyOpts} value={partyId} onChange={setPartyId} placeholder={t("Select…")} />
          </div>
          <div className="field"><label>{t("Amount")} *</label>
            <input className="inp num" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="field"><label>{t("Method")}</label>
            <select className="inp" value={method} onChange={(e) => setMethod(e.target.value as "CASH" | "BANK")}>
              <option value="CASH">{t("Cash")}</option><option value="BANK">{t("Bank")}</option>
            </select></div>
          {method === "BANK" && (<>
            <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Bank account number")} *</label>
              <input className="inp" value={bankAcc} onChange={(e) => setBankAcc(e.target.value)} /></div>
            <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Bank branch")}</label>
              <input className="inp" value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} /></div>
          </>)}
          <div className="field" style={{ gridColumn: "span 4" }}><label>{t("Note (optional)")}</label>
            <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? t("Recording…") : isPay ? t("Record payment") : t("Record receipt")}
          </button>
          <span className="text-[12px] muted">
            {isPay ? t("Dr Supplier ledger · Cr Cash / Bank") : t("Dr Cash / Bank · Cr Customer ledger")}
          </span>
        </div>
        {msg && <div className={`note mt-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}
      </div>

      {/* history */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="section-label">{isPay ? t("Past payments") : t("Past receipts")}</div>
        <div className="flex-1" />
        <input className="inp" style={{ maxWidth: 260 }} placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 760 }}>
          <thead><tr>
            <th style={{ textAlign: "left" }}>{t("No.")}</th>
            <th style={{ textAlign: "left" }}>{t("Date")}</th>
            <th style={{ textAlign: "left" }}>{isPay ? t("Supplier") : t("Customer")}</th>
            <th style={{ textAlign: "left" }}>{t("Method")}</th>
            <th style={{ textAlign: "left" }}>{t("Note")}</th>
            <th style={{ textAlign: "right" }}>{t("Amount")}</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-[13px]">{r.payment_no}</td>
                <td>{fmtDate(r.payment_date)}</td>
                <td>{pname(r)}{r.party_code && <span className="chip ml-2 bg-slate-100 text-slate-500">{r.party_code}</span>}</td>
                <td><span className="chip bg-slate-100 text-slate-600">{r.method === "BANK" ? t("Bank") : t("Cash")}</span>
                  {r.method === "BANK" && r.bank_account_no && <div className="text-[12px] muted mt-1">{r.bank_account_no}{r.bank_branch ? ` · ${r.bank_branch}` : ""}</div>}</td>
                <td className="muted">{r.note ?? ""}</td>
                <td className="num font-medium">{money(r.amount)}</td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={6} className="muted text-sm" style={{ padding: 20 }}>
                {isPay ? t("No payments yet.") : t("No receipts yet.")}</td></tr>
            )}
            {loading && <tr><td colSpan={6} className="muted text-sm" style={{ padding: 20 }}>{t("Loading…")}</td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot><tr>
              <td colSpan={5} className="text-right font-medium">{t("Total")} ({shown.length})</td>
              <td className="num font-semibold">{money(total)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
