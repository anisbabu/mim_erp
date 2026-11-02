"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, type AccountGroup, type LedgerRow } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EditIcon, TrashIcon } from "@/components/Icons";

const NATURES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

export default function ChartOfAccountsPage() {
  const { t, lang } = useI18n();
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // forms
  const EMPTY_LF = { code: "", name: "", nameBn: "", groupId: "", defaultDeposit: false };
  const [lf, setLf] = useState<{ code: string; name: string; nameBn: string; groupId: string; defaultDeposit: boolean }>(EMPTY_LF);
  const [gf, setGf] = useState<{ code: string; name: string; nameBn: string; nature: string; parentId: string }>(
    { code: "", name: "", nameBn: "", nature: "ASSET", parentId: "" });
  const [editId, setEditId] = useState<string | null>(null);

  function load() {
    endpoints.coaGroups().then(setGroups).catch(() => {});
    endpoints.coaLedgers().then(setLedgers).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  const groupById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);
  const gname = (g?: AccountGroup) => (g ? (lang === "bn" && g.nameBn ? g.nameBn : g.name) : "—");
  const lname = (l: LedgerRow) => (lang === "bn" && l.name_bn ? l.name_bn : l.name);
  // only ledgers under the Bank Accounts head can be the default deposit bank for cheques
  const isBankHead = groupById[lf.groupId]?.code === "A-BK";

  // ledgers grouped under their head
  const grouped = useMemo(() => {
    const s = q.trim().toLowerCase();
    const map: Record<string, LedgerRow[]> = {};
    ledgers
      .filter((l) => !s || [l.code, l.name, l.name_bn].filter(Boolean).some((v) => v!.toLowerCase().includes(s)))
      .forEach((l) => { const k = l.group_id ?? "_"; (map[k] ??= []).push(l); });
    return map;
  }, [ledgers, q]);

  async function addLedger() {
    setMsg(null);
    if (!lf.code || !lf.name || !lf.groupId) { setMsg({ kind: "err", text: t("Code, name and ledger are required.") }); return; }
    try {
      const defaultDeposit = isBankHead && lf.defaultDeposit;
      if (editId) await endpoints.updateLedger(editId, { name: lf.name, nameBn: lf.nameBn, groupId: lf.groupId, active: true, defaultDeposit });
      else await endpoints.createLedger({ code: lf.code, name: lf.name, nameBn: lf.nameBn, groupId: lf.groupId, defaultDeposit });
      setLf(EMPTY_LF); setEditId(null);
      setMsg({ kind: "ok", text: t("Saved.") }); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  function editLedger(l: LedgerRow) {
    setEditId(l.id); setLf({ code: l.code, name: l.name, nameBn: l.name_bn ?? "", groupId: l.group_id ?? "", defaultDeposit: !!l.default_deposit });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function removeLedger(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    try { await endpoints.deleteLedger(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  async function addGroup() {
    setMsg(null);
    if (!gf.code || !gf.name) { setMsg({ kind: "err", text: t("Ledger code and name are required.") }); return; }
    try {
      await endpoints.createGroup({ code: gf.code, name: gf.name, nameBn: gf.nameBn,
        nature: gf.nature as AccountGroup["nature"], parentId: gf.parentId || undefined });
      setGf({ code: "", name: "", nameBn: "", nature: "ASSET", parentId: "" });
      setMsg({ kind: "ok", text: t("Saved.") }); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  // show heads in a stable order by code
  const headOrder = useMemo(() => [...groups].sort((a, b) => a.code.localeCompare(b.code)), [groups]);

  return (
    <div>
      <h1 className="page-title mb-1">{t("Chart of accounts")}</h1>
      <p className="text-sm muted mb-6">{t("Ledgers and their sub ledgers, with live balances for the current financial year.")}</p>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        {/* new Ledger (account head) */}
        <div className="card p-5">
          <div className="section-label mb-3">{t("New Ledger")}</div>
          <div className="form-grid cols-2">
            <div className="field"><label>{t("Code")}</label>
              <input className="inp" value={gf.code} onChange={(e) => setGf({ ...gf, code: e.target.value })} /></div>
            <div className="field"><label>{t("Nature")}</label>
              <select className="inp" value={gf.nature} onChange={(e) => setGf({ ...gf, nature: e.target.value })}>
                {NATURES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select></div>
            <div className="field"><label>{t("Name")}</label>
              <input className="inp" value={gf.name} onChange={(e) => setGf({ ...gf, name: e.target.value })} /></div>
            <div className="field"><label>{t("Name (Bangla)")}</label>
              <input className="inp" value={gf.nameBn} onChange={(e) => setGf({ ...gf, nameBn: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Parent ledger (optional)")}</label>
              <select className="inp" value={gf.parentId} onChange={(e) => setGf({ ...gf, parentId: e.target.value })}>
                <option value="">— top level —</option>
                {headOrder.map((g) => <option key={g.id} value={g.id}>{g.code} · {gname(g)}</option>)}
              </select></div>
          </div>
          <div className="mt-4"><button className="btn" onClick={addGroup}>{t("Add")}</button></div>
        </div>

        {/* new Sub Ledger */}
        <div className="card p-5">
          <div className="section-label mb-3">{t("New Sub Ledger")}</div>
          <div className="form-grid cols-2">
            <div className="field"><label>{t("Code")}</label>
              <input className="inp" value={lf.code} disabled={!!editId} onChange={(e) => setLf({ ...lf, code: e.target.value })} /></div>
            <div className="field"><label>{t("Ledger")}</label>
              <select className="inp" value={lf.groupId} onChange={(e) => setLf({ ...lf, groupId: e.target.value })}>
                <option value="">—</option>
                {headOrder.map((g) => <option key={g.id} value={g.id}>{g.code} · {gname(g)}</option>)}
              </select></div>
            <div className="field"><label>{t("Name")}</label>
              <input className="inp" value={lf.name} onChange={(e) => setLf({ ...lf, name: e.target.value })} /></div>
            <div className="field"><label>{t("Name (Bangla)")}</label>
              <input className="inp" value={lf.nameBn} onChange={(e) => setLf({ ...lf, nameBn: e.target.value })} /></div>
            {isBankHead && (
              <label className="flex items-center gap-2 text-sm" style={{ gridColumn: "span 2" }}>
                <input type="checkbox" checked={lf.defaultDeposit} onChange={(e) => setLf({ ...lf, defaultDeposit: e.target.checked })} />
                {t("Default bank for cheques")}
                <span className="text-[12px] muted">— {t("cheques are posted here unless another bank is picked")}</span>
              </label>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button className="btn" onClick={addLedger}>{editId ? t("Update") : t("Add")}</button>
            {editId && <button className="btn-ghost" onClick={() => { setEditId(null); setLf(EMPTY_LF); }}>{t("Cancel")}</button>}
          </div>
        </div>
      </div>

      {msg && <div className={`note mb-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}

      <div className="mb-3" style={{ maxWidth: 320 }}>
        <input className="inp" placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {/* heads with their ledgers */}
      <div className="space-y-5">
        {headOrder.filter((g) => grouped[g.id]?.length).map((g) => {
          const rows = grouped[g.id] ?? [];
          const headTotal = rows.reduce((s, r) => s + Number(r.closing || 0), 0);
          return (
            <div key={g.id} className="card table-wrap">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50/60">
                <div className="font-medium text-sm">
                  <span className="font-mono text-xs muted mr-2">{g.code}</span>{gname(g)}
                  <span className="chip ml-2 bg-slate-100 text-slate-500">{g.nature}</span>
                </div>
                <div className="num text-sm font-medium">{headTotal.toFixed(2)}</div>
              </div>
              {/* fixed layout + shared widths keep every head's columns on the same vertical lines */}
              <table className="tbl" style={{ tableLayout: "fixed", minWidth: 760 }}>
                <colgroup>
                  <col style={{ width: 110 }} /><col /><col style={{ width: 130 }} /><col style={{ width: 130 }} />
                  <col style={{ width: 130 }} /><col style={{ width: 150 }} /><col style={{ width: 90 }} />
                </colgroup>
                <thead><tr>
                  <th style={{ textAlign: "left" }}>{t("Code")}</th><th style={{ textAlign: "left" }}>{t("Sub Ledger")}</th>
                  <th style={{ textAlign: "right" }}>{t("Opening")}</th>
                  <th style={{ textAlign: "right" }}>{t("Debit")}</th><th style={{ textAlign: "right" }}>{t("Credit")}</th>
                  <th style={{ textAlign: "right" }}>{t("Closing balance")}</th><th></th>
                </tr></thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td className="font-mono text-[13px]">{l.code}</td>
                      <td>{lname(l)}{l.party_type && <span className="chip ml-2 bg-brand-soft text-brand">{l.party_type.toLowerCase()}</span>}
                        {l.default_deposit && <span className="chip ml-2 chip-posted">{t("Default for cheques")}</span>}</td>
                      <td className="num">{(Number(l.opening_debit) - Number(l.opening_credit)).toFixed(2)}</td>
                      <td className="num">{Number(l.period_debit).toFixed(2)}</td>
                      <td className="num">{Number(l.period_credit).toFixed(2)}</td>
                      <td className="num font-medium">{Number(l.closing).toFixed(2)}</td>
                      <td className="text-right whitespace-nowrap">
                        <button className="btn-icon btn-icon-edit mr-1" title="Edit" onClick={() => editLedger(l)}><EditIcon /></button>
                        {!l.is_system && !l.party_type &&
                          <button className="btn-icon btn-icon-del" title="Delete" onClick={() => removeLedger(l.id)}><TrashIcon /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
