"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, fmtDate, type FixedAsset, type LedgerRow } from "@/lib/api";
import { fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import SearchSelect, { type Option } from "@/components/SearchSelect";

const blank = { name: "", category: "", purchaseDate: today(), cost: "", residualValue: "0", usefulLifeMonths: "60", paidFromAccountId: "" };

export default function FixedAssetsPage() {
  const { t, lang } = useI18n();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [f, setF] = useState(blank);
  const [period, setPeriod] = useState(today().slice(0, 7));
  const [disp, setDisp] = useState<{ id: string; date: string; proceeds: string; depositAccountId: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => endpoints.fixedAssets().then(setAssets).catch((e) => setMsg({ kind: "err", text: e.message }));
  useEffect(() => { load(); endpoints.coaLedgers().then(setLedgers).catch(() => {}); }, []);

  const opts: Option[] = useMemo(
    () => ledgers.filter((l) => l.type === "ASSET" || l.type === "LIABILITY").map((l) => ({
      value: l.id, label: `${l.code} · ${lang === "bn" && l.name_bn ? l.name_bn : l.name}`, sublabel: l.type })),
    [ledgers, lang]);

  async function run<T>(fn: () => Promise<T>, ok: (r: T) => string) {
    setMsg(null); setBusy(true);
    try { const r = await fn(); setMsg({ kind: "ok", text: ok(r) }); await load(); return true; }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); return false; }
    finally { setBusy(false); }
  }

  async function add() {
    const ok = await run(() => endpoints.createAsset({
      ...f, cost: Number(f.cost), residualValue: Number(f.residualValue) || 0, usefulLifeMonths: Number(f.usefulLifeMonths),
      paidFromAccountId: f.paidFromAccountId || null,
    }), (r) => `${t("Asset registered")}: ${r.code}`);
    if (ok) setF(blank);
  }

  const tot = assets.filter((a) => a.status === "ACTIVE").reduce(
    (s, a) => ({ cost: s.cost + Number(a.cost), acc: s.acc + Number(a.accumulated), nbv: s.nbv + Number(a.net_book_value) }),
    { cost: 0, acc: 0, nbv: 0 });

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Setup"]} title={t("Fixed assets")}
        subtitle={t("Asset register with straight-line depreciation (IAS 16). Cost 1500, accumulated depreciation 1590.")}
        actions={
          <div className="flex items-end gap-2">
            <div className="field"><label>{t("Depreciation month")}</label>
              <input className="inp" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
            <button className="btn" disabled={busy || !period}
              onClick={() => run(() => endpoints.depreciate(period),
                (r) => r.assets === 0 ? t("Nothing to depreciate for this month.") : `${t("Depreciation posted")}: ${fmtMoney(r.total)} (${r.assets} ${t("assets")}) ${r.entryNo ?? ""}`)}>
              {t("Run depreciation")}
            </button>
          </div>} />

      {msg && <div className={`note mb-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}

      <div className="card table-wrap mb-6">
        <table className="rpt" style={{ minWidth: 900 }}>
          <colgroup><col style={{ width: 80 }} /><col /><col style={{ width: 110 }} /><col style={{ width: 100 }} />
            <col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 100 }} /><col style={{ width: 90 }} /></colgroup>
          <thead><tr>
            <th className="l">{t("Code")}</th><th className="l">{t("Asset")}</th><th className="l">{t("Category")}</th>
            <th className="l">{t("Purchased")}</th><th className="n">{t("Cost")}</th><th className="n">{t("Accumulated depreciation")}</th>
            <th className="n">{t("Net book value")}</th><th className="l">{t("Status")}</th><th></th>
          </tr></thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <td className="l font-mono text-[12px]">{a.code}</td>
                <td className="l" title={a.name}>{a.name}</td>
                <td className="l">{a.category}</td>
                <td className="l">{fmtDate(a.purchase_date)}</td>
                <td className="n">{fmtMoney(a.cost)}</td><td className="n">{fmtMoney(a.accumulated)}</td>
                <td className="n">{fmtMoney(a.net_book_value)}</td>
                <td className="l"><span className={`status-chip ${a.status === "ACTIVE" ? "status-ok" : "status-info"}`}>{a.status}</span></td>
                <td className="n">{a.status === "ACTIVE" &&
                  <button className="btn-ghost btn-sm" onClick={() => setDisp({ id: a.id, date: today(), proceeds: "", depositAccountId: "" })}>{t("Dispose")}</button>}</td>
              </tr>
            ))}
            {assets.length === 0 && <tr><td colSpan={9} className="l muted">{t("No fixed assets registered yet.")}</td></tr>}
          </tbody>
          {assets.length > 0 && (
            <tfoot><tr>
              <td colSpan={4} className="l">{t("Total (active assets)")}</td>
              <td className="n">{fmtMoney(tot.cost)}</td><td className="n">{fmtMoney(tot.acc)}</td><td className="n">{fmtMoney(tot.nbv)}</td><td colSpan={2} />
            </tr></tfoot>
          )}
        </table>
      </div>

      {disp && (
        <div className="card p-5 mb-6">
          <div className="section-label mb-3">{t("Dispose of asset")}</div>
          <div className="form-grid cols-2 mb-3">
            <div className="field"><label>{t("Date")}</label>
              <input className="inp" type="date" value={disp.date} onChange={(e) => setDisp({ ...disp, date: e.target.value })} /></div>
            <div className="field"><label>{t("Sale proceeds")}</label>
              <input className="inp num" type="number" min={0} value={disp.proceeds} onChange={(e) => setDisp({ ...disp, proceeds: e.target.value })} /></div>
            <div className="field"><label>{t("Proceeds received in")}</label>
              <SearchSelect options={opts} value={disp.depositAccountId} onChange={(v) => setDisp({ ...disp, depositAccountId: v })} /></div>
          </div>
          <div className="flex gap-2">
            <button className="btn" disabled={busy} onClick={async () => {
              const ok = await run(() => endpoints.disposeAsset(disp.id, { date: disp.date, proceeds: Number(disp.proceeds) || 0, depositAccountId: disp.depositAccountId || null }),
                (r) => `${t("Disposed. Gain / (loss)")}: ${fmtMoney(r.gainLoss, "0.00")}  ${r.entryNo}`);
              if (ok) setDisp(null);
            }}>{t("Post disposal")}</button>
            <button className="btn-ghost" onClick={() => setDisp(null)}>{t("Cancel")}</button>
          </div>
        </div>
      )}

      <div className="card p-5">
        <div className="section-label mb-3">{t("Register a new asset")}</div>
        <div className="form-grid cols-2 gap-x-4 gap-y-4">
          <div className="field"><label>{t("Asset name")}</label>
            <input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label>{t("Category")}</label>
            <input className="inp" value={f.category} placeholder="Vehicles, Furniture, Equipment…" onChange={(e) => setF({ ...f, category: e.target.value })} /></div>
          <div className="field"><label>{t("Purchase date")}</label>
            <input className="inp" type="date" value={f.purchaseDate} onChange={(e) => setF({ ...f, purchaseDate: e.target.value })} /></div>
          <div className="field"><label>{t("Cost")}</label>
            <input className="inp num" type="number" min={0} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></div>
          <div className="field"><label>{t("Residual value")}</label>
            <input className="inp num" type="number" min={0} value={f.residualValue} onChange={(e) => setF({ ...f, residualValue: e.target.value })} /></div>
          <div className="field"><label>{t("Useful life (months)")}</label>
            <input className="inp num" type="number" min={1} value={f.usefulLifeMonths} onChange={(e) => setF({ ...f, usefulLifeMonths: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label>{t("Paid from (posts the purchase)")}</label>
            <SearchSelect options={opts} value={f.paidFromAccountId} onChange={(v) => setF({ ...f, paidFromAccountId: v })} placeholder={t("Leave empty for an asset already in the opening balances")} />
          </div>
        </div>
        <div className="mt-4"><button className="btn" disabled={busy || !f.name || !f.cost} onClick={add}>{t("Register asset")}</button></div>
      </div>
    </div>
  );
}
