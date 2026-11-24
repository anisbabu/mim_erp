"use client";
import DateInput from "@/components/DateInput";
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { endpoints, fmtDate, type ContraRow, type MoneyLedger } from "@/lib/api";
import { fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import TopMessage from "@/components/TopMessage";
import { useStepCheck, type Problem } from "@/lib/useStepCheck";
import { ScrollText, History, Printer } from "lucide-react";

/** Contra voucher: cash deposited to bank, cash withdrawn, bank to bank. */
export default function ContraPage() {
  const { t, lang } = useI18n();
  const [ledgers, setLedgers] = useState<MoneyLedger[]>([]);
  const [rows, setRows] = useState<ContraRow[]>([]);
  const [date, setDate] = useState(today());
  const [from, setFrom] = useState("1000");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const name = (l?: { name?: string; name_bn?: string }) => (lang === "bn" && l?.name_bn ? l.name_bn : l?.name) ?? "";
  const load = () => endpoints.contraList().then(setRows).catch((e) => setMsg({ kind: "err", text: e.message }));
  async function printCv(id: string, l: "en" | "bn") {
    try { window.open(URL.createObjectURL(await endpoints.contraPdf(id, l)), "_blank"); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  useEffect(() => {
    endpoints.contraLedgers().then(setLedgers).catch((e) => setMsg({ kind: "err", text: e.message }));
    load();
  }, []);

  // first thing missing, in form order: from, to (different), amount
  const problem: Problem =
    !from ? { key: "from", text: t("Select the ledger it is paid out of.") }
    : !to ? { key: "to", text: t("Select the ledger it is paid into.") }
    : from === to ? { key: "to", text: t("From and To must be different ledgers.") }
    : !(Number(amount) > 0) ? { key: "amount", text: t("Amount must be positive.") }
    : null;
  const check = useStepCheck(problem);

  async function submit() {
    setMsg(null);
    if (check.stop()) return;
    setBusy(true);
    try {
      const r: any = await endpoints.contra({ date, fromAccount: from, toAccount: to, amount: Number(amount),
        reference: reference.trim() || undefined, note: note.trim() || undefined });
      setMsg({ kind: "ok", text: r.pending ? `${t("Above the approval limit — sent for approval as")} ${r.requestNo}.`
        : `${t("Contra voucher")} ${r.voucherNo} ${t("recorded.")}` });
      setAmount(""); setReference(""); setNote("");
      load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  const opts = ledgers.map((l) => <option key={l.code} value={l.code}>{l.code} · {name(l)}</option>);

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Transactions"]} title={t("Contra voucher")}
        subtitle={t("Move money between our own cash and bank ledgers: deposits, withdrawals, bank to bank.")} />

      <div className="card p-5 mb-5" onKeyDown={(e) => { if (e.key === "Enter" && !busy) submit(); }}>
        <div className="form-grid cols-3">
          <div className="field"><label>{t("Date")} <span className="req">*</span></label>
            <DateInput className="inp" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            <div className="h-4 leading-4" /></div>
          <div className="field"><label>{t("From (paid out of)")} <span className="req">*</span></label>
            <select className={`inp ${check.bad("from")}`} value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">{t("Select…")}</option>{opts}</select>
            <div className="h-4 leading-4 text-[11px] muted">{t("Credited")}</div></div>
          <div className="field"><label>{t("To (paid into)")} <span className="req">*</span></label>
            <select className={`inp ${check.bad("to")}`} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">{t("Select…")}</option>{opts}</select>
            <div className="h-4 leading-4 text-[11px] muted">{t("Debited")}</div></div>
          <div className="field"><label>{t("Amount")} <span className="req">*</span></label>
            <input className={`inp num ${check.bad("amount")}`} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="h-4 leading-4" /></div>
          <div className="field"><label>{t("Reference")}</label>
            <input className="inp" placeholder={t("Deposit slip / cheque no.")} value={reference} onChange={(e) => setReference(e.target.value)} />
            <div className="h-4 leading-4" /></div>
          <div className="field"><label>{t("Note")}</label>
            <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="h-4 leading-4" /></div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button className="btn" onClick={submit} disabled={busy}>{busy ? t("Recording…") : t("Record contra")}</button>
          <span className="acct-trace"><ScrollText size={13} />{t("Dr To ledger · Cr From ledger")}</span>
        </div>
        <TopMessage msg={check.msg ?? msg} />
      </div>

      <div className="section-label tone-teal mb-3"><History size={16} />{t("Past contra vouchers")}</div>
      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 820 }}>
          <thead><tr>
            <th style={{ textAlign: "left" }}>{t("Date")}</th>
            <th style={{ textAlign: "left" }}>{t("Voucher")}</th>
            <th style={{ textAlign: "left" }}>{t("From")}</th>
            <th style={{ textAlign: "left" }}>{t("To")}</th>
            <th style={{ textAlign: "left" }}>{t("Reference")}</th>
            <th style={{ textAlign: "right" }}>{t("Amount")}</th>
            <th />
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.voucher_date)}</td>
                <td className="font-mono text-[13px]">{r.voucher_no}
                  {r.approved_by && <div className="text-[11px] muted">{t("Approved by")} {r.approved_by}</div>}</td>
                <td>{r.from_account} · {name({ name: r.from_name, name_bn: r.from_name_bn })}</td>
                <td>{r.to_account} · {name({ name: r.to_name, name_bn: r.to_name_bn })}</td>
                <td className="muted">{r.reference ?? ""}{r.note ? <div className="text-[12px]">{r.note}</div> : null}</td>
                <td className="num font-medium">{fmtMoney(r.amount)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="inline-flex gap-1">
                    <button className="btn btn-print btn-sm" onClick={() => printCv(r.id, "en")}><Printer size={13} className="mr-1" />PDF</button>
                    <button className="btn btn-print btn-sm" onClick={() => printCv(r.id, "bn")}>বাংলা</button>
                  </span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">{t("No contra vouchers yet.")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
