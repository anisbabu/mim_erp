"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, fmtDate, type BankAccountRow, type BankHistoryRow, type BankOpen } from "@/lib/api";
import { fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";

export default function BankReconPage() {
  const { t, lang } = useI18n();
  const [banks, setBanks] = useState<BankAccountRow[]>([]);
  const [bankId, setBankId] = useState("");
  const [date, setDate] = useState(today());
  const [balance, setBalance] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<BankOpen | null>(null);
  const [hist, setHist] = useState<BankHistoryRow[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { endpoints.bankAccounts().then((b) => { setBanks(b); if (b[0]) setBankId(b[0].id); }).catch(() => {}); }, []);

  function load() {
    if (!bankId || !date) return;
    setOpen(null); setTicked(new Set());
    endpoints.bankOpen(bankId, date).then(setOpen).catch((e) => setMsg({ kind: "err", text: e.message }));
    endpoints.bankHistory(bankId).then(setHist).catch(() => {});
  }
  useEffect(load, [bankId, date]);

  const toggle = (id: string) => setTicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // what the bank should show if exactly the ticked lines are on the statement
  const calc = useMemo(() => {
    if (!open) return null;
    const unclearedTotal = open.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    const tickedTotal = open.lines.filter((l) => ticked.has(l.id)).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    const expected = open.bookBalance - (unclearedTotal - tickedTotal);
    const diff = balance === "" ? null : Number(balance) - expected;
    return { expected, diff };
  }, [open, ticked, balance]);

  async function save() {
    setMsg(null); setBusy(true);
    try {
      const r = await endpoints.bankReconcile(bankId, { statementDate: date, statementBalance: Number(balance), lineIds: [...ticked], note });
      setMsg({ kind: "ok", text: `${t("Reconciled")}: ${r.cleared} ${t("lines cleared")}` });
      setBalance(""); setNote(""); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  const bn = (b: BankAccountRow) => `${b.code} · ${lang === "bn" && b.name_bn ? b.name_bn : b.name}`;
  const ok = calc?.diff !== null && calc?.diff !== undefined && Math.abs(calc.diff) < 0.005;

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Transactions"]} title={t("Bank reconciliation")}
        subtitle={t("Tick the ledger lines that appear on the bank statement. Save when the difference is zero.")} />

      <div className="card p-5 mb-5">
        <div className="form-grid cols-2 gap-x-4 gap-y-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="field"><label>{t("Bank ledger")}</label>
            <select className="inp" value={bankId} onChange={(e) => setBankId(e.target.value)}>
              {banks.map((b) => <option key={b.id} value={b.id}>{bn(b)}</option>)}
            </select></div>
          <div className="field"><label>{t("Statement date")}</label>
            <input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field"><label>{t("Closing balance on statement")}</label>
            <input className="inp num" type="number" value={balance} onChange={(e) => setBalance(e.target.value)} /></div>
          <div className="field"><label>{t("Note")}</label>
            <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
      </div>

      {msg && <div className={`note mb-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}

      {open && calc && (
        <>
          <div className="card table-wrap mb-4">
            <table className="rpt" style={{ minWidth: 700 }}>
              <colgroup><col style={{ width: 46 }} /><col style={{ width: 96 }} /><col style={{ width: 130 }} /><col />
                <col style={{ width: 120 }} /><col style={{ width: 120 }} /></colgroup>
              <thead><tr>
                <th></th><th className="l">{t("Date")}</th><th className="l">{t("Voucher")}</th><th className="l">{t("Narration")}</th>
                <th className="n">{t("Deposit (Dr)")}</th><th className="n">{t("Withdrawal (Cr)")}</th>
              </tr></thead>
              <tbody>
                {open.lines.map((l) => (
                  <tr key={l.id} style={ticked.has(l.id) ? { background: "var(--tbl-tr-hover)" } : undefined}>
                    <td className="l"><input type="checkbox" checked={ticked.has(l.id)} onChange={() => toggle(l.id)} /></td>
                    <td className="l">{fmtDate(l.entry_date)}</td>
                    <td className="l font-mono text-[12px]">{l.entry_no}</td>
                    <td className="l" title={l.narration}>{l.narration}</td>
                    <td className="n">{fmtMoney(l.debit)}</td><td className="n">{fmtMoney(l.credit)}</td>
                  </tr>
                ))}
                {open.lines.length === 0 && <tr><td colSpan={6} className="l muted">{t("Every ledger line up to this date is already reconciled.")}</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card p-5 mb-6">
            <table className="stmt" style={{ maxWidth: 520 }}>
              <tbody>
                <tr className="l"><td>{t("Book balance on statement date")}</td><td className="n">{fmtMoney(open.bookBalance, "0.00")}</td></tr>
                <tr className="l"><td>{t("Less: lines not yet on the statement")}</td>
                  <td className="n">{fmtMoney(-(open.lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) -
                    open.lines.filter((l) => ticked.has(l.id)).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)), "0.00")}</td></tr>
                <tr className="s"><td>{t("Expected statement balance")}</td><td className="n">{fmtMoney(calc.expected, "0.00")}</td></tr>
                <tr className="l"><td>{t("Balance on bank statement")}</td><td className="n">{balance === "" ? "" : fmtMoney(Number(balance), "0.00")}</td></tr>
                <tr className="t"><td>{t("Difference")}</td><td className="n" style={{ color: ok ? "#166534" : "#991b1b" }}>{calc.diff === null ? "" : fmtMoney(calc.diff, "0.00")}</td></tr>
              </tbody>
            </table>
            <div className="mt-4 flex items-center gap-3">
              <button className="btn" disabled={busy || !ok} onClick={save}>{busy ? "…" : t("Save reconciliation")}</button>
              <span className="text-[12px] muted">{ticked.size} {t("lines ticked")}</span>
            </div>
          </div>
        </>
      )}

      {hist.length > 0 && (
        <>
          <div className="section-label mb-3">{t("Previous reconciliations")}</div>
          <div className="card table-wrap">
            <table className="rpt" style={{ minWidth: 600 }}>
              <colgroup><col style={{ width: 110 }} /><col style={{ width: 150 }} /><col style={{ width: 150 }} /><col style={{ width: 80 }} /><col /><col style={{ width: 120 }} /></colgroup>
              <thead><tr>
                <th className="l">{t("Statement date")}</th><th className="n">{t("Statement balance")}</th><th className="n">{t("Book balance")}</th>
                <th className="n">{t("Lines")}</th><th className="l">{t("Note")}</th><th className="l">{t("By")}</th>
              </tr></thead>
              <tbody>
                {hist.map((h) => (
                  <tr key={h.id}>
                    <td className="l">{fmtDate(h.statement_date)}</td><td className="n">{fmtMoney(h.statement_balance, "0.00")}</td>
                    <td className="n">{fmtMoney(h.book_balance, "0.00")}</td><td className="n">{h.lines}</td>
                    <td className="l">{h.note}</td><td className="l">{h.created_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
