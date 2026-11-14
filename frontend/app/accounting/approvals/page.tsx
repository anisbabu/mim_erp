"use client";
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { endpoints, fmtDate, type VoucherRequestRow } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtMoney } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";

type Status = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

/** Maker-checker queue: payments and contra vouchers above the limit wait here for a manager / admin. */
export default function ApprovalsPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const canDecide = user?.role === "MANAGER" || user?.role === "ADMIN";
  const isAdmin = user?.role === "ADMIN";
  const [status, setStatus] = useState<Status>("PENDING");
  const [rows, setRows] = useState<VoucherRequestRow[]>([]);
  const [limit, setLimit] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = (s: Status = status) => endpoints.approvals(s).then(setRows).catch((e) => setMsg({ kind: "err", text: e.message }));
  useEffect(() => { load(status); }, [status]);
  useEffect(() => {
    endpoints.approvalSettings().then((s) => setLimit(s.limit == null ? "" : String(s.limit))).catch(() => {});
  }, []);

  async function saveLimit() {
    const v = limit.trim();
    if (v !== "" && !(Number(v) >= 0)) { setMsg({ kind: "err", text: t("The approval limit can't be negative.") }); return; }
    setBusy("limit"); setMsg(null);
    try {
      const s = await endpoints.saveApprovalSettings(v === "" ? null : Number(v));
      setMsg({ kind: "ok", text: s.enabled ? `${t("Approval needed above")} ${fmtMoney(Number(s.limit))}.` : t("Voucher approval is off.") });
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(""); }
  }

  async function decide(r: VoucherRequestRow, ok: boolean) {
    const note = (notes[r.id] ?? "").trim();
    if (!ok && !note) { setMsg({ kind: "err", text: t("Give a reason for rejecting.") }); return; }
    setBusy(r.id); setMsg(null);
    try {
      if (ok) {
        const res = await endpoints.approve(r.id, note || undefined);
        setMsg({ kind: "ok", text: `${r.request_no} ${t("approved and posted as")} ${res.postedNo}.` });
      } else {
        await endpoints.reject(r.id, note);
        setMsg({ kind: "ok", text: `${r.request_no} ${t("rejected.")}` });
      }
      load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(""); }
  }

  const detail = (r: VoucherRequestRow) => {
    try {
      const p = JSON.parse(r.payload);
      if (r.kind === "CONTRA") return `${p.fromAccount} → ${p.toAccount}${p.reference ? ` · ${p.reference}` : ""}`;
      return [p.method, p.reference, p.note].filter(Boolean).join(" · ");
    } catch { return ""; }
  };
  const party = (r: VoucherRequestRow) => (lang === "bn" && r.party_name_bn ? r.party_name_bn : r.party_name) ?? "";

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Transactions"]} title={t("Voucher approvals")}
        subtitle={t("Payments and contra vouchers above the limit wait here until a manager or admin approves them.")}
        actions={isAdmin ? (
          <div className="flex items-end gap-2">
            <div className="field" style={{ width: 160 }}><label>{t("Approval limit")}</label>
              <input className="inp num" type="number" min={0} placeholder={t("Off")} value={limit} onChange={(e) => setLimit(e.target.value)} /></div>
            <button className="btn-ghost" onClick={saveLimit} disabled={busy === "limit"}>{t("Save")}</button>
          </div>) : undefined} />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(["PENDING", "APPROVED", "REJECTED", "ALL"] as Status[]).map((s) => (
          <button key={s} className={status === s ? "btn" : "btn-ghost"} onClick={() => setStatus(s)}>
            {t(({ PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", ALL: "All" } as const)[s])}</button>
        ))}
        <span className="text-[12px] muted ml-2">{t("Admins' own vouchers post directly. The maker can't approve their own voucher.")}</span>
      </div>
      {msg && <div className={`note mb-3 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}

      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 980 }}>
          <thead><tr>
            <th style={{ textAlign: "left" }}>{t("Request")}</th>
            <th style={{ textAlign: "left" }}>{t("Date")}</th>
            <th style={{ textAlign: "left" }}>{t("Type")}</th>
            <th style={{ textAlign: "left" }}>{t("Details")}</th>
            <th style={{ textAlign: "right" }}>{t("Amount")}</th>
            <th style={{ textAlign: "left" }}>{t("Entered by")}</th>
            <th style={{ textAlign: "left" }}>{t("Decision")}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-[13px]" style={{ verticalAlign: "top" }}>{r.request_no}</td>
                <td style={{ verticalAlign: "top" }}>{fmtDate(r.voucher_date)}</td>
                <td style={{ verticalAlign: "top" }}>{r.kind === "PAYMENT" ? t("Payment") : t("Contra voucher")}</td>
                <td style={{ verticalAlign: "top" }}>{r.kind === "PAYMENT" && <div className="font-medium">{r.party_code} · {party(r)}</div>}
                  <div className="text-[12px] muted">{detail(r)}</div></td>
                <td className="num font-medium" style={{ verticalAlign: "top" }}>{fmtMoney(r.amount)}</td>
                <td style={{ verticalAlign: "top" }}>{r.requested_by}<div className="text-[11px] muted">{fmtDate(r.requested_at)}</div></td>
                <td style={{ verticalAlign: "top" }}>
                  {r.status === "PENDING" && canDecide && r.requested_by !== user?.username ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input className="inp" style={{ width: 180 }} placeholder={t("Note / reason")} value={notes[r.id] ?? ""}
                        onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                      <button className="btn text-xs" disabled={busy === r.id} onClick={() => decide(r, true)}>{t("Approve")}</button>
                      <button className="btn-ghost text-xs" disabled={busy === r.id} onClick={() => decide(r, false)}>{t("Reject")}</button>
                    </div>
                  ) : r.status === "PENDING" ? (
                    <span className="chip bg-slate-100 text-slate-600">{t("Waiting for approval")}</span>
                  ) : (
                    <div>
                      <span className="chip bg-slate-100 text-slate-600">{r.status === "APPROVED" ? t("Approved") : t("Rejected")}</span>
                      <span className="text-[12px] ml-2">{r.decided_by}{r.posted_no ? ` · ${r.posted_no}` : ""}</span>
                      {r.decision_note && <div className="text-[12px] muted">{r.decision_note}</div>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">{t("Nothing here.")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
