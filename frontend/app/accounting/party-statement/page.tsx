"use client";
import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { ReportTitle, Toolbar, savePdf } from "@/components/reports/ReportKit";
import Drawer from "@/components/Drawer";
import { useAuth } from "@/lib/auth";
import { endpoints, fmtDate, type Customer, type Supplier, type GeneralLedger, type PartyOpenItems, type PartyItem } from "@/lib/api";
import { fmtDrCr, fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";

type PT = "CUSTOMER" | "SUPPLIER";

/** Customer / supplier statement: running ledger with voucher references, plus open bills and advances. */
export default function PartyStatementPage() {
  const { t, dn, lang } = useI18n();
  const [type, setType] = useState<PT>("CUSTOMER");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [partyId, setPartyId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(today());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [gl, setGl] = useState<GeneralLedger | null>(null);
  const [items, setItems] = useState<PartyOpenItems | null>(null);
  const [err, setErr] = useState("");
  const { user } = useAuth();
  const canMatch = user?.role === "ACCOUNTANT" || user?.role === "ADMIN";
  const [matching, setMatching] = useState<PartyItem | null>(null);   // advance being matched by hand
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [matchErr, setMatchErr] = useState("");
  const [busy, setBusy] = useState(false);
  const reloadItems = () => partyId && endpoints.partyOpenItems(type, partyId).then(setItems).catch(() => {});

  useEffect(() => {
    endpoints.customers().then(setCustomers).catch(() => {});
    endpoints.suppliers().then(setSuppliers).catch(() => {});
    endpoints.currentYear().then((y) => setFrom(y.startDate)).catch(() => setFrom(today().slice(0, 4) + "-01-01"));
  }, []);

  const opts: Option[] = useMemo(
    () => (type === "CUSTOMER" ? customers : suppliers).map((x: any) => ({ value: x.id, label: dn(x), sublabel: x.code })),
    [type, customers, suppliers, dn]);

  useEffect(() => {
    setGl(null); setItems(null); setAccountId(null); setErr("");
    if (!partyId) return;
    endpoints.partyLedger(type, partyId).then((r) => setAccountId(r.accountId ?? "")).catch((e) => setErr(e.message));
    endpoints.partyOpenItems(type, partyId).then(setItems).catch(() => {});
  }, [type, partyId]);

  useEffect(() => {
    if (!accountId || !from || !to) return;
    endpoints.generalLedger(accountId, from, to).then(setGl).catch((e) => setErr(e.message));
  }, [accountId, from, to]);

  const name = gl ? (lang === "bn" && gl.account.name_bn ? gl.account.name_bn : gl.account.name) : "";
  const sourceLabel = (s?: string) => ({
    SALES_DELIVERY: t("Sale"), SALES_INVOICE: t("Sale"), RECEIPT: t("Receipt"), PAYMENT: t("Payment"),
    GRN: t("Goods receipt"), SALES_RETURN: t("Credit note"), PURCHASE_RETURN: t("Debit note"), CHEQUE_BOUNCE: t("Cheque bounced"), CHEQUE_CHARGE: t("Bank charge"),
    REVERSAL: t("Reversal"), JOURNAL: t("Journal"),
  } as Record<string, string>)[s ?? ""] ?? s ?? "";

  /** Open the match drawer for an advance, pre-filled oldest bill first. */
  function startMatch(a: PartyItem) {
    let left = Number(a.open);
    const p: Record<string, string> = {};
    for (const b of items?.bills ?? []) {
      if (left <= 0) break;
      const take = Math.min(left, Number(b.open));
      p[b.id] = String(Math.round(take * 100) / 100);
      left -= take;
    }
    setPicks(p); setMatchErr(""); setMatching(a);
  }
  const picked = Math.round(Object.values(picks).reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100;

  async function saveMatch() {
    if (!matching) return;
    if (picked > Number(matching.open)) { setMatchErr(t("More than the advance has open.")); return; }
    const allocations = Object.entries(picks).filter(([, v]) => Number(v) > 0).map(([billId, v]) => ({ billId, amount: Number(v) }));
    if (allocations.length === 0) { setMatchErr(t("Enter an amount against at least one bill.")); return; }
    setBusy(true);
    try { await endpoints.matchBills(matching.id, allocations); setMatching(null); await reloadItems(); }
    catch (e: any) { setMatchErr(e.message); } finally { setBusy(false); }
  }

  async function unmatch(id: string) {
    setBusy(true); setErr("");
    try { await endpoints.unmatchItem(id); await reloadItems(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Reports"]} title={t("Party statement")}
        subtitle={t("Customer or supplier account: every voucher with its reference, running balance and open bills.")} />

      <Toolbar onPdf={gl && accountId ? () => savePdf(() => endpoints.reportPdfQuery("reports/ledger", `accountId=${accountId}&from=${from}&to=${to}`, lang),
        `statement-${gl.account.code}${lang === "bn" ? "-bn" : ""}.pdf`, setErr) : undefined}>
        <div className="field"><label>{t("Party type")}</label>
          <div className="flex gap-1">
            <button className={type === "CUSTOMER" ? "btn" : "btn-ghost"} onClick={() => { setType("CUSTOMER"); setPartyId(""); }}>{t("Customer")}</button>
            <button className={type === "SUPPLIER" ? "btn" : "btn-ghost"} onClick={() => { setType("SUPPLIER"); setPartyId(""); }}>{t("Supplier")}</button>
          </div></div>
        <div className="field" style={{ minWidth: 300 }}><label>{type === "CUSTOMER" ? t("Customer") : t("Supplier")}</label>
          <SearchSelect options={opts} value={partyId} onChange={setPartyId} placeholder={t("Search…")} /></div>
        <div className="field"><label>{t("From")}</label>
          <input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>{t("To")}</label>
          <input className="inp" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Toolbar>
      {err && <div className="note note-err mb-3">{err}</div>}
      {!partyId && <p className="muted text-sm">{t("Pick a customer or supplier to see their statement.")}</p>}
      {partyId && accountId === "" && <p className="muted text-sm">{t("Nothing has been posted to this party yet.")}</p>}

      {gl && (
        <div className="report-sheet mb-6">
          <ReportTitle name={`${t("Party statement")}: ${gl.account.code} · ${name}`}
            period={`${fmtDate(gl.from)} – ${fmtDate(gl.to)}`} sub={t("Amounts in BDT")} />
          <div className="table-wrap">
            <table className="rpt" style={{ minWidth: 820 }}>
              <colgroup><col style={{ width: 94 }} /><col style={{ width: 110 }} /><col style={{ width: 150 }} /><col />
                <col style={{ width: 112 }} /><col style={{ width: 112 }} /><col style={{ width: 130 }} /></colgroup>
              <thead><tr>
                <th className="l">{t("Date")}</th><th className="l">{t("Type")}</th><th className="l">{t("Reference")}</th>
                <th className="l">{t("Narration")}</th>
                <th className="n">{t("Debit")}</th><th className="n">{t("Credit")}</th><th className="n">{t("Balance")}</th>
              </tr></thead>
              <tbody>
                <tr className="grp">
                  <td colSpan={6} className="l">{t("Opening balance")}</td>
                  <td className="n">{fmtDrCr(gl.openingBalance)}</td>
                </tr>
                {gl.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="l">{fmtDate(r.date)}</td>
                    <td className="l">{sourceLabel(r.sourceType)}</td>
                    <td className="l font-mono text-[12px]" title={r.entryNo}>{r.refNo ?? r.entryNo}</td>
                    <td className="l" title={r.narration}>{r.narration}</td>
                    <td className="n">{fmtMoney(r.debit)}</td><td className="n">{fmtMoney(r.credit)}</td>
                    <td className="n">{fmtDrCr(r.balance)}</td>
                  </tr>
                ))}
                {gl.rows.length === 0 && <tr><td colSpan={7} className="l muted">{t("No transactions in this period.")}</td></tr>}
              </tbody>
              <tfoot><tr>
                <td colSpan={4} className="l">{t("Total / closing balance")}</td>
                <td className="n">{fmtMoney(gl.totalDebit)}</td><td className="n">{fmtMoney(gl.totalCredit)}</td>
                <td className="n">{fmtDrCr(gl.closingBalance)}</td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      )}

      {items && (items.bills.length > 0 || items.advances.length > 0 || (items.matched?.length ?? 0) > 0) && (
        <div className="card table-wrap">
          <table className="tbl" style={{ minWidth: 700 }}>
            <thead><tr>
              <th style={{ textAlign: "left" }}>{t("Open item")}</th>
              <th style={{ textAlign: "left" }}>{t("Bill date")}</th>
              <th style={{ textAlign: "left" }}>{t("Due date")}</th>
              <th style={{ textAlign: "right" }}>{t("Amount")}</th>
              <th style={{ textAlign: "right" }}>{t("Open")}</th>
              <th style={{ textAlign: "left" }}>{t("Status")}</th>
              {canMatch && <th />}
            </tr></thead>
            <tbody>
              {items.bills.map((b) => (
                <tr key={b.id}>
                  <td className="font-mono text-[13px]">{b.docNo ?? "—"}</td>
                  <td>{fmtDate(b.docDate)}</td>
                  <td style={b.dueDate < today() ? { color: "#b91c1c" } : undefined}>{fmtDate(b.dueDate)}</td>
                  <td className="num">{fmtMoney(b.amount)}</td>
                  <td className="num font-medium">{fmtMoney(b.open)}</td>
                  <td><span className="chip bg-slate-100 text-slate-600">{b.status === "PART" ? t("Part paid") : t("Unpaid")}</span></td>
                  {canMatch && <td className="text-right">{b.status === "PART" &&
                    <button className="btn-ghost text-xs" disabled={busy} onClick={() => unmatch(b.id)}>{t("Unmatch")}</button>}</td>}
                </tr>
              ))}
              {items.advances.map((a) => (
                <tr key={a.id}>
                  <td className="font-mono text-[13px]">{a.docNo ?? "—"}</td>
                  <td>{fmtDate(a.docDate)}</td>
                  <td />
                  <td className="num">{fmtMoney(a.amount)}</td>
                  <td className="num font-medium">-{fmtMoney(a.open)}</td>
                  <td><span className="chip bg-slate-100 text-slate-600">{t("Advance")}</span></td>
                  {canMatch && <td className="text-right whitespace-nowrap">
                    {items.bills.length > 0 && <button className="btn text-xs" disabled={busy} onClick={() => startMatch(a)}>{t("Match")}</button>}
                    {Number(a.open) < Number(a.amount) &&
                      <button className="btn-ghost text-xs ml-1" disabled={busy} onClick={() => unmatch(a.id)}>{t("Unmatch")}</button>}</td>}
                </tr>
              ))}
              {canMatch && (items.matched ?? []).map((m) => (
                <tr key={m.id} className="muted">
                  <td className="font-mono text-[13px]">{m.docNo ?? "—"}</td>
                  <td>{fmtDate(m.docDate)}</td>
                  <td />
                  <td className="num">{fmtMoney(m.amount)}</td>
                  <td className="num">0.00</td>
                  <td><span className="chip bg-slate-100 text-slate-600">{t("Fully matched")}</span></td>
                  <td className="text-right"><button className="btn-ghost text-xs" disabled={busy} onClick={() => unmatch(m.id)}>{t("Unmatch")}</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td colSpan={4} className="text-right font-medium">{type === "CUSTOMER" ? t("Receivable") : t("Payable")}</td>
              <td className="num font-semibold">{fmtMoney(items.balance)}</td>
              <td />
              {canMatch && <td />}
            </tr></tfoot>
          </table>
        </div>
      )}

      <Drawer open={!!matching} onClose={() => setMatching(null)}
        title={`${t("Match advance")} ${matching?.docNo ?? ""}`}
        subtitle={matching ? `${t("Open")} ${fmtMoney(matching.open)} · ${t("matched")} ${fmtMoney(picked)}` : undefined}
        footer={<>
          <button className="btn-ghost" onClick={() => setMatching(null)}>{t("Cancel")}</button>
          <button className="btn" onClick={saveMatch} disabled={busy}>{busy ? "…" : t("Save")}</button>
        </>}>
        <div onKeyDown={(e) => { if (e.key === "Enter") saveMatch(); }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ textAlign: "left" }}>{t("Bill")}</th>
              <th style={{ textAlign: "left" }}>{t("Due date")}</th>
              <th style={{ textAlign: "right" }}>{t("Open")}</th>
              <th style={{ textAlign: "right" }}>{t("Match")}</th>
            </tr></thead>
            <tbody>
              {(items?.bills ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="font-mono text-[13px]">{b.docNo ?? "—"}<div className="text-[11px] muted">{fmtDate(b.docDate)}</div></td>
                  <td>{fmtDate(b.dueDate)}</td>
                  <td className="num">{fmtMoney(b.open)}</td>
                  <td className="num"><input className="inp num" style={{ width: 110 }} type="number" min={0} max={b.open}
                    value={picks[b.id] ?? ""} onChange={(e) => setPicks({ ...picks, [b.id]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="h-4 leading-4 text-[12px] mt-2" style={{ color: "var(--st-bounced-fg)" }}>{matchErr}</div>
          <p className="text-[12px] muted mt-2">{t("Whatever is not matched stays on the party as an advance. Hand matches are kept if the bills are rebuilt.")}</p>
        </div>
      </Drawer>
    </div>
  );
}
