"use client";
import { useI18n } from "@/lib/i18n";

export default function Dashboard() {
  const { t } = useI18n();
  const cards = [
    { title: t("Purchase"), body: "POs, partial receipts, FIFO stock layers." },
    { title: t("Inventory"), body: "Per-warehouse availability, FIFO costing, variance." },
    { title: t("Sales"), body: "Order-first / delivery-first, price band, credit checks." },
    { title: t("Accounting"), body: "Perpetual double-entry: inventory, COGS, revenue, AR/AP." },
  ];
  return (
    <div>
      <h1 className="page-title mb-1">{t("MIM Enterprise")}</h1>
      <p className="text-sm muted mb-7">{t("Single application for purchase, inventory, sales and accounting.")}</p>
      <div className="grid grid-cols-2 gap-4">
        {cards.map((c) => (
          <div key={c.title} className="card p-5">
            <div className="font-medium mb-1">{c.title}</div>
            <div className="text-sm muted leading-relaxed">{c.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
