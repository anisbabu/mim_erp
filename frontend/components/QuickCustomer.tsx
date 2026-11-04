"use client";

import { useState } from "react";
import Drawer from "@/components/Drawer";
import { endpoints, type Customer } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Next free CUS-#### code, from the codes already loaded. */
function nextCode(existing: Customer[]): string {
  let max = 0;
  for (const c of existing) {
    const m = /^CUS-(\d+)$/.exec(c.code ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CUS-${String(max + 1).padStart(4, "0")}`;
}

/** Right-hand drawer to add a customer without leaving the sales screen. */
export default function QuickCustomer({ open, onClose, existing, onCreated }: {
  open: boolean; onClose: () => void; existing: Customer[]; onCreated: (c: Customer) => void;
}) {
  const { t } = useI18n();
  const blank = { name: "", nameBn: "", mobile: "", address: "", type: "INDIVIDUAL" as "INDIVIDUAL" | "PARTY", creditLimit: "", creditDays: "" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof blank>) => setF((x) => ({ ...x, ...p }));
  const party = f.type === "PARTY";

  function close() { setF(blank); setErr(""); onClose(); }

  async function save() {
    setErr("");
    if (!f.name.trim()) { setErr(t("Name is required.")); return; }
    if (party && !(Number(f.creditLimit) > 0)) { setErr(t("Party customers need a credit limit")); return; }
    setBusy(true);
    try {
      const payload: Partial<Customer> = {
        code: nextCode(existing), name: f.name.trim(), nameBn: f.nameBn.trim() || undefined,
        mobile: f.mobile.trim() || undefined, address: f.address.trim() || undefined,
        deliveryAddress: f.address.trim() || undefined, type: f.type,
        creditLimit: party ? Number(f.creditLimit) : 0, creditDays: party ? Number(f.creditDays) || 0 : 0,
      };
      const c = await endpoints.saveCustomer(payload);
      onCreated(c);
      close();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Drawer open={open} title={t("New customer")} subtitle={t("Added to the customer list and selected for this sale.")} onClose={close}
      footer={<>
        <button className="btn-ghost" onClick={close}>{t("Cancel")}</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? t("Saving…") : t("Save")}</button>
      </>}>
      <div onKeyDown={(e) => { if (e.key === "Enter" && !busy) save(); }}>
        <div className="field"><label>{t("Name")} *</label>
          <input className="inp" autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div className="field mt-3"><label>{t("Name (Bangla)")}</label>
          <input className="inp" value={f.nameBn} onChange={(e) => set({ nameBn: e.target.value })} /></div>
        <div className="field mt-3"><label>{t("Mobile")}</label>
          <input className="inp" value={f.mobile} onChange={(e) => set({ mobile: e.target.value })} /></div>
        <div className="field mt-3"><label>{t("Address")}</label>
          <input className="inp" value={f.address} onChange={(e) => set({ address: e.target.value })} /></div>
        <div className="field mt-3"><label>{t("Type")}</label>
          <select className="inp" value={f.type} onChange={(e) => set({ type: e.target.value as "INDIVIDUAL" | "PARTY" })}>
            <option value="INDIVIDUAL">{t("Individual (cash)")}</option>
            <option value="PARTY">{t("Party (credit)")}</option>
          </select></div>
        {party && (
          <div className="form-grid cols-2 mt-3">
            <div className="field"><label>{t("Credit limit")} *</label>
              <input className="inp num" type="number" min={0} value={f.creditLimit} onChange={(e) => set({ creditLimit: e.target.value })} /></div>
            <div className="field"><label>{t("Credit days")}</label>
              <input className="inp num" type="number" min={0} value={f.creditDays} onChange={(e) => set({ creditDays: e.target.value })} /></div>
          </div>
        )}
        <div className="h-4 leading-4 text-[12px] mt-3" style={{ color: "#b3261e" }}>{err}</div>
        <div className="text-[12px] muted mt-2">{t("Code")}: <span className="font-mono">{nextCode(existing)}</span></div>
      </div>
    </Drawer>
  );
}
