"use client";
import { useEffect, useMemo, useState } from "react";
import { endpoints, type Supplier, type SupplierGroup } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EditIcon, TrashIcon } from "@/components/Icons";

function Pager({ page, totalPages, onChange, t }: { page: number; totalPages: number; onChange: (p: number) => void; t: (s: string) => string }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center gap-2">
      <button className="btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>{t("Prev")}</button>
      <span className="text-sm muted">{t("Page")} {page} / {totalPages}</span>
      <button className="btn-ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>{t("Next")}</button>
    </div>
  );
}

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
  const PAGE_SIZE = 5;
  const [page, setPage] = useState(1);
  const [gPage, setGPage] = useState(1);

  const load = () => {
    endpoints.suppliers().then(setRows).catch(() => {});
    endpoints.supplierGroups().then(setGroups).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  function reset() { setF({}); setEditId(null); }
  const groupById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);
  const groupName = (id?: string) => (id && groupById[id] ? dn(groupById[id]) : "—");
  const groupsAsc = useMemo(() => [...groups].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })), [groups]);

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
    const list = s ? groups.filter((g) => [g.code, g.name, g.nameBn].filter(Boolean).some((v) => v!.toLowerCase().includes(s))) : groups;
    return [...list].sort((a, b) => b.code.localeCompare(a.code, undefined, { numeric: true }));
  }, [gq, groups]);
  useEffect(() => { setGPage(1); }, [gq]);
  const gTotalPages = Math.max(1, Math.ceil(filteredGroups.length / PAGE_SIZE));
  const gPageClamped = Math.min(gPage, gTotalPages);
  const pagedGroups = filteredGroups.slice((gPageClamped - 1) * PAGE_SIZE, gPageClamped * PAGE_SIZE);

  async function save() {
    setMsg(null);
    if (!f.name || (editId && !f.code)) { setMsg({ kind: "err", text: "Code and name are required." }); return; }
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
    const list = s ? rows.filter((r) =>
      [r.code, r.name, r.nameBn, r.mobile, groupById[r.groupId ?? ""]?.name, groupById[r.groupId ?? ""]?.nameBn]
        .filter(Boolean).some((v) => v!.toLowerCase().includes(s))) : rows;
    return [...list].sort((a, b) => b.code.localeCompare(a.code, undefined, { numeric: true }));
  }, [q, rows, groupById]);
  useEffect(() => { setPage(1); }, [q]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const paged = filtered.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  return (
    <div>
      <h1 className="page-title mb-5">{t("Suppliers")}</h1>
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="section-label">{editId ? t("Edit supplier") : t("New supplier")}</div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={save}>{editId ? t("Update") : t("Add")}</button>
            {editId && <button className="btn-ghost" onClick={reset}>{t("Cancel")}</button>}
            <input className="inp" style={{ maxWidth: 220 }} placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="form-grid cols-3">
          <div className="field"><label>{t("Group")}</label>
            <select className="inp" value={f.groupId ?? ""} onChange={(e) => setF({ ...f, groupId: e.target.value || undefined })}>
              <option value="">—</option>
              {groupsAsc.map((g) => <option key={g.id} value={g.id}>{dn(g)}</option>)}
            </select></div>
          <div className="field"><label>{t("Code")}</label>
            <input className="inp" placeholder={editId ? "" : t("Auto if blank")} value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label>{t("Name")}</label>
            <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label>{t("Name (Bangla)")}</label>
            <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
          <div className="field"><label>{t("Mobile")}</label>
            <input className="inp" value={f.mobile ?? ""} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Address")}</label>
            <input className="inp" value={f.address ?? ""} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        </div>
        {msg && <div className="mt-3 text-sm" style={{ color: msg.kind === "ok" ? "#2f6f5e" : "#b3261e" }}>{msg.text}</div>}
      </div>
      <div className="card table-wrap mb-6">
        <table className="tbl">
          <thead><tr><th>{t("Code")}</th><th>{t("Group")}</th><th>{t("Name")}</th><th>{t("Name (Bangla)")}</th><th>{t("Mobile")}</th><th className="text-right">{t("Actions")}</th></tr></thead>
          <tbody>
            {paged.map((s) => (
              <tr key={s.id}>
                <td className="font-mono text-[13px]">{s.code}</td>
                <td>{groupName(s.groupId)}</td><td>{s.name}</td><td className="muted">{s.nameBn ?? "—"}</td><td>{s.mobile ?? "—"}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn-icon btn-icon-edit mr-1" title="Edit" onClick={() => edit(s)}><EditIcon /></button>
                  <button className="btn-icon btn-icon-del" title="Delete" onClick={() => remove(s.id)}><TrashIcon /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={pageClamped} totalPages={totalPages} onChange={setPage} t={t} />

      <div className="card p-5 mt-8 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="section-label">{editGroupId ? t("Edit group") : t("New group")}</div>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={addGroup}>{editGroupId ? t("Update") : t("Add")}</button>
            {editGroupId && <button className="btn-ghost" onClick={resetGroup}>{t("Cancel")}</button>}
            <input className="inp" style={{ maxWidth: 220 }} placeholder={t("Search groups…")} value={gq} onChange={(e) => setGq(e.target.value)} />
          </div>
        </div>
        <div className="form-grid cols-3">
          <div className="field"><label>{t("Code")}</label>
            <input className="inp" value={gf.code} onChange={(e) => setGf({ ...gf, code: e.target.value })} /></div>
          <div className="field"><label>{t("Name")}</label>
            <input className="inp" value={gf.name} onChange={(e) => setGf({ ...gf, name: e.target.value })} /></div>
          <div className="field"><label>{t("Name (Bangla)")}</label>
            <input className="inp" value={gf.nameBn} onChange={(e) => setGf({ ...gf, nameBn: e.target.value })} /></div>
        </div>
      </div>
      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr><th>{t("Code")}</th><th>{t("Name")}</th><th>{t("Name (Bangla)")}</th><th className="text-right">{t("Actions")}</th></tr></thead>
          <tbody>
            {pagedGroups.map((g) => (
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
      <Pager page={gPageClamped} totalPages={gTotalPages} onChange={setGPage} t={t} />
    </div>
  );
}
