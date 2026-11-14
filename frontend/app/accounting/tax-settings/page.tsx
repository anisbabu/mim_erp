"use client";
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { endpoints } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** VAT switch and default rate. Selling prices include VAT; each product may override the rate. */
export default function TaxSettingsPage() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [rate, setRate] = useState("5");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.taxSettings().then((s) => { setEnabled(s.enabled); setRate(String(s.defaultRate)); })
      .catch((e) => setMsg({ kind: "err", text: e.message }));
  }, []);

  async function save() {
    const r = Number(rate);
    if (rate === "" || isNaN(r) || r < 0 || r > 100) { setMsg({ kind: "err", text: t("The default VAT rate must be between 0 and 100.") }); return; }
    setBusy(true); setMsg(null);
    try {
      const s = await endpoints.saveTaxSettings({ enabled, defaultRate: r });
      setEnabled(s.enabled); setRate(String(s.defaultRate));
      setMsg({ kind: "ok", text: t("VAT settings saved.") });
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Setup"]} title={t("VAT settings")}
        subtitle={t("Selling prices include VAT. When on, every sale splits its VAT into Output VAT (2100).")}
        actions={<button className="btn" onClick={save} disabled={busy}>{busy ? "…" : t("Save")}</button>} />

      <div className="card p-5" style={{ maxWidth: 640 }}>
        <div className="form-grid cols-2">
          <div className="field"><label>{t("Charge VAT on sales")}</label>
            <select className="inp" value={enabled ? "on" : "off"} onChange={(e) => setEnabled(e.target.value === "on")}>
              <option value="off">{t("Off")}</option>
              <option value="on">{t("On")}</option>
            </select>
            <div className="h-4 leading-4" /></div>
          <div className="field"><label>{t("Default VAT rate %")}</label>
            <input className="inp num" type="number" min={0} max={100} step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} />
            <div className="h-4 leading-4 text-[11px] muted">{t("Used when a product has no VAT rate of its own")}</div></div>
        </div>
        <ul className="text-[12px] muted mt-4 list-disc pl-5 space-y-1">
          <li>{t("The VAT inside a price is price × rate ÷ (100 + rate). The customer pays the same price.")}</li>
          <li>{t("Each sale line keeps the rate it was sold at, so a return reverses exactly that VAT.")}</li>
          <li>{t("Input VAT is keyed on the goods receipt from the supplier's VAT invoice (Mushak 6.3).")}</li>
          <li>{t("AIT / VAT deducted at source are keyed on receipt and payment vouchers.")}</li>
          <li>{t("Switching on affects new sales only; nothing already posted changes.")}</li>
        </ul>
        {msg && <div className={`note mt-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}
      </div>
    </div>
  );
}
