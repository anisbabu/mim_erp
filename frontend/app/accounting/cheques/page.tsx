"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { endpoints, fmtDate, type Customer, type Cheque, type ChequeEvent, type ChequeStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { BD_BANKS } from "@/lib/banks";
import ChequeMaturityBoard, {
  type MaturityPick, isOpenCheque, isoDay, daysUntil, urgency,
  STATUS_CHIP, STATUS_LABEL, EVENT_CHIP, EVENT_LABEL,
} from "@/components/ChequeMaturityBoard";

type Action = "edit" | "date" | "hold" | "resume" | "cash" | "post" | "bounce" | "cancel";

const ACTION_LABEL: Record<Action, string> = {
  edit: "Edit", date: "Change date", hold: "Not to submit", resume: "Resume", cash: "Cashed", post: "Post",
  bounce: "Bounce", cancel: "Cancel cheque",
};
const ACTION_HINT: Record<Action, string> = {
  edit: "Fix details entered by mistake. Old and new values are kept in the history.",
  cancel: "Cheque entered by mistake — it is voided, nothing is posted.",
  date: "Customer asked for a different maturity date.",
  hold: "Customer asked not to submit this cheque for now.",
  resume: "Cheque can be submitted again.",
  cash: "Bank has confirmed the cheque is cashed.",
  post: "Posts Dr Bank / Cr customer — reduces the customer's balance.",
  bounce: "Cheque was returned unpaid. A posted cheque is reversed.",
};
const ACTIONS_FOR: Record<ChequeStatus, Action[]> = {
  PENDING:   ["edit", "date", "hold", "cash", "bounce", "cancel"],
  HOLD:      ["edit", "resume", "date", "bounce", "cancel"],
  CASHED:    ["post", "bounce"],
  POSTED:    ["bounce"],
  BOUNCED:   [],
  CANCELLED: [],
};
const STATUS_FILTERS: (ChequeStatus | "ALL")[] = ["ALL", "PENDING", "HOLD", "CASHED", "POSTED", "BOUNCED", "CANCELLED"];

export default function ChequesPage() {
  const { t } = useI18n();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [pick, setPick] = useState<MaturityPick>(null);
  const [statusFilter, setStatusFilter] = useState<ChequeStatus | "ALL">("ALL");
  const [q, setQ] = useState("");

  // inline action form, one cheque at a time
  const [acting, setActing] = useState<{ id: string; action: Action } | null>(null);
  const [actDate, setActDate] = useState("");
  const [actBy, setActBy] = useState("");
  const [actNote, setActNote] = useState("");
  const [actBusy, setActBusy] = useState(false);
  // edit form, prefilled from the cheque
  const [ed, setEd] = useState({ customerId: "", amount: "", chequeNo: "", bankName: "", branchName: "", maturityDate: "", note: "" });

  // per-cheque history, fetched on demand
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, ChequeEvent[]>>({});

  function load() {
    endpoints.cheques().then(setCheques).catch(() => {});
  }

  useEffect(() => {
    endpoints.customers().then(setCustomers).catch(() => {});
    load();
  }, []);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const customerOpts: Option[] = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name, sublabel: c.mobile || c.code })),
    [customers]);
  const bankOpts: Option[] = useMemo(() => BD_BANKS.map((b) => ({ value: b, label: b })), []);

  const today = isoDay(0);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return cheques.filter((c) => {
      if (pick === "overdue" && !(isOpenCheque(c) && c.maturityDate < today)) return false;
      if (pick && pick !== "overdue" && c.maturityDate !== pick) return false;
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (s) {
        const cu = byId.get(c.customerId);
        const hay = `${cu?.name ?? ""} ${cu?.mobile ?? ""} ${c.chequeNo} ${c.bankName ?? ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [cheques, pick, statusFilter, q, byId, today]);
  // cancelled cheques were never real money — keep them out of the total unless that's what is listed
  const rowsTotal = rows.reduce((s, c) =>
    c.status === "CANCELLED" && statusFilter !== "CANCELLED" ? s : s + Number(c.amount), 0);

  async function submit() {
    setMsg(null);
    if (!customerId || !(Number(amount) > 0) || !chequeNo || !maturityDate) {
      setMsg({ kind: "err", text: t("Customer, amount, cheque no. and maturity date are required.") }); return;
    }
    setBusy(true);
    try {
      await endpoints.recordCheque({ customerId, amount: Number(amount), chequeNo, bankName, branchName, maturityDate, note });
      setMsg({ kind: "ok", text: `${t("Cheque recorded")}: ${chequeNo}` });
      setCustomerId(""); setAmount(""); setChequeNo(""); setBankName(""); setBranchName(""); setMaturityDate(""); setNote("");
      load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  function openAction(c: Cheque, action: Action) {
    setActing({ id: c.id, action });
    setActDate(""); setActBy(""); setActNote("");
    if (action === "edit") setEd({
      customerId: c.customerId, amount: String(c.amount), chequeNo: c.chequeNo, bankName: c.bankName ?? "",
      branchName: c.branchName ?? "", maturityDate: c.maturityDate, note: c.note ?? "",
    });
  }

  async function submitAction() {
    if (!acting) return;
    const { id, action } = acting;
    setMsg(null);
    if (action === "date" && !actDate) { setMsg({ kind: "err", text: t("New maturity date is required.") }); return; }
    if ((action === "date" || action === "hold") && !actBy.trim()) {
      setMsg({ kind: "err", text: t("Requested by is required.") }); return;
    }
    if (action === "cancel" && !actNote.trim()) { setMsg({ kind: "err", text: t("Reason is required.") }); return; }
    if (action === "edit" && (!ed.customerId || !(Number(ed.amount) > 0) || !ed.chequeNo.trim() || !ed.maturityDate)) {
      setMsg({ kind: "err", text: t("Customer, amount, cheque no. and maturity date are required.") }); return;
    }
    setActBusy(true);
    try {
      if (action === "edit") await endpoints.editCheque(id, { ...ed, amount: Number(ed.amount) });
      else if (action === "date") await endpoints.chequeDate(id, { newMaturityDate: actDate, requestedBy: actBy, note: actNote });
      else await endpoints.chequeStep(id, action, { requestedBy: actBy, note: actNote });
      setActing(null);
      setHistory((h) => { const n = { ...h }; delete n[id]; return n; }); // refetch on next open
      if (historyOpenId === id) endpoints.chequeHistory(id).then((r) => setHistory((h) => ({ ...h, [id]: r }))).catch(() => {});
      load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setActBusy(false); }
  }

  function toggleHistory(id: string) {
    if (historyOpenId === id) { setHistoryOpenId(null); return; }
    setHistoryOpenId(id);
    if (!history[id]) endpoints.chequeHistory(id).then((r) => setHistory((h) => ({ ...h, [id]: r }))).catch(() => {});
  }

  const tk = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

  return (
    <div>
      <h1 className="page-title mb-1">{t("Cheques received")}</h1>
      <p className="text-sm muted mb-6">
        {t("Record a customer cheque and follow it to maturity. Accounting is posted only when you post a cashed cheque.")}
      </p>

      <div className="card p-5 mb-6">
        <div className="form-grid cols-4">
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Customer")}</label>
            <SearchSelect options={customerOpts} value={customerId} onChange={setCustomerId}
              placeholder={t("Search name or mobile…")} /></div>
          <div className="field"><label>{t("Amount")}</label>
            <input className="inp num" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="field"><label>{t("Maturity date")}</label>
            <input className="inp" type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} /></div>
          <div className="field"><label>{t("Cheque no.")}</label>
            <input className="inp" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></div>
          <div className="field"><label>{t("Bank")}</label>
            <SearchSelect options={bankOpts} value={bankName} onChange={setBankName}
              placeholder={t("Search bank…")} /></div>
          <div className="field"><label>{t("Branch")}</label>
            <input className="inp" value={branchName} onChange={(e) => setBranchName(e.target.value)} /></div>
          <div className="field"><label>{t("Note (optional)")}</label>
            <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button className="btn" onClick={submit} disabled={busy}>{busy ? t("Recording…") : t("Record cheque")}</button>
          {msg && <span className={`note ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</span>}
        </div>
      </div>

      <div className="flex items-baseline justify-between mb-2">
        <div className="section-label">{t("Maturity — next 7 days")}</div>
        {pick && <button className="btn-ghost text-xs" onClick={() => setPick(null)}>{t("Show all dates")}</button>}
      </div>
      <div className="mb-5"><ChequeMaturityBoard cheques={cheques} selected={pick} onSelect={setPick} /></div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {STATUS_FILTERS.map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`chip !px-2.5 !py-1 cursor-pointer ${s === "ALL" ? "" : STATUS_CHIP[s]}`}
            style={{ boxShadow: statusFilter === s ? "0 0 0 2px #0f766e" : undefined,
                     ...(s === "ALL" ? { background: "var(--chip-other-bg)", color: "var(--chip-other-fg)" } : {}) }}>
            {s === "ALL" ? t("All") : t(STATUS_LABEL[s])}
            <span className="ml-1 opacity-70">{s === "ALL" ? cheques.length : cheques.filter((c) => c.status === s).length}</span>
          </button>
        ))}
        <input className="inp ml-auto" style={{ maxWidth: 260 }} placeholder={t("Search customer, mobile, cheque…")}
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="table-wrap card">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("Maturity")}</th><th>{t("Customer")}</th><th>{t("Cheque no.")}</th><th>{t("Bank")}</th>
              <th className="text-right">{t("Amount")}</th><th>{t("Received")}</th><th>{t("Status")}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const cu = byId.get(c.customerId);
              const u = isOpenCheque(c) ? urgency(daysUntil(c.maturityDate)) : null;
              const isActing = acting?.id === c.id;
              const isHistoryOpen = historyOpenId === c.id;
              const hist = history[c.id];
              return (
                <Fragment key={c.id}>
                  <tr style={c.status === "CANCELLED" ? { opacity: 0.55 } : undefined}>
                    <td className="whitespace-nowrap">
                      {fmtDate(c.maturityDate)}
                      {u && <span className={`chip ml-2 ${u.cls}`}>{u.label}</span>}
                    </td>
                    <td>
                      <div>{cu?.name ?? "—"}</div>
                      <div className="text-[12px] muted">{cu?.mobile ?? ""}</div>
                    </td>
                    <td className="font-mono text-[13px]">{c.chequeNo}</td>
                    <td>
                      <div>{c.bankName || "—"}</div>
                      <div className="text-[12px] muted">{c.branchName ?? ""}</div>
                    </td>
                    <td className="text-right tabular-nums">{tk(Number(c.amount))}</td>
                    <td className="whitespace-nowrap">{fmtDate(c.receiveDate)}</td>
                    <td><span className={`chip ${STATUS_CHIP[c.status]}`}>{t(STATUS_LABEL[c.status])}</span></td>
                    <td className="text-right whitespace-nowrap">
                      {ACTIONS_FOR[c.status].map((a) => (
                        <button key={a} className="btn-ghost text-xs mr-1" onClick={() => openAction(c, a)}>{t(ACTION_LABEL[a])}</button>
                      ))}
                      <button className="btn-ghost text-xs" onClick={() => toggleHistory(c.id)}>
                        {isHistoryOpen ? t("Hide history") : t("History")}
                      </button>
                    </td>
                  </tr>

                  {isActing && acting && (
                    <tr style={{ background: "var(--tbl-th-bg)" }}>
                      <td colSpan={8} className="py-3">
                        <div className="text-[12px] muted mb-2">
                          <b>{t(ACTION_LABEL[acting.action])}</b> — {t(ACTION_HINT[acting.action])}
                        </div>
                        {acting.action === "edit" && (
                          <div className="form-grid cols-4 mb-3">
                            <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Customer")}</label>
                              <SearchSelect options={customerOpts} value={ed.customerId}
                                onChange={(v) => setEd((e) => ({ ...e, customerId: v }))} placeholder={t("Search name or mobile…")} /></div>
                            <div className="field"><label>{t("Amount")}</label>
                              <input className="inp num" type="number" min={0} value={ed.amount}
                                onChange={(e) => setEd((x) => ({ ...x, amount: e.target.value }))} /></div>
                            <div className="field"><label>{t("Maturity date")}</label>
                              <input className="inp" type="date" value={ed.maturityDate}
                                onChange={(e) => setEd((x) => ({ ...x, maturityDate: e.target.value }))} /></div>
                            <div className="field"><label>{t("Cheque no.")}</label>
                              <input className="inp" value={ed.chequeNo}
                                onChange={(e) => setEd((x) => ({ ...x, chequeNo: e.target.value }))} /></div>
                            <div className="field"><label>{t("Bank")}</label>
                              <SearchSelect options={bankOpts} value={ed.bankName}
                                onChange={(v) => setEd((e) => ({ ...e, bankName: v }))} placeholder={t("Search bank…")} /></div>
                            <div className="field"><label>{t("Branch")}</label>
                              <input className="inp" value={ed.branchName}
                                onChange={(e) => setEd((x) => ({ ...x, branchName: e.target.value }))} /></div>
                            <div className="field"><label>{t("Note (optional)")}</label>
                              <input className="inp" value={ed.note}
                                onChange={(e) => setEd((x) => ({ ...x, note: e.target.value }))} /></div>
                          </div>
                        )}
                        <div className="flex flex-wrap items-end gap-3">
                          {acting.action === "date" && (
                            <div className="field"><label>{t("New maturity date")}</label>
                              <input className="inp" type="date" value={actDate} onChange={(e) => setActDate(e.target.value)} /></div>
                          )}
                          {(acting.action === "date" || acting.action === "hold") && (
                            <div className="field"><label>{t("Requested by")}</label>
                              <input className="inp" placeholder={t("Who asked")} value={actBy} onChange={(e) => setActBy(e.target.value)} /></div>
                          )}
                          {acting.action !== "edit" && (
                            <div className="field flex-1 min-w-[200px]">
                              <label>{acting.action === "cancel" ? t("Reason") : t("Note (optional)")}</label>
                              <input className="inp" value={actNote} onChange={(e) => setActNote(e.target.value)} /></div>
                          )}
                          <button className="btn text-xs" disabled={actBusy} onClick={submitAction}>
                            {actBusy ? t("Saving…") : acting.action === "edit" ? t("Save changes") : t(ACTION_LABEL[acting.action])}
                          </button>
                          <button className="btn-ghost text-xs" onClick={() => setActing(null)}>{t("Cancel")}</button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {isHistoryOpen && (
                    <tr style={{ background: "var(--tbl-th-bg)" }}>
                      <td colSpan={8} className="py-3">
                        {hist === undefined && <span className="text-xs muted">{t("Loading…")}</span>}
                        {hist && hist.length === 0 && <span className="text-xs muted">{t("No history yet.")}</span>}
                        {hist && hist.length > 0 && (
                          <ol className="space-y-1.5">
                            {hist.map((h, i) => (
                              <li key={h.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                                <span className="muted tabular-nums w-6 text-right">{hist.length - i}.</span>
                                <span className="tabular-nums w-[84px]">{fmtDate(h.eventDate)}</span>
                                <span className={`chip ${EVENT_CHIP[h.eventType]}`}>{t(EVENT_LABEL[h.eventType])}</span>
                                {h.eventType === "DATE_CHANGED" && (
                                  <span>{fmtDate(h.oldMaturityDate)} → <b>{fmtDate(h.newMaturityDate)}</b></span>
                                )}
                                {h.changes && <span>{h.changes}</span>}
                                {h.requestedBy &&<span className="muted">{t("by")} {h.requestedBy}</span>}
                                {h.note && <span>· {h.note}</span>}
                                {h.userName && <span className="muted ml-auto text-[12px]">{h.userName}</span>}
                              </li>
                            ))}
                          </ol>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="text-center muted py-6">
                {cheques.length === 0 ? t("No cheques recorded yet.") : t("No cheques match this filter.")}
              </td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} className="font-semibold">{rows.length} {t("cheques")}</td>
                <td className="text-right tabular-nums font-semibold">{tk(rowsTotal)}</td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
