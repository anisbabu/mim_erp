"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, fmtDate, type FinancialYear, type LedgerRow, type OpeningBalance } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function FinancialYearPage() {
  const { t, lang } = useI18n();
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [activeYear, setActiveYear] = useState<string>("");
  const [openings, setOpenings] = useState<Record<string, { debit: string; credit: string }>>({});
  const [nf, setNf] = useState<{ name: string; startDate: string; endDate: string; current: boolean }>(
    { name: "", startDate: "", endDate: "", current: true });
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function loadYears() {
    endpoints.financialYears().then((ys) => {
      setYears(ys);
      const cur = ys.find((y) => y.current) ?? ys[0];
      if (cur && !activeYear) setActiveYear(cur.id);
    }).catch(() => {});
  }
  useEffect(() => { loadYears(); endpoints.coaLedgers().then(setLedgers).catch(() => {}); }, []);

  // load opening balances for the chosen year
  useEffect(() => {
    if (!activeYear) return;
    endpoints.openings(activeYear).then((obs: OpeningBalance[]) => {
      const map: Record<string, { debit: string; credit: string }> = {};
      obs.forEach((o) => { map[o.accountId] = { debit: String(o.debit ?? 0), credit: String(o.credit ?? 0) }; });
      setOpenings(map);
    }).catch(() => {});
  }, [activeYear]);

  const lname = (l: LedgerRow) => (lang === "bn" && l.name_bn ? l.name_bn : l.name);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return ledgers.filter((l) => !s || [l.code, l.name, l.name_bn].filter(Boolean).some((v) => v!.toLowerCase().includes(s)));
  }, [ledgers, q]);

  async function createYear() {
    setMsg(null);
    if (!nf.name || !nf.startDate || !nf.endDate) { setMsg({ kind: "err", text: "Name, start and end dates are required." }); return; }
    try {
      await endpoints.createYear(nf);
      setNf({ name: "", startDate: "", endDate: "", current: true });
      setMsg({ kind: "ok", text: t("Saved.") }); loadYears();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  async function makeCurrent(id: string) {
    try { await endpoints.setCurrentYear(id); setMsg({ kind: "ok", text: t("Saved.") }); loadYears(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  const setOB = (accId: string, patch: Partial<{ debit: string; credit: string }>) =>
    setOpenings((o) => ({ ...o, [accId]: { debit: o[accId]?.debit ?? "0", credit: o[accId]?.credit ?? "0", ...patch } }));

  async function saveOpening(accId: string) {
    setMsg(null);
    const v = openings[accId] ?? { debit: "0", credit: "0" };
    try {
      await endpoints.setOpening(activeYear, { accountId: accId, debit: Number(v.debit) || 0, credit: Number(v.credit) || 0 });
      setMsg({ kind: "ok", text: t("Saved.") });
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  const totalDr = filtered.reduce((s, l) => s + (Number(openings[l.id]?.debit) || 0), 0);
  const totalCr = filtered.reduce((s, l) => s + (Number(openings[l.id]?.credit) || 0), 0);

  return (
    <div>
      <h1 className="page-title mb-1">{t("Financial year")}</h1>
      <p className="text-sm muted mb-6">Opening balances for the current year carry forward from last year's closing. Debits should equal credits.</p>

      {/* years */}
      <div className="card table-wrap mb-6">
        <table className="tbl">
          <thead><tr><th>{t("Name")}</th><th>{t("Start date")}</th><th>{t("End date")}</th><th>{t("Status")}</th><th className="text-right">{t("Actions")}</th></tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.id}>
                <td className="font-medium">{y.name}{y.current && <span className="chip ml-2 bg-brand-soft text-brand">{t("Current")}</span>}</td>
                <td>{fmtDate(y.startDate)}</td><td>{fmtDate(y.endDate)}</td>
                <td><span className={`chip ${y.status === "OPEN" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{y.status}</span></td>
                <td className="text-right">
                  {!y.current && <button className="btn-ghost btn-sm" onClick={() => makeCurrent(y.id)}>{t("Set current")}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-slate-200 p-4">
          <div className="section-label mb-3">{t("Financial year")} — {t("Add")}</div>
          <div className="form-grid items-start gap-x-4 gap-y-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="field"><label>{t("Name")}</label>
              <input className="inp" placeholder="2026-2027" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} /></div>
            <div className="field"><label>{t("Start date")}</label>
              <input className="inp" type="date" value={nf.startDate} onChange={(e) => setNf({ ...nf, startDate: e.target.value })} /></div>
            <div className="field"><label>{t("End date")}</label>
              <input className="inp" type="date" value={nf.endDate} onChange={(e) => setNf({ ...nf, endDate: e.target.value })} /></div>
            <div className="field"><label>{t("Set current")}</label>
              <label className="h-10 flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={nf.current} onChange={(e) => setNf({ ...nf, current: e.target.checked })} />
                <span className="text-sm muted">{t("Current")}</span>
              </label></div>
          </div>
          <div className="mt-4"><button className="btn" onClick={createYear}>{t("Add")}</button></div>
        </div>
      </div>

      {/* opening balances */}
      <div className="flex items-center justify-between mb-3">
        <div className="section-label">{t("Opening balances")}</div>
        <select className="inp btn-sm" style={{ height: 36, width: "auto", paddingRight: 30 }}
          value={activeYear} onChange={(e) => setActiveYear(e.target.value)}>
          {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
      </div>

      <div className="mb-3" style={{ maxWidth: 320 }}>
        <input className="inp" placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {msg && <div className={`note mb-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}

      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr>
            <th>{t("Code")}</th><th>{t("Ledger")}</th>
            <th className="text-right" style={{ width: 140 }}>{t("Debit")}</th>
            <th className="text-right" style={{ width: 140 }}>{t("Credit")}</th><th></th>
          </tr></thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id}>
                <td className="font-mono text-[13px]">{l.code}</td>
                <td>{lname(l)}</td>
                <td className="text-right">
                  <input className="inp num" style={{ width: 120, marginLeft: "auto" }} type="number"
                    value={openings[l.id]?.debit ?? ""} onChange={(e) => setOB(l.id, { debit: e.target.value })} /></td>
                <td className="text-right">
                  <input className="inp num" style={{ width: 120, marginLeft: "auto" }} type="number"
                    value={openings[l.id]?.credit ?? ""} onChange={(e) => setOB(l.id, { credit: e.target.value })} /></td>
                <td className="text-right"><button className="btn-ghost btn-sm" onClick={() => saveOpening(l.id)}>{t("Save")}</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="text-right font-medium">{t("Total")}</td>
              <td className="num font-medium">{totalDr.toFixed(2)}</td>
              <td className="num font-medium">{totalCr.toFixed(2)}</td>
              <td>{Math.abs(totalDr - totalCr) < 0.01
                ? <span className="chip bg-emerald-50 text-emerald-700">✓</span>
                : <span className="chip bg-amber-50 text-amberwarn">≠</span>}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
