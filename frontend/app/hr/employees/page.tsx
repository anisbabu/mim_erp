"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, type Employee, type Shop } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import SearchSelect, { type Option } from "@/components/SearchSelect";

const EMPTY: Partial<Employee> = {
  salaryType: "MONTHLY", basicSalary: 0, houseRent: 0, medical: 0,
  transport: 0, otherAllowance: 0, overtimeRate: 0, active: true,
};

export default function EmployeesPage() {
  const { t, dn } = useI18n();
  const [rows, setRows] = useState<Employee[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [f, setF] = useState<Partial<Employee>>({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = () => endpoints.employees().then(setRows).catch(() => {});
  useEffect(() => { load(); endpoints.shops().then(setShops).catch(() => {}); }, []);
  function reset() { setF({ ...EMPTY }); setEditId(null); }

  const shopOpts: Option[] = useMemo(
    () => shops.map((s) => ({ value: s.id, label: dn(s), sublabel: s.code })), [shops, dn]);
  const shopName = (id?: string) => { const s = shops.find((x) => x.id === id); return s ? dn(s) : "—"; };

  const num = (v: any) => Number(v) || 0;
  const gross = num(f.basicSalary) + num(f.houseRent) + num(f.medical) + num(f.transport) + num(f.otherAllowance);

  async function save() {
    setMsg(null);
    if (!f.code || !f.name) { setMsg({ kind: "err", text: "Code and name are required." }); return; }
    const body: Partial<Employee> = {
      ...f,
      basicSalary: num(f.basicSalary), houseRent: num(f.houseRent), medical: num(f.medical),
      transport: num(f.transport), otherAllowance: num(f.otherAllowance), overtimeRate: num(f.overtimeRate),
    };
    try {
      if (editId) await endpoints.updateEmployee(editId, body);
      else await endpoints.saveEmployee(body);
      setMsg({ kind: "ok", text: t("Saved.") }); reset(); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  async function remove(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    try { await endpoints.deleteEmployee(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  function edit(e: Employee) { setF({ ...e }); setEditId(e.id); window.scrollTo({ top: 0, behavior: "smooth" }); }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.code, r.name, r.nameBn, r.designation, r.mobile]
      .filter(Boolean).some((v) => v!.toLowerCase().includes(s)));
  }, [q, rows]);

  return (
    <div>
      <h1 className="text-2xl font-medium mb-5">{t("Employees")}</h1>

      <div className="card p-5 mb-6">
        {/* identity */}
        <div className="form-grid cols-3">
          <div className="field"><label>{t("Code")}</label>
            <input className="inp" value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label>{t("Name")}</label>
            <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label>{t("Name (Bangla)")}</label>
            <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
          <div className="field"><label>{t("Designation")}</label>
            <input className="inp" value={f.designation ?? ""} onChange={(e) => setF({ ...f, designation: e.target.value })} /></div>
          <div className="field"><label>{t("Designation")} ({t("Name (Bangla)")})</label>
            <input className="inp" value={f.designationBn ?? ""} onChange={(e) => setF({ ...f, designationBn: e.target.value })} /></div>
          <div className="field"><label>{t("Shop")}</label>
            <SearchSelect options={shopOpts} value={f.shopId ?? ""} onChange={(v) => setF({ ...f, shopId: v })} placeholder={t("Search…")} /></div>
          <div className="field"><label>{t("Mobile")}</label>
            <input className="inp" value={f.mobile ?? ""} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
          <div className="field"><label>{t("Joining date")}</label>
            <input className="inp" type="date" value={f.joiningDate ?? ""} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} /></div>
          <div className="field"><label>{t("Address")}</label>
            <input className="inp" value={f.address ?? ""} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        </div>

        {/* salary profile */}
        <div className="text-[11px] uppercase tracking-wide text-[#8b929b] mt-5 mb-2">{t("Salary profile")}</div>
        <div className="form-grid cols-4">
          <div className="field"><label>{t("Salary type")}</label>
            <select className="inp" value={f.salaryType} onChange={(e) => setF({ ...f, salaryType: e.target.value as "MONTHLY" | "DAILY" })}>
              <option value="MONTHLY">{t("Monthly")}</option><option value="DAILY">{t("Daily wage")}</option>
            </select></div>
          <div className="field"><label>{t("Basic salary")}</label>
            <input className="inp num" type="number" value={f.basicSalary ?? 0} onChange={(e) => setF({ ...f, basicSalary: Number(e.target.value) })} /></div>
          <div className="field"><label>{t("House rent")}</label>
            <input className="inp num" type="number" value={f.houseRent ?? 0} onChange={(e) => setF({ ...f, houseRent: Number(e.target.value) })} /></div>
          <div className="field"><label>{t("Medical")}</label>
            <input className="inp num" type="number" value={f.medical ?? 0} onChange={(e) => setF({ ...f, medical: Number(e.target.value) })} /></div>
          <div className="field"><label>{t("Transport")}</label>
            <input className="inp num" type="number" value={f.transport ?? 0} onChange={(e) => setF({ ...f, transport: Number(e.target.value) })} /></div>
          <div className="field"><label>{t("Other allowance")}</label>
            <input className="inp num" type="number" value={f.otherAllowance ?? 0} onChange={(e) => setF({ ...f, otherAllowance: Number(e.target.value) })} /></div>
          <div className="field"><label>{t("Overtime rate / hour")}</label>
            <input className="inp num" type="number" value={f.overtimeRate ?? 0} onChange={(e) => setF({ ...f, overtimeRate: Number(e.target.value) })} /></div>
          <div className="field"><label>{t("Gross salary")}</label>
            <input className="inp num" value={gross.toFixed(2)} readOnly /></div>
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
          <thead><tr>
            <th>{t("Code")}</th><th>{t("Name")}</th><th>{t("Designation")}</th><th>{t("Shop")}</th>
            <th>{t("Salary type")}</th><th className="text-right">{t("Gross salary")}</th><th className="text-right">{t("Actions")}</th>
          </tr></thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="font-mono text-[13px]">{e.code}</td>
                <td>{dn(e)}</td>
                <td>{e.designation ?? "—"}</td>
                <td>{shopName(e.shopId)}</td>
                <td className="text-xs">{e.salaryType === "MONTHLY" ? t("Monthly") : t("Daily wage")}</td>
                <td className="num">{Number(e.grossSalary ?? 0).toFixed(2)}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn-ghost btn-sm mr-2" onClick={() => edit(e)}>{t("Edit")}</button>
                  <button className="btn-ghost btn-sm btn-danger-ghost" onClick={() => remove(e.id)}>{t("Delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
