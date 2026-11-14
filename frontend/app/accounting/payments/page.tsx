"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { endpoints, fmtDate, type Supplier, type Customer, type PaymentRow, type PartyOpenItems, type Account } from "@/lib/api";

type Dir = "IN" | "OUT";
const money = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

export default function PaymentsPage() {
  const { t, dn, lang } = useI18n();
  const [tab, setTab] = useState<Dir>("IN");                 // IN = receipt from customer, OUT = payment to supplier
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [banks, setBanks] = useState<Account[]>([]);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const [partyId, setPartyId] = useState("");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [ait, setAit] = useState("");   // income tax deducted at source
  const [vds, setVds] = useState("");   // VAT deducted at source
  const [method, setMethod] = useState<"CASH" | "BANK">("CASH");
  const [bankLedger, setBankLedger] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [bankAcc, setBankAcc] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [items, setItems] = useState<PartyOpenItems | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});   // billId -> amount; all empty = oldest first
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; id?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const isPay = tab === "OUT";
  const partyType = isPay ? "SUPPLIER" : "CUSTOMER";

  useEffect(() => {
    endpoints.suppliers().then(setSuppliers).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
    endpoints.chequeBankAccounts().then((b) => { setBanks(b); if (b[0]) setBankLedger(b[0].code); }).catch(() => {});
  }, []);

  function loadList(dir: Dir) {
    setLoading(true);
    endpoints.paymentList(dir).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }
  useEffect(() => { setRows([]); setQ(""); setPartyId(""); setMsg(null); loadList(tab); }, [tab]);

  function loadItems(id: string) {
    setAlloc({});
    if (!id) { setItems(null); return; }
    endpoints.partyOpenItems(partyType, id).then(setItems).catch(() => setItems(null));
  }
  useEffect(() => { loadItems(partyId); }, [partyId, tab]);   // eslint-disable-line react-hooks/exhaustive-deps

  const partyOpts: Option[] = useMemo(
    () => (isPay ? suppliers : customers).map((x: any) => ({ value: x.id, label: dn(x), sublabel: x.code })),
    [isPay, suppliers, customers, dn]);

  // what the party ledger is cleared by: cash + discount + tax deducted at source
  const settles = r2((Number(amount) || 0) + (Number(discount) || 0) + (Number(ait) || 0) + (Number(vds) || 0));
  const picked = Object.values(alloc).some((v) => v !== "" && Number(v) > 0);
  const allocated = r2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));

  /** What each bill would get: the user's picks, else oldest-first preview. */
  const preview: Record<string, number> = useMemo(() => {
    const out: Record<string, number> = {};
    if (!items) return out;
    if (picked) { for (const b of items.bills) out[b.id] = Number(alloc[b.id]) || 0; return out; }
    let left = settles;
    for (const b of items.bills) { const take = Math.min(left, Number(b.open)); out[b.id] = r2(Math.max(0, take)); left = r2(left - take); }
    return out;
  }, [items, alloc, picked, settles]);
  const previewTotal = r2(Object.values(preview).reduce((s, v) => s + v, 0));
  const advance = r2(settles - previewTotal);
  const allocErr = picked && allocated > settles ? t("Allocated more than the voucher amount.") : null;

  function autoFill() {
    if (!items) return;
    let left = settles; const next: Record<string, string> = {};
    for (const b of items.bills) { const take = r2(Math.min(left, Number(b.open))); if (take > 0) next[b.id] = String(take); left = r2(left - take); }
    setAlloc(next);
  }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.voucher_no, r.payment_no, r.party_code, r.party_name, r.party_name_bn, r.note, r.reference, r.method]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(s)));
  }, [rows, q]);
  const total = shown.reduce((s, r) => s + Number(r.amount), 0);

  async function printVoucher(id: string, l: "en" | "bn") {
    try { window.open(URL.createObjectURL(await endpoints.voucherPdf(id, l)), "_blank"); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  async function submit() {
    setMsg(null);
    if (!partyId || !(Number(amount) > 0)) { setMsg({ kind: "err", text: t("Select a party and enter an amount.") }); return; }
    if (method === "BANK" && !bankAcc.trim()) { setMsg({ kind: "err", text: t("Enter the bank account number.") }); return; }
    if (allocErr) { setMsg({ kind: "err", text: allocErr }); return; }
    setBusy(true);
    try {
      const allocations = picked
        ? Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([billId, v]) => ({ billId, amount: Number(v) }))
        : undefined;
      const p: any = await endpoints.payment({
        direction: tab, partyType, partyId, date, amount: Number(amount),
        discount: Number(discount) || 0, ait: Number(ait) || 0, vds: Number(vds) || 0,
        method, note, reference: reference.trim() || undefined,
        cashAccount: method === "BANK" ? bankLedger || undefined : undefined,
        bankAccountNo: method === "BANK" ? bankAcc.trim() : undefined,
        bankBranch: method === "BANK" ? bankBranch.trim() : undefined,
        allocations,
      });
      if (p.pending) setMsg({ kind: "ok", text: `${t("Above the approval limit — sent for approval as")} ${p.requestNo}.` });
      else setMsg({ kind: "ok", text: `${isPay ? t("Payment") : t("Receipt")} ${p.voucherNo ?? p.paymentNo} ${t("recorded.")}`, id: p.id });
      setAmount(""); setDiscount(""); setAit(""); setVds(""); setNote(""); setReference(""); setBankAcc(""); setBankBranch("");
      loadItems(partyId);
      loadList(tab);
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  const pname = (r: PaymentRow) => (lang === "bn" && r.party_name_bn ? r.party_name_bn : r.party_name) ?? "—";

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Transactions"]} title={t("Receipts & payments")}
        subtitle={t("Receipt and payment vouchers, settled bill-wise against the party's open bills.")}
        actions={<Link className="btn-ghost" href="/accounting/party-statement">{t("Party statement")}</Link>} />

      <div className="flex flex-wrap gap-2 mb-4">
        <button className={tab === "IN" ? "btn" : "btn-ghost"} onClick={() => setTab("IN")}>{t("Receive from customer")}</button>
        <button className={tab === "OUT" ? "btn" : "btn-ghost"} onClick={() => setTab("OUT")}>{t("Pay supplier")}</button>
      </div>

      {/* entry */}
      <div className="card p-5 mb-6">
        <div className="section-label mb-3">{isPay ? t("New payment voucher") : t("New receipt voucher")}</div>
        <div className="form-grid cols-4">
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>{isPay ? t("Supplier") : t("Customer")} *</label>
            <SearchSelect options={partyOpts} value={partyId} onChange={setPartyId} placeholder={t("Select…")} />
            <div className="h-4 leading-4 text-[12px] muted">
              {items && <>{isPay ? t("Payable") : t("Receivable")}: <b>{money(items.balance)}</b>
                {items.advanceTotal > 0 && <> · {t("Advance")}: {money(items.advanceTotal)}</>}</>}
            </div>
          </div>
          <div className="field"><label>{t("Date")} *</label>
            <input className="inp" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            <div className="h-4 leading-4" /></div>
          <div className="field"><label>{t("Method")}</label>
            <select className="inp" value={method} onChange={(e) => setMethod(e.target.value as "CASH" | "BANK")}>
              <option value="CASH">{t("Cash")}</option><option value="BANK">{t("Bank")}</option>
            </select><div className="h-4 leading-4" /></div>
          <div className="field"><label>{t("Amount")} *</label>
            <input className="inp num" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="field"><label>{isPay ? t("Discount received") : t("Discount allowed")}</label>
            <input className="inp num" type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          <div className="field"><label>{isPay ? t("AIT deducted at source") : t("AIT deducted by customer")}</label>
            <input className="inp num" type="number" min={0} value={ait} onChange={(e) => setAit(e.target.value)} />
            <div className="h-4 leading-4 text-[11px] muted">{isPay ? t("Owed to NBR (2120)") : t("Advance tax credit (1460)")}</div></div>
          <div className="field"><label>{isPay ? t("VAT deducted at source") : t("VAT deducted by customer")}</label>
            <input className="inp num" type="number" min={0} value={vds} onChange={(e) => setVds(e.target.value)} />
            <div className="h-4 leading-4 text-[11px] muted">{isPay ? t("Owed to NBR (2110)") : t("Credit against our VAT (1470)")}</div></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Reference")}</label>
            <input className="inp" placeholder={isPay ? t("Supplier bill / money receipt no.") : t("Money receipt no.")}
              value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          {method === "BANK" && (<>
            <div className="field"><label>{t("Bank ledger")}</label>
              <select className="inp" value={bankLedger} onChange={(e) => setBankLedger(e.target.value)}>
                {banks.map((b) => <option key={b.id} value={b.code}>{dn(b as any)} ({b.code})</option>)}
              </select></div>
            <div className="field"><label>{t("Bank account number")} *</label>
              <input className="inp" value={bankAcc} onChange={(e) => setBankAcc(e.target.value)} /></div>
            <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Bank branch")}</label>
              <input className="inp" value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} /></div>
          </>)}
          <div className="field" style={{ gridColumn: "span 4" }}><label>{t("Note (optional)")}</label>
            <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>

        {/* bill-wise allocation */}
        {items && (
          <div className="mt-5">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <div className="section-label">{t("Settle against bills")}</div>
              <span className="chip bg-slate-100 text-slate-600">{picked ? t("Picked bills") : t("Oldest first")}</span>
              <div className="flex-1" />
              <button className="btn-ghost" onClick={autoFill} disabled={!items.bills.length || settles <= 0}>{t("Fill oldest first")}</button>
              <button className="btn-ghost" onClick={() => setAlloc({})} disabled={!picked}>{t("Clear")}</button>
            </div>
            <div className="table-wrap">
              <table className="tbl" style={{ minWidth: 640 }}>
                <thead><tr>
                  <th style={{ textAlign: "left" }}>{t("Bill no.")}</th>
                  <th style={{ textAlign: "left" }}>{t("Bill date")}</th>
                  <th style={{ textAlign: "left" }}>{t("Due date")}</th>
                  <th style={{ textAlign: "right" }}>{t("Bill amount")}</th>
                  <th style={{ textAlign: "right" }}>{t("Open")}</th>
                  <th style={{ textAlign: "right", width: 150 }}>{t("Settle")}</th>
                </tr></thead>
                <tbody>
                  {items.bills.map((b) => {
                    const overdue = b.dueDate < date;
                    return (
                      <tr key={b.id}>
                        <td className="font-mono text-[13px]">{b.docNo ?? "—"}{b.sourceType === "OPENING" && <span className="chip ml-2 bg-slate-100 text-slate-500">{t("Opening")}</span>}</td>
                        <td>{fmtDate(b.docDate)}</td>
                        <td style={overdue ? { color: "#b91c1c" } : undefined}>{fmtDate(b.dueDate)}</td>
                        <td className="num">{money(b.amount)}</td>
                        <td className="num">{money(b.open)}</td>
                        <td className="num">
                          <input className="inp num" type="number" min={0} max={b.open} style={{ width: 130 }}
                            placeholder={!picked && preview[b.id] ? money(preview[b.id]) : ""}
                            value={alloc[b.id] ?? ""}
                            onChange={(e) => setAlloc({ ...alloc, [b.id]: e.target.value })} />
                        </td>
                      </tr>
                    );
                  })}
                  {items.bills.length === 0 && (
                    <tr><td colSpan={6} className="muted text-sm" style={{ padding: 14 }}>{t("No open bills. The whole amount goes on account as an advance.")}</td></tr>
                  )}
                </tbody>
                <tfoot><tr>
                  <td colSpan={5} className="text-right">{t("Settled against bills")}</td>
                  <td className="num font-medium">{money(previewTotal)}</td>
                </tr><tr>
                  <td colSpan={5} className="text-right">{t("Advance / on account")}</td>
                  <td className="num font-medium" style={advance < 0 ? { color: "#b91c1c" } : undefined}>{money(advance)}</td>
                </tr></tfoot>
              </table>
            </div>
            <div className="h-4 leading-4 text-[12px] mt-1" style={{ color: "#b91c1c" }}>{allocErr ?? ""}</div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn" onClick={submit} disabled={busy || !!allocErr}>
            {busy ? t("Recording…") : isPay ? t("Record payment") : t("Record receipt")}
          </button>
          <span className="text-[12px] muted">
            {isPay ? t("Dr Supplier ledger · Cr Cash / Bank (+ Cr Discount Received, AIT / VDS payable)") : t("Dr Cash / Bank (+ Dr Discount Allowed, AIT / VDS credit) · Cr Customer ledger")}
          </span>
        </div>
        {msg && (
          <div className={`note mt-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>
            {msg.text}
            {msg.id && <> <button className="text-brand underline ml-2" onClick={() => printVoucher(msg.id!, "en")}>{t("Print voucher")}</button>
              <button className="text-brand underline ml-2" onClick={() => printVoucher(msg.id!, "bn")}>বাংলা</button></>}
          </div>
        )}
      </div>

      {/* history */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="section-label">{isPay ? t("Past payments") : t("Past receipts")}</div>
        <div className="flex-1" />
        <input className="inp" style={{ maxWidth: 260 }} placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 860 }}>
          <thead><tr>
            <th style={{ textAlign: "left" }}>{t("Voucher no.")}</th>
            <th style={{ textAlign: "left" }}>{t("Date")}</th>
            <th style={{ textAlign: "left" }}>{isPay ? t("Supplier") : t("Customer")}</th>
            <th style={{ textAlign: "left" }}>{t("Method")}</th>
            <th style={{ textAlign: "left" }}>{t("Reference")}</th>
            <th style={{ textAlign: "right" }}>{t("Discount")}</th>
            <th style={{ textAlign: "right" }}>{t("Amount")}</th>
            <th />
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-[13px]">{r.voucher_no ?? r.payment_no}</td>
                <td>{fmtDate(r.payment_date)}</td>
                <td>{pname(r)}{r.party_code && <span className="chip ml-2 bg-slate-100 text-slate-500">{r.party_code}</span>}</td>
                <td><span className="chip bg-slate-100 text-slate-600">{r.method === "BANK" ? t("Bank") : t("Cash")}</span>
                  {r.method === "BANK" && r.bank_account_no && <div className="text-[12px] muted mt-1">{r.bank_account_no}{r.bank_branch ? ` · ${r.bank_branch}` : ""}</div>}</td>
                <td className="muted">{r.reference ?? ""}{r.note ? <div className="text-[12px]">{r.note}</div> : null}</td>
                <td className="num">{Number(r.discount) > 0 ? money(Number(r.discount)) : ""}
                  {Number(r.ait) + Number(r.vds) > 0 && (
                    <div className="text-[11px] muted" title={t("Tax deducted at source")}>
                      {t("Tax at source")} {money(Number(r.ait || 0) + Number(r.vds || 0))}</div>)}</td>
                <td className="num font-medium">{money(r.amount)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="text-brand text-[13px]" onClick={() => printVoucher(r.id, "en")}>{t("Print")}</button>
                  <button className="text-brand text-[13px] ml-2" onClick={() => printVoucher(r.id, "bn")}>বাংলা</button>
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={8} className="muted text-sm" style={{ padding: 20 }}>
                {isPay ? t("No payments yet.") : t("No receipts yet.")}</td></tr>
            )}
            {loading && <tr><td colSpan={8} className="muted text-sm" style={{ padding: 20 }}>{t("Loading…")}</td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot><tr>
              <td colSpan={6} className="text-right font-medium">{t("Total")} ({shown.length})</td>
              <td className="num font-semibold">{money(total)}</td>
              <td />
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
