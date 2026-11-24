"use client";
import DateInput from "@/components/DateInput";

import { useEffect, useMemo, useState } from "react";
import { endpoints, fmtDate, type LedgerRow, type JournalEntryView } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import { TrashIcon } from "@/components/Icons";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { fmtMoney, today } from "@/lib/fmt";
import TopMessage from "@/components/TopMessage";
import { useStepCheck, type Problem } from "@/lib/useStepCheck";
import { BookOpen } from "lucide-react";

type Line = { accountId: string; debit: string; credit: string };

export default function JournalPage() {
  const { t, lang } = useI18n();
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [register, setRegister] = useState<JournalEntryView[]>([]);
  const [entryDate, setEntryDate] = useState(today());
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { accountId: "", debit: "", credit: "" },
    { accountId: "", debit: "", credit: "" },
  ]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rf, setRf] = useState("");
  const [rt, setRt] = useState("");
  const [rev, setRev] = useState<{ id: string; entryNo: string; reason: string } | null>(null);

  function loadRegister() { endpoints.journalRegister(100, rf, rt).then(setRegister).catch(() => {}); }
  useEffect(() => { endpoints.coaLedgers().then(setLedgers).catch(() => {}); }, []);
  useEffect(loadRegister, [rf, rt]);

  async function doReverse() {
    if (!rev) return;
    setMsg(null);
    try {
      const r = await endpoints.reverseJournal(rev.id, { reason: rev.reason });
      setMsg({ kind: "ok", text: `${rev.entryNo} ${t("reversed by")} ${r.entryNo}` });
      setRev(null); loadRegister();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  const ledgerOpts: Option[] = useMemo(
    () => ledgers.map((l) => ({ value: l.id, label: `${l.code} · ${lang === "bn" && l.name_bn ? l.name_bn : l.name}`, sublabel: l.type })),
    [ledgers, lang]);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { accountId: "", debit: "", credit: "" }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  const totalDr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01 && totalDr > 0;

  // first thing missing, line by line: ledger -> amount; then two lines; then balance
  const problem: Problem = (() => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const amt = Number(l.debit) > 0 || Number(l.credit) > 0;
      if (amt && !l.accountId) return { key: `acct-${i}`, text: `${t("Select a ledger.")} (${t("line")} ${i + 1})` };
      if (l.accountId && !amt) return { key: `amt-${i}`, text: `${t("Enter a debit or credit amount.")} (${t("line")} ${i + 1})` };
    }
    const done = lines.filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0)).length;
    if (done < 2) {
      const i = Math.max(0, lines.findIndex((l) => !l.accountId));
      return { key: `acct-${i}`, text: t("A journal needs at least two lines.") };
    }
    if (!balanced) return { key: "balance", text: t("Not balanced") };
    return null;
  })();
  const check = useStepCheck(problem);

  async function post() {
    setMsg(null);
    if (check.stop()) return;
    const payload = {
      entryDate, narration,
      lines: lines
        .filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
    };
    setBusy(true);
    try {
      const res = await endpoints.postJournal(payload);
      setMsg({ kind: "ok", text: `${t("Journal entry")} ${res.entryNo} ✓` });
      setNarration(""); setLines([{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }]);
      loadRegister();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Transactions"]} title={t("Journal entry")}
        subtitle={t("Post a manual double-entry journal. Debits must equal credits.")} />

      <div className="card p-5 mb-6">
        <div className="form-grid cols-2 mb-4">
          <div className="field"><label>{t("Date")}</label>
            <DateInput className="inp" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
          <div className="field"><label>{t("Narration")}</label>
            <input className="inp" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="reason / reference" /></div>
        </div>

        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th style={{ minWidth: 260 }}>{t("Ledger")}</th>
              <th className="text-right" style={{ width: 150 }}>{t("Debit")}</th>
              <th className="text-right" style={{ width: 150 }}>{t("Credit")}</th><th></th>
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><div className={check.bad(`acct-${i}`)}><SearchSelect options={ledgerOpts} value={l.accountId}
                    onChange={(v) => update(i, { accountId: v })} placeholder={t("Search…")} /></div></td>
                  <td className="text-right">
                    <input className={`inp num ${check.bad(`amt-${i}`)}`} style={{ width: 130, marginLeft: "auto" }} type="number" min={0}
                      value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
                  <td className="text-right">
                    <input className={`inp num ${check.bad(`amt-${i}`)}`} style={{ width: 130, marginLeft: "auto" }} type="number" min={0}
                      value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                  <td className="text-right">
                    {lines.length > 2 && <button className="btn-icon btn-icon-del" title="Remove" onClick={() => removeLine(i)}><TrashIcon /></button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-right font-medium">{t("Total")}</td>
                <td className="num font-medium">{totalDr.toFixed(2)}</td>
                <td className="num font-medium">{totalCr.toFixed(2)}</td>
                <td>{balanced ? <span className="chip bg-emerald-50 text-emerald-700">✓</span>
                  : <span className="chip bg-amber-50 text-amberwarn">≠</span>}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button className="btn-ghost btn-sm" onClick={addLine}>+ {t("Add line")}</button>
          <div className="flex-1" />
          <button className="btn" onClick={post} disabled={busy}>{busy ? "…" : t("Post")}</button>
        </div>
        <TopMessage msg={check.msg ?? msg} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div className="section-label tone-teal"><BookOpen size={16} />{t("Journal register")}</div>
        <div className="flex items-end gap-2">
          <div className="field"><label>{t("From")}</label><DateInput className="inp" value={rf} onChange={(e) => setRf(e.target.value)} /></div>
          <div className="field"><label>{t("To")}</label><DateInput className="inp" value={rt} onChange={(e) => setRt(e.target.value)} /></div>
        </div>
      </div>
      <p className="text-[12px] muted mb-3">{t("Posted entries can't be edited or deleted. To correct one, reverse it and post the right entry.")}</p>
      {rev && (
        <div className="card p-4 mb-4">
          <div className="text-sm mb-2">{t("Reverse entry")} <b>{rev.entryNo}</b></div>
          <input className="inp mb-3" placeholder={t("Reason (required)")} value={rev.reason} onChange={(e) => setRev({ ...rev, reason: e.target.value })} />
          <div className="flex gap-2">
            <button className="btn" disabled={!rev.reason.trim()} onClick={doReverse}>{t("Post reversal")}</button>
            <button className="btn-ghost" onClick={() => setRev(null)}>{t("Cancel")}</button>
          </div>
        </div>
      )}
      <div className="space-y-3">
        {register.map((e, idx) => (
          <div key={idx} className="card table-wrap">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50/60">
              <div className="text-sm min-w-0"><span className="font-mono text-xs muted mr-2">{e.entryNo}</span>{e.narration}
                {e.reversedByNo && <span className="status-chip status-fail ml-2">{t("Reversed by")} {e.reversedByNo}</span>}
                {e.reversalOfNo && <span className="status-chip status-info ml-2">{t("Reversal of")} {e.reversalOfNo}</span>}</div>
              <div className="text-xs muted whitespace-nowrap flex items-center gap-3">
                <span>{fmtDate(e.entryDate)} · {e.sourceType}{e.createdBy ? ` · ${e.createdBy}` : ""}</span>
                {!e.reversedByNo && !e.reversalOfNo && e.sourceType !== "YEAR_CLOSE" &&
                  <button className="btn-ghost btn-sm" onClick={() => setRev({ id: e.id, entryNo: e.entryNo, reason: "" })}>{t("Reverse")}</button>}
              </div>
            </div>
            <table className="tbl">
              <tbody>
                {e.lines.map((ln, j) => (
                  <tr key={j}>
                    <td className="font-mono text-[13px] w-20">{ln.code}</td>
                    <td>{ln.name}</td>
                    <td className="num w-32">{Number(ln.debit) > 0 ? fmtMoney(ln.debit) : ""}</td>
                    <td className="num w-32">{Number(ln.credit) > 0 ? fmtMoney(ln.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {register.length === 0 && <div className="muted text-sm">No entries yet.</div>}
      </div>
    </div>
  );
}
