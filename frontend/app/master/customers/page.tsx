"use client";
import { useEffect, useMemo, useState } from "react";
import { endpoints, type Customer } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function CustomersPage() {
  const { t, dn } = useI18n();
  const [rows, setRows] = useState<Customer[]>([]);
  const [f, setF] = useState<Partial<Customer>>({ type: "INDIVIDUAL" });
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = () => endpoints.customers().then(setRows).catch(() => {});
  useEffect(() => { load(); }, []);
  function reset() { setF({ type: "INDIVIDUAL" }); setEditId(null); }
  const isParty = f.type === "PARTY";

  // Switching to INDIVIDUAL must wipe any credit fields left over from a PARTY record,
  // otherwise the next save would re-persist them on the backend.
  function setType(t: "INDIVIDUAL" | "PARTY") {
    if (t === "INDIVIDUAL") {
      const { creditLimit: _cl, creditDays: _cd, ...rest } = f as Partial<Customer>;
      setF({ ...rest, type: t });
    } else {
      setF({ ...f, type: t });
    }
  }

  async function save() {
    setMsg(null);
    if (!f.code || !f.name) { setMsg({ kind: "err", text: "Code and name are required." }); return; }
    // Strip credit fields for INDIVIDUAL customers so they're never persisted.
    const payload: Partial<Customer> = { ...f };
    if (!isParty) { delete payload.creditLimit; delete payload.creditDays; }
    try {
      if (editId) await endpoints.updateCustomer(editId, payload); else await endpoints.saveCustomer(payload);
      setMsg({ kind: "ok", text: t("Saved.") }); reset(); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  async function remove(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    try { await endpoints.deleteCustomer(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  function edit(c: Customer) { setF(c); setEditId(c.id); window.scrollTo({ top: 0, behavior: "smooth" }); }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.code, r.name, r.nameBn, r.mobile].filter(Boolean).some((v) => v!.toLowerCase().includes(s)));
  }, [q, rows]);

  return (
    <div>
      <h1 className="text-2xl font-medium mb-5">{t("Customers")}</h1>
      <div className="card p-5 mb-6">
        <div className="form-grid cols-3">
          <div className="field"><label>{t("Code")}</label>
            <input className="inp" value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label>{t("Name")}</label>
            <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label>{t("Name (Bangla)")}</label>
            <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
          <div className="field"><label>{t("Type")}</label>
            <select className="inp" value={f.type} onChange={(e) => setType(e.target.value as "INDIVIDUAL" | "PARTY")}>
              <option value="INDIVIDUAL">{t("Individual (cash)")}</option><option value="PARTY">{t("Party (credit)")}</option>
            </select></div>
          <div className="field"><label>{t("Mobile")}</label>
            <input className="inp" value={f.mobile ?? ""} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
          {isParty && <div className="field"><label>{t("Credit limit")}</label>
            <input className="inp num" type="number" value={f.creditLimit ?? ""} onChange={(e) => setF({ ...f, creditLimit: Number(e.target.value) })} /></div>}
          {isParty && <div className="field"><label>{t("Credit days")}</label>
            <input className="inp num" type="number" value={f.creditDays ?? ""} onChange={(e) => setF({ ...f, creditDays: Number(e.target.value) })} /></div>}
        </div>

        <div className="text-[11px] uppercase tracking-wide text-[#8b929b] mt-5 mb-2">{t("Delivery details (for driver)")}</div>
        <div className="form-grid cols-2">
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Delivery address")}</label>
            <input className="inp" value={f.deliveryAddress ?? ""} onChange={(e) => setF({ ...f, deliveryAddress: e.target.value })} /></div>
          <div className="field"><label>{t("Landmark")}</label>
            <input className="inp" value={f.deliveryLandmark ?? ""} onChange={(e) => setF({ ...f, deliveryLandmark: e.target.value })} /></div>
          <div className="field"><label>{t("Contact person")}</label>
            <input className="inp" value={f.deliveryContactName ?? ""} onChange={(e) => setF({ ...f, deliveryContactName: e.target.value })} /></div>
          <div className="field"><label>{t("Contact phone")}</label>
            <input className="inp" value={f.deliveryContactPhone ?? ""} onChange={(e) => setF({ ...f, deliveryContactPhone: e.target.value })} /></div>
          <div className="field"><label>{t("Map link")}</label>
            <input className="inp" placeholder="https://maps.google.com/…" value={f.deliveryMapLink ?? ""} onChange={(e) => setF({ ...f, deliveryMapLink: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Note for driver")}</label>
            <input className="inp" value={f.deliveryNote ?? ""} onChange={(e) => setF({ ...f, deliveryNote: e.target.value })} /></div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button className="btn" onClick={save}>{editId ? t("Update") : t("Add")}</button>
          {editId && <button className="btn-ghost" onClick={reset}>{t("Cancel")}</button>}
          {msg && <span className="text-sm ml-1" style={{ color: msg.kind === "ok" ? "#2f6f5e" : "#b3261e" }}>{msg.text}</span>}
        </div>
      </div>
      <div className="mb-3" style={{ maxWidth: 320 }}>
        <input className="inp" placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr><th>{t("Code")}</th><th>{t("Name")}</th><th>{t("Type")}</th>
            <th className="text-right">{t("Credit limit")}</th><th className="text-right">{t("Actions")}</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-[13px]">{c.code}</td>
                <td>{dn(c)}</td>
                <td className="text-xs">{c.type === "PARTY" ? t("Party (credit)") : t("Individual (cash)")}</td>
                <td className="num">{c.type === "PARTY" ? (c.creditLimit ?? 0) : "—"}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn-ghost btn-sm mr-2" onClick={() => edit(c)}>{t("Edit")}</button>
                  <button className="btn-ghost btn-sm btn-danger-ghost" onClick={() => remove(c.id)}>{t("Delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
