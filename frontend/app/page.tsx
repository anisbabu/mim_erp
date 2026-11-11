"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { appsFor } from "@/components/Shell";
import { endpoints, fmtDate, type Cheque, type Customer } from "@/lib/api";
import ChequeMaturityBoard, {
  type MaturityPick, isOpenCheque, isoDay, daysUntil, urgency, STATUS_CHIP, STATUS_LABEL,
} from "@/components/ChequeMaturityBoard";

export default function Dashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const showCheques = !!user && user.role !== "SALESPERSON";
  // home screen: one tile per app the role can open (the dashboard itself is not a tile)
  const apps = user ? appsFor(user.role).filter((a) => a.href !== "/") : [];
  return (
    <div>
      <div className="o-home mt-4 mb-8">
        {apps.map((a) => (
          <Link key={a.label} href={a.href} className="o-app">
            <span className="o-app-icon" style={{ background: a.color }}><a.icon size={30} strokeWidth={1.7} /></span>
            <span>{t(a.label)}</span>
          </Link>
        ))}
      </div>
      {showCheques && <ChequeWatch />}
    </div>
  );
}

/** Cheque maturity board + the picked day's open cheques. */
function ChequeWatch() {
  const { t } = useI18n();
  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pick, setPick] = useState<MaturityPick>(isoDay(0));

  useEffect(() => {
    endpoints.cheques().then(setCheques).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
  }, []);

  const byId = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const today = isoDay(0);
  const rows = cheques.filter((c) => isOpenCheque(c) &&
    (pick === "overdue" ? c.maturityDate < today : pick ? c.maturityDate === pick : true));

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="font-medium">{t("Cheque maturity")}</div>
          <div className="text-[12px] muted">{t("Open cheques due in the next 7 days — click a day to see them.")}</div>
        </div>
        <Link href="/accounting/cheques" className="text-sm text-brand">{t("Open cheques")} →</Link>
      </div>
      <ChequeMaturityBoard cheques={cheques} selected={pick} onSelect={setPick} />
      <div className="table-wrap mt-4">
        <table className="tbl">
          <thead>
            <tr><th>{t("Maturity")}</th><th>{t("Customer")}</th><th>{t("Cheque no.")}</th>
              <th className="text-right">{t("Amount")}</th><th>{t("Status")}</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((c) => {
              const cu = byId.get(c.customerId);
              const u = urgency(daysUntil(c.maturityDate));
              return (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">{fmtDate(c.maturityDate)}<span className={`chip ml-2 ${u.cls}`}>{u.label}</span></td>
                  <td><div>{cu?.name ?? "—"}</div><div className="text-[12px] muted">{cu?.mobile ?? ""}</div></td>
                  <td className="font-mono text-[13px]">{c.chequeNo}</td>
                  <td className="text-right tabular-nums">{Number(c.amount).toLocaleString("en-IN")}</td>
                  <td><span className={`chip ${STATUS_CHIP[c.status]}`}>{t(STATUS_LABEL[c.status])}</span></td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="text-center muted py-4">{t("No open cheques for this day.")}</td></tr>
            )}
          </tbody>
        </table>
        {rows.length > 10 && (
          <div className="text-[12px] muted mt-2">+{rows.length - 10} {t("more")} — <Link href="/accounting/cheques" className="text-brand">{t("Open cheques")}</Link></div>
        )}
      </div>
    </div>
  );
}
