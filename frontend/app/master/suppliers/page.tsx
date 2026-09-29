"use client";
import { useEffect, useMemo, useState } from "react";
import { endpoints, type Supplier, type SupplierGroup } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EditIcon, TrashIcon } from "@/components/Icons";

export default function SuppliersPage() {
  const { t, dn } = useI18n();
  const [rows, setRows] = useState<Supplier[]>([]);
  const [groups, setGroups] = useState<SupplierGroup[]>([]);
  const [f, setF] = useState<Partial<Supplier>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [gf, setGf] = useState<{ code: string; name: string; nameBn: string }>({ code: "", name: "", nameBn: "" });
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const [gq, setGq] = useState("");

  const load = () => {
    endpoints.suppliers().then(setRows).catch(() => {});
    endpoints.supplierGroups().then(setGroups).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  function reset() { setF({}); setEditId(null); }
  const groupById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);
  const groupName = (id?: string) => (id && groupById[id] ? dn(groupById[id]) : "—");

  function resetGroup() { setGf({ code: "", name: "", nameBn: "" }); setEditGroupId(null); }
  async function addGroup() {
    setMsg(null);
    if (!gf.code || !gf.name) { setMsg({ kind: "err", text: "Group code and name are required." }); return; }
    try {
      if (editGroupId) await endpoints.updateSupplierGroup(editGroupId, gf); else await endpoints.createSupplierGroup(gf);
      resetGroup();
      setMsg({ kind: "ok", text: t("Saved.") }); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  function editGroup(g: SupplierGroup) {
    setGf({ code: g.code, name: g.name, nameBn: g.nameBn ?? "" });
    setEditGroupId(g.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function removeGroup(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    try { await endpoints.deleteSupplierGroup(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  const filteredGroups = useMemo(() => {
    const s = gq.trim().toLowerCase();
    if (!s) return groups;
    return groups.filter((g) => [g.code, g.name, g.nameBn].filter(Boolean).some((v) => v!.toLowerCase().includes(s)));
  }, [gq, groups]);

  async function save() {
    setMsg(null);
    if (!f.code || !f.name) { setMsg({ kind: "err", text: "Code and name are required." }); return; }
    try {
      if (editId) await endpoints.updateSupplier(editId, f); else await endpoints.saveSupplier(f);
      setMsg({ kind: "ok", text: t("Saved.") }); reset(); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  async function remove(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    try { await endpoints.deleteSupplier(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  function edit(s: Supplier) { setF(s); setEditId(s.id); window.scrollTo({ top: 0, behavior: "smooth" }); }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.code, r.name, r.nameBn, r.mobile, groupById[r.groupId ?? ""]?.name, groupById[r.groupId ?? ""]?.nameBn]
        .filter(Boolean).some((v) => v!.toLowerCase().includes(s)));
  }, [q, rows, groupById]);

  return (
    <div>
      <h1 className="page-title mb-5">{t("Suppliers")}</h1>
      <div className="card p-5 mb-6">
        <div className="form-grid cols-3">
          <div className="field"><label>{t("Code")}</label>
            <input className="inp" value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label>{t("Name")}</label>
            <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label>{t("Name (Bangla)")}</label>
            <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
          <div className="field"><label>{t("Group")}</label>
            <select className="inp" value={f.groupId ?? ""} onChange={(e) => setF({ ...f, groupId: e.target.value || undefined })}>
              <option value="">—</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{dn(g)}</option>)}
            </select></div>
          <div className="field"><label>{t("Mobile")}</label>
            <input className="inp" value={f.mobile ?? ""} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Address")}</label>
            <input className="inp" value={f.address ?? ""} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button className="btn" onClick={save}>{editId ? t("Update") : t("Add")}</button>
          {editId && <button className="btn-ghost" onClick={reset}>{t("Cancel")}</button>}
          {msg && <span className="text-sm ml-1" style={{ color: msg.kind === "ok" ? "#2f6f5e" : "#b3261e" }}>{msg.text}</span>}
        </div>
      </div>
      <div className="card p-5 mb-6">
        <div className="section-label mb-3">{editGroupId ? t("Edit group") : t("New group")}</div>
        <div className="form-grid cols-3">
          <div className="field"><label>{t("Code")}</label>
            <input className="inp" value={gf.code} onChange={(e) => setGf({ ...gf, code: e.target.value })} /></div>
          <div className="field"><label>{t("Name")}</label>
            <input className="inp" value={gf.name} onChange={(e) => setGf({ ...gf, name: e.target.value })} /></div>
          <div className="field"><label>{t("Name (Bangla)")}</label>
            <input className="inp" value={gf.nameBn} onChange={(e) => setGf({ ...gf, nameBn: e.target.value })} /></div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button className="btn" onClick={addGroup}>{editGroupId ? t("Update") : t("Add")}</button>
          {editGroupId && <button className="btn-ghost" onClick={resetGroup}>{t("Cancel")}</button>}
        </div>
        <div className="mt-5 mb-3" style={{ maxWidth: 320 }}>
          <input className="inp" placeholder={t("Search groups…")} value={gq} onChange={(e) => setGq(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{t("Code")}</th><th>{t("Name")}</th><th>{t("Name (Bangla)")}</th><th className="text-right">{t("Actions")}</th></tr></thead>
            <tbody>
              {filteredGroups.map((g) => (
                <tr key={g.id}>
                  <td className="font-mono text-[13px]">{g.code}</td>
                  <td>{g.name}</td><td className="muted">{g.nameBn ?? "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-icon btn-icon-edit mr-1" title="Edit" onClick={() => editGroup(g)}><EditIcon /></button>
                    <button className="btn-icon btn-icon-del" title="Delete" onClick={() => removeGroup(g.id)}><TrashIcon /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mb-3" style={{ maxWidth: 320 }}>
        <input className="inp" placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr><th>{t("Code")}</th><th>{t("Group")}</th><th>{t("Name")}</th><th>{t("Mobile")}</th><th>{t("Address")}</th><th className="text-right">{t("Actions")}</th></tr></thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td className="font-mono text-[13px]">{s.code}</td>
                <td>{groupName(s.groupId)}</td><td>{dn(s)}</td><td>{s.mobile ?? "—"}</td><td className="muted">{s.address ?? "—"}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn-icon btn-icon-edit mr-1" title="Edit" onClick={() => edit(s)}><EditIcon /></button>
                  <button className="btn-icon btn-icon-del" title="Delete" onClick={() => remove(s.id)}><TrashIcon /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
