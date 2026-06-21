"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, fmtDate, type LedgerRow, type JournalEntryView } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import SearchSelect, { type Option } from "@/components/SearchSelect";

type Line = { accountId: string; debit: string; credit: string };

export default function JournalPage() {
  const { t, lang } = useI18n();
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [register, setRegister] = useState<JournalEntryView[]>([]);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { accountId: "", debit: "", credit: "" },
    { accountId: "", debit: "", credit: "" },
  ]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function loadRegister() { endpoints.journalRegister(50).then(setRegister).catch(() => {}); }
  useEffect(() => { endpoints.coaLedgers().then(setLedgers).catch(() => {}); loadRegister(); }, []);

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

  async function post() {
    setMsg(null);
    const payload = {
      entryDate, narration,
      lines: lines
        .filter((l) => l.accountId && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
    };
    if (payload.lines.length < 2) { setMsg({ kind: "err", text: "A journal needs at least two lines." }); return; }
    if (!balanced) { setMsg({ kind: "err", text: t("Not balanced") }); return; }
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
      <h1 className="page-title mb-1">{t("Journal entry")}</h1>
      <p className="text-sm muted mb-6">Post a manual double-entry journal. Debits must equal credits.</p>

      <div className="card p-5 mb-6">
        <div className="form-grid cols-2 mb-4">
          <div className="field"><label>{t("Date")}</label>
            <input className="inp" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></div>
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
                  <td><SearchSelect options={ledgerOpts} value={l.accountId}
                    onChange={(v) => update(i, { accountId: v })} placeholder={t("Search…")} /></td>
                  <td className="text-right">
                    <input className="inp num" style={{ width: 130, marginLeft: "auto" }} type="number" min={0}
                      value={l.debit} onChange={(e) => update(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></td>
                  <td className="text-right">
                    <input className="inp num" style={{ width: 130, marginLeft: "auto" }} type="number" min={0}
                      value={l.credit} onChange={(e) => update(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></td>
                  <td className="text-right">
                    {lines.length > 2 && <button className="text-rose-600 text-sm" onClick={() => removeLine(i)}>×</button>}</td>
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
          <button className="btn" onClick={post} disabled={busy || !balanced}>{busy ? "…" : t("Post")}</button>
        </div>
        {msg && <div className={`note mt-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}
      </div>

      <div className="section-label mb-3">{t("Journal register")}</div>
      <div className="space-y-3">
        {register.map((e, idx) => (
          <div key={idx} className="card table-wrap">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50/60">
              <div className="text-sm"><span className="font-mono text-xs muted mr-2">{e.entryNo}</span>{e.narration}</div>
              <div className="text-xs muted">{fmtDate(e.entryDate)} · {e.sourceType}</div>
            </div>
            <table className="tbl">
              <tbody>
                {e.lines.map((ln, j) => (
                  <tr key={j}>
                    <td className="font-mono text-[13px] w-20">{ln.code}</td>
                    <td>{ln.name}</td>
                    <td className="num w-32">{Number(ln.debit) > 0 ? Number(ln.debit).toFixed(2) : ""}</td>
                    <td className="num w-32">{Number(ln.credit) > 0 ? Number(ln.credit).toFixed(2) : ""}</td>
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
