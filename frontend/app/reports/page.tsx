"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import Statements from "@/components/reports/Statements";
import TrialBalance from "@/components/reports/TrialBalance";
import GeneralLedgerReport from "@/components/reports/GeneralLedger";
import Aging from "@/components/reports/Aging";
import { ChecksReport, TaxReport } from "@/components/reports/TaxAndChecks";

const GROUPS = [
  { label: "Financial statements", tabs: [
    { key: "financial-position", label: "Financial position", View: () => <Statements kind="financial-position" /> },
    { key: "profit-or-loss", label: "Profit or loss", View: () => <Statements kind="profit-or-loss" /> },
    { key: "changes-in-equity", label: "Changes in equity", View: () => <Statements kind="changes-in-equity" /> },
    { key: "cash-flows", label: "Cash flows", View: () => <Statements kind="cash-flows" /> },
    { key: "trial-balance", label: "Trial balance", View: () => <TrialBalance /> },
  ]},
  { label: "Ledgers and aging", tabs: [
    { key: "ledger", label: "General ledger", View: () => <GeneralLedgerReport /> },
    { key: "aging-customer", label: "Receivables aging", View: () => <Aging type="CUSTOMER" /> },
    { key: "aging-supplier", label: "Payables aging", View: () => <Aging type="SUPPLIER" /> },
  ]},
  { label: "Compliance and controls", tabs: [
    { key: "tax", label: "VAT and AIT", View: () => <TaxReport /> },
    { key: "checks", label: "Control checks", View: () => <ChecksReport /> },
  ]},
];

const ALL = GROUPS.flatMap((g) => g.tabs);
// bookmarks from before the reports were reorganised
const LEGACY: Record<string, string> = { pnl: "profit-or-loss", "balance-sheet": "financial-position" };

export default function ReportsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState("financial-position");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab") ?? "";
    const k = LEGACY[q] ?? q;
    if (ALL.some((x) => x.key === k)) setTab(k);
  }, []);

  function pick(k: string) {
    setTab(k);
    window.history.replaceState(null, "", `/reports?tab=${k}`);
  }
  const active = ALL.find((x) => x.key === tab)!;

  return (
    <div>
      <div className="no-print">
        <PageHeader crumbs={["Accounting", "Reports"]} title={t("Financial reports")}
          subtitle={t("IFRS-format statements with last year's comparatives, ledgers, aging and control checks.")} />
        <div className="space-y-2 mb-5">
          {GROUPS.map((g) => (
            <div key={g.label} className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest font-bold muted" style={{ width: 150 }}>{t(g.label)}</span>
              {g.tabs.map((x) => (
                <button key={x.key} onClick={() => pick(x.key)} className={x.key === tab ? "btn btn-sm" : "btn-ghost btn-sm"}>
                  {t(x.label)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <active.View key={active.key} />
    </div>
  );
}
