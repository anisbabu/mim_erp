"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import TrialBalancePage from "../accounting/trial-balance/page";
import PnlPage from "../accounting/pnl/page";
import BalanceSheetPage from "../accounting/balance-sheet/page";

const TABS = [
  { key: "trial-balance", label: "Trial balance", View: TrialBalancePage },
  { key: "pnl",           label: "Profit & loss", View: PnlPage },
  { key: "balance-sheet", label: "Balance sheet", View: BalanceSheetPage },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ReportsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabKey>("trial-balance");

  // restore the tab from ?tab= so a report can be bookmarked / refreshed
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((x) => x.key === q)) setTab(q as TabKey);
  }, []);

  function pick(k: TabKey) {
    setTab(k);
    window.history.replaceState(null, "", `/reports?tab=${k}`);
  }

  const active = TABS.find((x) => x.key === tab)!;

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Reports"]} title={t("Financial reports")}
        subtitle={t("Trial balance, profit & loss and balance sheet for the current financial year.")} />
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map((x) => (
          <button key={x.key} onClick={() => pick(x.key)}
            className={x.key === tab ? "btn" : "btn-ghost"}>
            {t(x.label)}
          </button>
        ))}
      </div>
      <active.View />
    </div>
  );
}
