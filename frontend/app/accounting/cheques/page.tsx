"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  endpoints, fmtDate, type Account, type BounceReason, type Customer, type Cheque, type ChequeReminderSettings, type ChequeEvent, type ChequeStatus,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { BD_BANKS } from "@/lib/banks";
import ChequeMaturityBoard, {
  type MaturityPick, isOpenCheque, isoDay, daysUntil, urgency,
  STATUS_CHIP, STATUS_LABEL, EVENT_CHIP, EVENT_LABEL,
} from "@/components/ChequeMaturityBoard";

type Action = "edit" | "date" | "hold" | "resume" | "cash" | "post" | "bounce" | "resubmit" | "cancel";

const ACTION_LABEL: Record<Action, string> = {
  edit: "Edit", date: "Change date", hold: "Not to submit", resume: "Resume", cash: "Cashed", post: "Post",
  bounce: "Bounce", resubmit: "Submit again", cancel: "Cancel cheque",
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
  resubmit: "Customer asked to present the bounced cheque again — it goes back to pending.",
};
const ACTIONS_FOR: Record<ChequeStatus, Action[]> = {
  PENDING:   ["edit", "date", "hold", "cash", "bounce", "cancel"],
  HOLD:      ["edit", "resume", "date", "bounce", "cancel"],
  CASHED:    ["post", "bounce"],
  POSTED:    ["bounce"],
  BOUNCED:   ["resubmit"],
  CANCELLED: [],
};
const STATUS_FILTERS: (ChequeStatus | "ALL")[] = ["ALL", "PENDING", "HOLD", "CASHED", "POSTED", "BOUNCED", "CANCELLED"];
const BOUNCE_REASON_LABEL: Record<BounceReason, string> = {
  INSUFFICIENT_FUNDS: "Insufficient funds", SIGNATURE_MISMATCH: "Signature mismatch", OTHER: "Other",
};
// bulk steps only make sense for these two statuses
const BULKABLE: ChequeStatus[] = ["PENDING", "CASHED"];

/** An earlier, not-cancelled cheque with the same number (and bank, when both are known). */
function findDuplicate(cheques: Cheque[], chequeNo: string, bankName: string, selfId?: string): Cheque | undefined {
  const no = chequeNo.trim().toLowerCase();
  if (!no) return undefined;
  const bank = bankName.trim().toLowerCase();
  return cheques.find((o) => o.id !== selfId && o.status !== "CANCELLED" && o.chequeNo.trim().toLowerCase() === no
    && (!bank || !o.bankName || o.bankName.toLowerCase() === bank));
}

export default function ChequesPage() {
  const { t, lang } = useI18n();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [bankAccounts, setBankAccounts] = useState<Account[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [note, setNote] = useState("");
  const [custDue, setCustDue] = useState<number | null>(null);
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
  const [actReason, setActReason] = useState<BounceReason | "">("");
  const [actBank, setActBank] = useState("");
  const [actBusy, setActBusy] = useState(false);
  // edit form, prefilled from the cheque
  const [ed, setEd] = useState({ customerId: "", amount: "", chequeNo: "", bankName: "", branchName: "", maturityDate: "", note: "" });

  // bulk selection (pending → cashed, cashed → posted)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBank, setBulkBank] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // per-cheque history, fetched on demand
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, ChequeEvent[]>>({});

  function load() {
    endpoints.cheques().then(setCheques).catch(() => {});
  }

  // WhatsApp maturity reminder (sent automatically 09:00 the day before maturity)
  const [rem, setRem] = useState<ChequeReminderSettings | null>(null);
  useEffect(() => { endpoints.chequeReminderSettings().then(setRem).catch(() => {}); }, []);
  async function saveRem(next: { enabled: boolean; lang: "en" | "bn" }) {
    try { setRem(await endpoints.saveChequeReminderSettings(next)); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  async function sendReminder(c: Cheque) {
    setMsg(null);
    try {
      await endpoints.remindCheque(c.id);
      setMsg({ kind: "ok", text: `${t("WhatsApp reminder sent")}: ${byId.get(c.customerId)?.name ?? ""}` });
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
    load();
  }

  useEffect(() => {
    endpoints.customers().then(setCustomers).catch(() => {});
    endpoints.chequeBankAccounts().then((a) => {
      setBankAccounts(a);
      if (a.length) { setActBank(a[0].code); setBulkBank(a[0].code); }
    }).catch(() => {});
    load();
  }, []);

  useEffect(() => {
    setCustDue(null);
    if (!customerId) return;
    endpoints.customerBalance(customerId).then((r) => setCustDue(Number(r.balance))).catch(() => {});
  }, [customerId]);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const chequeById = useMemo(() => new Map(cheques.map((c) => [c.id, c])), [cheques]);
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

  const dup = findDuplicate(cheques, chequeNo, bankName);
  const custOpen = customerId
    ? cheques.filter((c) => c.customerId === customerId && isOpenCheque(c)).reduce((s, c) => s + Number(c.amount), 0)
    : 0;

  const bulkRows = rows.filter((c) => BULKABLE.includes(c.status));
  const sel = [...selected].map((id) => chequeById.get(id)).filter((c): c is Cheque => !!c);
  const selPending = sel.filter((c) => c.status === "PENDING");
  const selCashed = sel.filter((c) => c.status === "CASHED");
  const allBulkSelected = bulkRows.length > 0 && bulkRows.every((c) => selected.has(c.id));

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
    setActDate(""); setActBy(""); setActNote(""); setActReason("");
    if (bankAccounts.length) setActBank(bankAccounts[0].code);
    if (action === "edit") setEd({
      customerId: c.customerId, amount: String(c.amount), chequeNo: c.chequeNo, bankName: c.bankName ?? "",
      branchName: c.branchName ?? "", maturityDate: c.maturityDate, note: c.note ?? "",
    });
  }

  function refreshHistory(id: string) {
    setHistory((h) => { const n = { ...h }; delete n[id]; return n; }); // refetch on next open
    if (historyOpenId === id) endpoints.chequeHistory(id).then((r) => setHistory((h) => ({ ...h, [id]: r }))).catch(() => {});
  }

  async function submitAction() {
    if (!acting) return;
    const { id, action } = acting;
    setMsg(null);
    if ((action === "date" || action === "resubmit") && !actDate) {
      setMsg({ kind: "err", text: t("New maturity date is required.") }); return;
    }
    if ((action === "date" || action === "hold") && !actBy.trim()) {
      setMsg({ kind: "err", text: t("Requested by is required.") }); return;
    }
    if (action === "cancel" && !actNote.trim()) { setMsg({ kind: "err", text: t("Reason is required.") }); return; }
    if (action === "bounce" && !actReason) { setMsg({ kind: "err", text: t("Pick a bounce reason.") }); return; }
    if (action === "bounce" && actReason === "OTHER" && !actNote.trim()) {
      setMsg({ kind: "err", text: t("Describe the reason when it is Other.") }); return;
    }
    if (action === "edit" && (!ed.customerId || !(Number(ed.amount) > 0) || !ed.chequeNo.trim() || !ed.maturityDate)) {
      setMsg({ kind: "err", text: t("Customer, amount, cheque no. and maturity date are required.") }); return;
    }
    setActBusy(true);
    try {
      if (action === "edit") await endpoints.editCheque(id, { ...ed, amount: Number(ed.amount) });
      else if (action === "date") await endpoints.chequeDate(id, { newMaturityDate: actDate, requestedBy: actBy, note: actNote });
      else if (action === "resubmit") await endpoints.chequeResubmit(id, { newMaturityDate: actDate, note: actNote });
      else if (action === "post") await endpoints.chequeStep(id, "post", { depositAccount: actBank, note: actNote });
      else if (action === "bounce") await endpoints.chequeStep(id, "bounce", { reason: actReason, note: actNote });
      else await endpoints.chequeStep(id, action, { requestedBy: actBy, note: actNote });
      setActing(null);
      refreshHistory(id);
      load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setActBusy(false); }
  }

  async function runBulk(step: "cash" | "post", list: Cheque[]) {
    setMsg(null);
    setBulkBusy(true);
    const failed: string[] = [];
    for (const c of list) {
      try {
        await endpoints.chequeStep(c.id, step, step === "post" ? { depositAccount: bulkBank } : {});
        refreshHistory(c.id);
      } catch (e: any) { failed.push(`${c.chequeNo}: ${e.message}`); }
    }
    setBulkBusy(false);
    setSelected(new Set());
    load();
    const done = list.length - failed.length;
    setMsg(failed.length
      ? { kind: "err", text: `${done} ${t("done")}; ${t("failed")} — ${failed.join("; ")}` }
      : { kind: "ok", text: `${done} ${t("cheques")} ${step === "cash" ? t("marked cashed") : t("posted")}` });
  }

  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function toggleAll() {
    setSelected(allBulkSelected ? new Set() : new Set(bulkRows.map((c) => c.id)));
  }

  async function openReceipt(id: string) {
    try {
      const blob = await endpoints.chequeReceiptBlob(id, lang);
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  function toggleHistory(id: string) {
    if (historyOpenId === id) { setHistoryOpenId(null); return; }
    setHistoryOpenId(id);
    if (!history[id]) endpoints.chequeHistory(id).then((r) => setHistory((h) => ({ ...h, [id]: r }))).catch(() => {});
  }

  const tk = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const bankAccountOptions = bankAccounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>);
  const editDup = acting?.action === "edit" ? findDuplicate(cheques, ed.chequeNo, ed.bankName, acting.id) : undefined;
  const dupText = (d: Cheque) =>
    `${t("Already recorded")}: ${byId.get(d.customerId)?.name ?? ""} · ${t(STATUS_LABEL[d.status])}`;

  return (
    <div>
      <h1 className="page-title mb-1">{t("Cheques received")}</h1>
      <p className="text-sm muted mb-6">
        {t("Record a customer cheque and follow it to maturity. Accounting is posted only when you post a cashed cheque.")}
      </p>

      {rem && (
        <div className="card p-4 mb-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={rem.enabled} onChange={(e) => saveRem({ enabled: e.target.checked, lang: rem.lang })} />
            {t("WhatsApp reminder to customer the day before maturity")}
          </label>
          <label className="flex items-center gap-2">
            {t("Message language")}
            <select className="inp" style={{ width: "auto" }} value={rem.lang}
              onChange={(e) => saveRem({ enabled: rem.enabled, lang: e.target.value as "en" | "bn" })}>
              <option value="bn">বাংলা</option>
              <option value="en">English</option>
            </select>
          </label>
          {!rem.configured && <span className="chip chip-hold">{t("WhatsApp not configured on server")}</span>}
        </div>
      )}

      <div className="card p-5 mb-6">
        <div className="form-grid cols-4">
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Customer")}</label>
            <SearchSelect options={customerOpts} value={customerId} onChange={setCustomerId}
              placeholder={t("Search name or mobile…")} />
            <div className="h-4 leading-4 text-[12px] muted">
              {customerId && custDue !== null && (
                <>
                  {t("Due")} <b className="tabular-nums">৳{tk(custDue)}</b>
                  {custOpen > 0 && <> · {t("Open cheques")} <span className="tabular-nums">৳{tk(custOpen)}</span></>}
                  {Number(amount) > 0 && Number(amount) > custDue - custOpen && (
                    <span style={{ color: "var(--st-today-fg)" }}> · {t("More than the due")}</span>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="field"><label>{t("Amount")}</label>
            <input className="inp num" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="field"><label>{t("Maturity date")}</label>
            <input className="inp" type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} /></div>
          <div className="field"><label>{t("Cheque no.")}</label>
            <input className="inp" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
            <div className="h-4 leading-4 text-[12px] truncate" style={{ color: "var(--st-bounced-fg)" }}>
              {dup && dupText(dup)}
            </div>
          </div>
          <div className="field"><label>{t("Bank")}</label>
            <SearchSelect options={bankOpts} value={bankName} onChange={setBankName}
              placeholder={t("Search bank…")} /></div>
          <div className="field"><label>{t("Branch")}</label>
            <input className="inp" value={branchName} onChange={(e) => setBranchName(e.target.value)} /></div>
          <div className="field"><label>{t("Note (optional)")}</label>
            <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button className="btn" onClick={submit} disabled={busy || !!dup}>{busy ? t("Recording…") : t("Record cheque")}</button>
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

      {sel.length > 0 && (
        <div className="card px-4 py-2.5 mb-3 flex flex-wrap items-center gap-3 text-[13px]">
          <span><b>{sel.length}</b> {t("selected")} · <span className="tabular-nums">৳{tk(sel.reduce((s, c) => s + Number(c.amount), 0))}</span></span>
          {selPending.length > 0 && (
            <button className="btn text-xs" disabled={bulkBusy} onClick={() => runBulk("cash", selPending)}>
              {t("Mark cashed")} ({selPending.length})
            </button>
          )}
          {selCashed.length > 0 && (
            <span className="flex items-center gap-2">
              <select className="inp !py-1 text-xs" style={{ width: "auto" }} value={bulkBank} onChange={(e) => setBulkBank(e.target.value)}>
                {bankAccountOptions}
              </select>
              <button className="btn text-xs" disabled={bulkBusy} onClick={() => runBulk("post", selCashed)}>
                {t("Post")} ({selCashed.length})
              </button>
            </span>
          )}
          {bulkBusy && <span className="muted">{t("Saving…")}</span>}
          <button className="btn-ghost text-xs ml-auto" onClick={() => setSelected(new Set())}>{t("Clear selection")}</button>
        </div>
      )}

      <div className="table-wrap card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" checked={allBulkSelected} disabled={bulkRows.length === 0} onChange={toggleAll}
                  title={t("Select pending and cashed cheques")} />
              </th>
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
                    <td>
                      {BULKABLE.includes(c.status) && (
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                      )}
                    </td>
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
                    <td>
                      <span className={`chip ${STATUS_CHIP[c.status]}`}>{t(STATUS_LABEL[c.status])}</span>
                      {isOpenCheque(c) && c.reminderStatus && c.reminderForDate === c.maturityDate && (
                        <div className="text-[12px]" title={c.reminderError ?? ""}>
                          <span className={`chip ${c.reminderStatus === "SENT" ? "chip-cashed" : "chip-bounced"}`}>
                            {t(c.reminderStatus === "SENT" ? "Reminder sent" : "Reminder failed")}
                          </span>
                        </div>
                      )}
                      {c.status === "POSTED" && c.depositAccount && (
                        <div className="text-[12px] muted">{bankAccounts.find((a) => a.code === c.depositAccount)?.name ?? c.depositAccount}</div>
                      )}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {ACTIONS_FOR[c.status].map((a) => (
                        <button key={a} className="btn-ghost text-xs mr-1" onClick={() => openAction(c, a)}>{t(ACTION_LABEL[a])}</button>
                      ))}
                      {(c.status === "PENDING" || c.status === "CASHED") && rem?.configured && (
                        <button className="btn-ghost text-xs mr-1" onClick={() => sendReminder(c)}>{t("Remind")}</button>
                      )}
                      {c.status !== "CANCELLED" && (
                        <button className="btn-ghost text-xs mr-1" onClick={() => openReceipt(c.id)}>{t("Receipt")}</button>
                      )}
                      <button className="btn-ghost text-xs" onClick={() => toggleHistory(c.id)}>
                        {isHistoryOpen ? t("Hide history") : t("History")}
                      </button>
                    </td>
                  </tr>

                  {isActing && acting && (
                    <tr style={{ background: "var(--tbl-th-bg)" }}>
                      <td colSpan={9} className="py-3">
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
                                onChange={(e) => setEd((x) => ({ ...x, chequeNo: e.target.value }))} />
                              <div className="h-4 leading-4 text-[12px] truncate" style={{ color: "var(--st-bounced-fg)" }}>
                                {editDup && dupText(editDup)}
                              </div>
                            </div>
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
                          {(acting.action === "date" || acting.action === "resubmit") && (
                            <div className="field"><label>{t("New maturity date")}</label>
                              <input className="inp" type="date" value={actDate} onChange={(e) => setActDate(e.target.value)} /></div>
                          )}
                          {(acting.action === "date" || acting.action === "hold") && (
                            <div className="field"><label>{t("Requested by")}</label>
                              <input className="inp" placeholder={t("Who asked")} value={actBy} onChange={(e) => setActBy(e.target.value)} /></div>
                          )}
                          {acting.action === "post" && (
                            <div className="field"><label>{t("Deposit to")}</label>
                              <select className="inp" value={actBank} onChange={(e) => setActBank(e.target.value)}>
                                {bankAccountOptions}
                              </select></div>
                          )}
                          {acting.action === "bounce" && (
                            <div className="field"><label>{t("Bounce reason")}</label>
                              <select className="inp" value={actReason} onChange={(e) => setActReason(e.target.value as BounceReason | "")}>
                                <option value="">{t("Select…")}</option>
                                {(Object.keys(BOUNCE_REASON_LABEL) as BounceReason[]).map((r) => (
                                  <option key={r} value={r}>{t(BOUNCE_REASON_LABEL[r])}</option>
                                ))}
                              </select></div>
                          )}
                          {acting.action !== "edit" && (
                            <div className="field flex-1 min-w-[200px]">
                              <label>
                                {acting.action === "cancel" ? t("Reason")
                                  : acting.action === "bounce" && actReason === "OTHER" ? t("Details (required)")
                                  : t("Note (optional)")}
                              </label>
                              <input className="inp" value={actNote} onChange={(e) => setActNote(e.target.value)} /></div>
                          )}
                          <button className="btn text-xs" disabled={actBusy || !!editDup} onClick={submitAction}>
                            {actBusy ? t("Saving…") : acting.action === "edit" ? t("Save changes") : t(ACTION_LABEL[acting.action])}
                          </button>
                          <button className="btn-ghost text-xs" onClick={() => setActing(null)}>{t("Cancel")}</button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {isHistoryOpen && (
                    <tr style={{ background: "var(--tbl-th-bg)" }}>
                      <td colSpan={9} className="py-3">
                        {hist === undefined && <span className="text-xs muted">{t("Loading…")}</span>}
                        {hist && hist.length === 0 && <span className="text-xs muted">{t("No history yet.")}</span>}
                        {hist && hist.length > 0 && (
                          <ol className="space-y-1.5">
                            {hist.map((h, i) => (
                              <li key={h.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                                <span className="muted tabular-nums w-6 text-right">{hist.length - i}.</span>
                                <span className="tabular-nums w-[84px]">{fmtDate(h.eventDate)}</span>
                                <span className={`chip ${EVENT_CHIP[h.eventType]}`}>{t(EVENT_LABEL[h.eventType])}</span>
                                {(h.eventType === "DATE_CHANGED" || h.eventType === "RESUBMITTED") && h.newMaturityDate && (
                                  <span>{fmtDate(h.oldMaturityDate)} → <b>{fmtDate(h.newMaturityDate)}</b></span>
                                )}
                                {h.reason && <b>{t(BOUNCE_REASON_LABEL[h.reason])}</b>}
                                {h.changes && <span>{h.changes}</span>}
                                {h.requestedBy && <span className="muted">{t("by")} {h.requestedBy}</span>}
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
              <tr><td colSpan={9} className="text-center muted py-6">
                {cheques.length === 0 ? t("No cheques recorded yet.") : t("No cheques match this filter.")}
              </td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={5} className="font-semibold">{rows.length} {t("cheques")}</td>
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
