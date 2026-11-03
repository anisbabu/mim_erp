"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { endpoints, type AccountGroup, type LedgerRow } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EditIcon, TrashIcon } from "@/components/Icons";
import Drawer from "@/components/Drawer";
import PageHeader from "@/components/PageHeader";
import SearchSelect, { type Option } from "@/components/SearchSelect";

type Nature = AccountGroup["nature"];
const NATURES: Nature[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const DEBIT_NATURE: Nature[] = ["ASSET", "EXPENSE"];            // normal balance = Debit
const PARTY_PREVIEW = 8;                                         // party ledgers shown before "show all"

type Totals = { opening: number; debit: number; credit: number; closing: number };
const ZERO: Totals = { opening: 0, debit: 0, credit: 0, closing: 0 };
const add = (a: Totals, b: Totals): Totals => ({
  opening: a.opening + b.opening, debit: a.debit + b.debit, credit: a.credit + b.credit, closing: a.closing + b.closing,
});
const ledgerTotals = (l: LedgerRow): Totals => ({
  opening: Number(l.opening_debit) - Number(l.opening_credit),
  debit: Number(l.period_debit), credit: Number(l.period_credit),
  closing: Number(l.closing),
});
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Signed (Dr positive) amount shown as "1,200.00 Dr" / "300.00 Cr". */
const drcr = (n: number) => (Math.abs(n) < 0.005 ? "0.00" : `${money(Math.abs(n))} ${n > 0 ? "Dr" : "Cr"}`);

type GroupForm = { code: string; name: string; nameBn: string; description: string; parentId: string; nature: Nature; active: boolean };
type LedgerForm = { code: string; name: string; nameBn: string; description: string; groupId: string; active: boolean; defaultDeposit: boolean };
type Drawer =
  | { kind: "group"; id?: string }
  | { kind: "ledger"; id?: string }
  | null;

const EMPTY_GF: GroupForm = { code: "", name: "", nameBn: "", description: "", parentId: "", nature: "ASSET", active: true };
const EMPTY_LF: LedgerForm = { code: "", name: "", nameBn: "", description: "", groupId: "", active: true, defaultDeposit: false };

export default function ChartOfAccountsPage() {
  const { t, lang } = useI18n();
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [q, setQ] = useState("");
  const [natureFilter, setNatureFilter] = useState<Nature | "ALL">("ALL");
  const [showInactive, setShowInactive] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [partyOpen, setPartyOpen] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [drawer, setDrawer] = useState<Drawer>(null);
  const [gf, setGf] = useState<GroupForm>(EMPTY_GF);
  const [lf, setLf] = useState<LedgerForm>(EMPTY_LF);
  const [editing, setEditing] = useState<{ party?: boolean; system?: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const codeTouched = useRef(false);

  function load() {
    endpoints.coaGroups().then(setGroups).catch(() => {});
    endpoints.coaLedgers().then(setLedgers).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  const gname = (g?: AccountGroup) => (g ? (lang === "bn" && g.nameBn ? g.nameBn : g.name) : "—");
  const lname = (l: LedgerRow) => (lang === "bn" && l.name_bn ? l.name_bn : l.name);
  const groupById = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g])), [groups]);

  // ---- tree ----
  const childrenOf = useMemo(() => {
    const m: Record<string, AccountGroup[]> = {};
    groups.forEach((g) => { const k = g.parentId ?? "_root"; (m[k] ??= []).push(g); });
    Object.values(m).forEach((a) => a.sort((x, y) => x.code.localeCompare(y.code)));
    return m;
  }, [groups]);
  const ledgersOf = useMemo(() => {
    const m: Record<string, LedgerRow[]> = {};
    ledgers.forEach((l) => { const k = l.group_id ?? "_none"; (m[k] ??= []).push(l); });
    Object.values(m).forEach((a) => a.sort((x, y) => x.code.localeCompare(y.code)));
    return m;
  }, [ledgers]);

  const search = q.trim().toLowerCase();
  const matches = (l: LedgerRow) =>
    !search || [l.code, l.name, l.name_bn].filter(Boolean).some((v) => v!.toLowerCase().includes(search));
  const ledgerVisible = (l: LedgerRow) => (showInactive || l.active !== false) && matches(l);

  /** group id -> rolled-up totals of every visible-or-not ledger beneath it */
  const rollup = useMemo(() => {
    const out: Record<string, Totals> = {};
    const walk = (g: AccountGroup): Totals => {
      let t = ZERO;
      (ledgersOf[g.id] ?? []).forEach((l) => { t = add(t, ledgerTotals(l)); });
      (childrenOf[g.id] ?? []).forEach((c) => { t = add(t, walk(c)); });
      out[g.id] = t;
      return t;
    };
    (childrenOf["_root"] ?? []).forEach(walk);
    return out;
  }, [childrenOf, ledgersOf]);

  /** does the group (or anything below it) have something to show under the current filters? */
  const hasVisible = useMemo(() => {
    const out: Record<string, boolean> = {};
    const walk = (g: AccountGroup): boolean => {
      const own = (ledgersOf[g.id] ?? []).some(ledgerVisible);
      const kids = (childrenOf[g.id] ?? []).map(walk).some(Boolean);
      const nameHit = !search || [g.code, g.name, g.nameBn].filter(Boolean).some((v) => v!.toLowerCase().includes(search));
      const activeOk = showInactive || g.active !== false;
      out[g.id] = activeOk && (own || kids || (nameHit && !!search) || !search);
      return out[g.id];
    };
    (childrenOf["_root"] ?? []).forEach(walk);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childrenOf, ledgersOf, search, showInactive]);

  // ---- group helpers ----
  const pathOf = (groupId?: string): string => {
    const names: string[] = [];
    let cur = groupId ? groupById[groupId] : undefined;
    for (let i = 0; cur && i < 20; i++) { names.unshift(gname(cur)); cur = cur.parentId ? groupById[cur.parentId] : undefined; }
    return names.join(" › ");
  };
  const descendantIds = (id: string): Set<string> => {
    const s = new Set<string>();
    const walk = (gid: string) => (childrenOf[gid] ?? []).forEach((c) => { s.add(c.id); walk(c.id); });
    walk(id);
    return s;
  };
  /** groups in tree order, for pickers */
  const orderedGroups = useMemo(() => {
    const out: { g: AccountGroup; depth: number }[] = [];
    const walk = (g: AccountGroup, depth: number) => { out.push({ g, depth }); (childrenOf[g.id] ?? []).forEach((c) => walk(c, depth + 1)); };
    (childrenOf["_root"] ?? []).forEach((g) => walk(g, 0));
    return out;
  }, [childrenOf]);
  const groupOptions = (exclude?: Set<string>): Option[] =>
    orderedGroups.filter(({ g }) => !exclude?.has(g.id) && g.active !== false)
      .map(({ g, depth }) => ({ value: g.id, label: `${" ".repeat(depth)}${g.code} · ${gname(g)}`, sublabel: pathOf(g.id) }));

  // ---- drawer open/close ----
  function openNewGroup(parentId = "") {
    const p = parentId ? groupById[parentId] : undefined;
    setGf({ ...EMPTY_GF, parentId, nature: p?.nature ?? "ASSET" });
    setEditing(null); setErrors({}); setDrawer({ kind: "group" });
  }
  function openEditGroup(g: AccountGroup) {
    setGf({ code: g.code, name: g.name, nameBn: g.nameBn ?? "", description: g.description ?? "",
      parentId: g.parentId ?? "", nature: g.nature, active: g.active !== false });
    setEditing({ system: !!g.system }); setErrors({}); setDrawer({ kind: "group", id: g.id });
  }
  function openNewLedger(groupId = "") {
    setLf({ ...EMPTY_LF, groupId });
    codeTouched.current = false;
    setEditing(null); setErrors({}); setDrawer({ kind: "ledger" });
    if (groupId) suggestCode(groupId);
  }
  function openEditLedger(l: LedgerRow) {
    setLf({ code: l.code, name: l.name, nameBn: l.name_bn ?? "", description: l.description ?? "",
      groupId: l.group_id ?? "", active: l.active !== false, defaultDeposit: !!l.default_deposit });
    codeTouched.current = true;
    setEditing({ party: !!l.party_type, system: !!l.is_system }); setErrors({}); setDrawer({ kind: "ledger", id: l.id });
  }
  const closeDrawer = () => { if (!busy) setDrawer(null); };

  function suggestCode(groupId: string) {
    endpoints.nextLedgerCode(groupId).then((r) => { if (!codeTouched.current) setLf((f) => ({ ...f, code: r.code })); }).catch(() => {});
  }

  // ---- save / delete ----
  async function saveGroup() {
    const e: Record<string, string> = {};
    if (!gf.code.trim()) e.code = t("Required");
    if (!gf.name.trim()) e.name = t("Required");
    setErrors(e); if (Object.keys(e).length) return;
    setBusy(true); setMsg(null);
    try {
      if (drawer?.kind === "group" && drawer.id) {
        await endpoints.updateGroup(drawer.id, { name: gf.name, nameBn: gf.nameBn, description: gf.description,
          parentId: gf.parentId || undefined, active: gf.active });
      } else {
        await endpoints.createGroup({ code: gf.code, name: gf.name, nameBn: gf.nameBn, description: gf.description,
          nature: gf.nature, parentId: gf.parentId || undefined });
      }
      setDrawer(null); setMsg({ kind: "ok", text: t("Saved.") }); load();
    } catch (err: any) { setErrors({ form: err.message }); } finally { setBusy(false); }
  }

  async function saveLedger() {
    const e: Record<string, string> = {};
    if (!lf.groupId) e.groupId = t("Required");
    if (!lf.code.trim()) e.code = t("Required");
    if (!lf.name.trim()) e.name = t("Required");
    setErrors(e); if (Object.keys(e).length) return;
    const isBank = groupById[lf.groupId]?.code === "A-BK";
    const defaultDeposit = isBank && lf.defaultDeposit;
    setBusy(true); setMsg(null);
    try {
      if (drawer?.kind === "ledger" && drawer.id) {
        await endpoints.updateLedger(drawer.id, { name: lf.name, nameBn: lf.nameBn, description: lf.description,
          groupId: lf.groupId, active: lf.active, defaultDeposit });
      } else {
        await endpoints.createLedger({ code: lf.code, name: lf.name, nameBn: lf.nameBn, description: lf.description,
          groupId: lf.groupId, defaultDeposit });
      }
      setDrawer(null); setMsg({ kind: "ok", text: t("Saved.") }); load();
    } catch (err: any) { setErrors({ form: err.message }); } finally { setBusy(false); }
  }

  async function removeLedger(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    try { await endpoints.deleteLedger(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }
  async function removeGroup(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    try { await endpoints.deleteGroup(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; };
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(groups.map((g) => g.id)));

  // ---- table rows ----
  const COLS = 7;
  function renderGroup(g: AccountGroup, depth: number): React.ReactNode {
    if (!hasVisible[g.id]) return null;
    const isOpen = search ? true : !collapsed.has(g.id);
    const tot = rollup[g.id] ?? ZERO;
    const kids = childrenOf[g.id] ?? [];
    const own = (ledgersOf[g.id] ?? []).filter(ledgerVisible);
    const party = own.filter((l) => l.party_type);
    const plain = own.filter((l) => !l.party_type);
    const showAllParty = search ? true : partyOpen.has(g.id);
    const partyShown = showAllParty ? party : party.slice(0, PARTY_PREVIEW);
    const inactive = g.active === false;
    return (
      <Fragment key={g.id}>
        <tr style={{ background: "var(--bg)", opacity: inactive ? 0.6 : 1 }}>
          <td className="font-mono text-[13px]" style={{ paddingLeft: 12 + depth * 20 }}>
            <button className="mr-1.5 w-4 text-center muted" onClick={() => setCollapsed(toggle(collapsed, g.id))}
              aria-label={isOpen ? "Collapse" : "Expand"}>{isOpen ? "▾" : "▸"}</button>{g.code}
          </td>
          <td className="font-semibold">
            {gname(g)}
            {depth === 0 && <span className="chip ml-2 bg-slate-100 text-slate-600">{t(g.nature)}</span>}
            {inactive && <span className="chip ml-2 bg-slate-100 text-slate-500">{t("Inactive")}</span>}
            {g.system && <span className="chip ml-2 bg-slate-100 text-slate-500">{t("System")}</span>}
          </td>
          <td className="num">{drcr(tot.opening)}</td>
          <td className="num">{money(tot.debit)}</td>
          <td className="num">{money(tot.credit)}</td>
          <td className="num font-semibold">{drcr(tot.closing)}</td>
          <td className="text-right whitespace-nowrap">
            <button className="btn-ghost btn-sm mr-1" title={t("New ledger")} onClick={() => openNewLedger(g.id)}>+ {t("Ledger")}</button>
            <button className="btn-ghost btn-sm mr-1" title={t("New group")} onClick={() => openNewGroup(g.id)}>+ {t("Group")}</button>
            <button className="btn-icon btn-icon-edit mr-1" title="Edit" onClick={() => openEditGroup(g)}><EditIcon /></button>
            {!g.system && <button className="btn-icon btn-icon-del" title="Delete" onClick={() => removeGroup(g.id)}><TrashIcon /></button>}
          </td>
        </tr>
        {isOpen && (
          <>
            {plain.map((l) => ledgerRow(l, depth + 1))}
            {partyShown.map((l) => ledgerRow(l, depth + 1))}
            {party.length > PARTY_PREVIEW && !search && (
              <tr>
                <td colSpan={COLS} style={{ paddingLeft: 12 + (depth + 1) * 20 + 20 }}>
                  <button className="text-[13px] text-brand" onClick={() => setPartyOpen(toggle(partyOpen, g.id))}>
                    {showAllParty ? t("Show fewer") : `${t("Show all")} ${party.length} ${t("party ledgers")}`}
                  </button>
                </td>
              </tr>
            )}
            {kids.map((c) => renderGroup(c, depth + 1))}
          </>
        )}
      </Fragment>
    );
  }

  function ledgerRow(l: LedgerRow, depth: number) {
    const tot = ledgerTotals(l);
    const inactive = l.active === false;
    return (
      <tr key={l.id} style={{ opacity: inactive ? 0.55 : 1 }}>
        <td className="font-mono text-[13px]" style={{ paddingLeft: 12 + depth * 20 + 20 }}>{l.code}</td>
        <td>
          {lname(l)}
          {l.party_type && <span className="chip ml-2 bg-brand-soft text-brand">{t(l.party_type === "CUSTOMER" ? "Customer ledger" : "Supplier ledger")}</span>}
          {l.default_deposit && <span className="chip ml-2 chip-posted">{t("Default for cheques")}</span>}
          {inactive && <span className="chip ml-2 bg-slate-100 text-slate-500">{t("Inactive")}</span>}
        </td>
        <td className="num">{drcr(tot.opening)}</td>
        <td className="num">{money(tot.debit)}</td>
        <td className="num">{money(tot.credit)}</td>
        <td className="num font-medium">{drcr(tot.closing)}</td>
        <td className="text-right whitespace-nowrap">
          <button className="btn-icon btn-icon-edit mr-1" title="Edit" onClick={() => openEditLedger(l)}><EditIcon /></button>
          {!l.is_system && !l.party_type &&
            <button className="btn-icon btn-icon-del" title="Delete" onClick={() => removeLedger(l.id)}><TrashIcon /></button>}
        </td>
      </tr>
    );
  }

  const roots = (childrenOf["_root"] ?? []).filter((g) => natureFilter === "ALL" || g.nature === natureFilter);
  const normalBalance = (n: Nature) => t(DEBIT_NATURE.includes(n) ? "Debit" : "Credit");

  // ---- drawer bodies ----
  const fieldErr = (k: string) => <div className="h-4 leading-4 text-[12px] text-red-600">{errors[k] ?? ""}</div>;

  const groupDrawerBody = (
    <div className="form-grid cols-1">
      <div className="field"><label>{t("Parent group")}</label>
        <SearchSelect
          options={[{ value: "", label: `— ${t("Top level (new class)")} —` }, ...groupOptions(drawer?.kind === "group" && drawer.id ? new Set([drawer.id, ...descendantIds(drawer.id)]) : undefined)]}
          value={gf.parentId} disabled={!!editing?.system}
          onChange={(v) => setGf((f) => ({ ...f, parentId: v, nature: v ? groupById[v]?.nature ?? f.nature : f.nature }))} />
        <div className="h-4 leading-4 text-[12px] muted">{gf.parentId ? pathOf(gf.parentId) : ""}</div></div>
      <div className="field"><label>{t("Nature")}</label>
        <select className="inp" value={gf.nature} disabled={!!gf.parentId || (drawer?.kind === "group" && !!drawer.id)}
          onChange={(e) => setGf({ ...gf, nature: e.target.value as Nature })}>
          {NATURES.map((n) => <option key={n} value={n}>{t(n)}</option>)}
        </select>
        <div className="h-4 leading-4 text-[12px] muted">{gf.parentId ? t("Inherited from the parent group") : ""} {t("Normal balance")}: {normalBalance(gf.nature)}</div></div>
      <div className="field"><label>{t("Code")} *</label>
        <input className="inp" value={gf.code} disabled={drawer?.kind === "group" && !!drawer.id}
          onChange={(e) => setGf({ ...gf, code: e.target.value })} />{fieldErr("code")}</div>
      <div className="field"><label>{t("Name")} *</label>
        <input className="inp" value={gf.name} onChange={(e) => setGf({ ...gf, name: e.target.value })} />{fieldErr("name")}</div>
      <div className="field"><label>{t("Name (Bangla)")}</label>
        <input className="inp" value={gf.nameBn} onChange={(e) => setGf({ ...gf, nameBn: e.target.value })} /></div>
      <div className="field"><label>{t("Description")}</label>
        <textarea className="inp" rows={2} value={gf.description} onChange={(e) => setGf({ ...gf, description: e.target.value })} /></div>
      {drawer?.kind === "group" && drawer.id && !editing?.system && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gf.active}
          onChange={(e) => setGf({ ...gf, active: e.target.checked })} />{t("Active")}</label>)}
      {errors.form && <div className="note note-err">{errors.form}</div>}
    </div>
  );

  const isBankGroup = groupById[lf.groupId]?.code === "A-BK";
  const lfNature = groupById[lf.groupId]?.nature;
  const ledgerDrawerBody = (
    <div className="form-grid cols-1">
      <div className="field"><label>{t("Under group")} *</label>
        <SearchSelect options={groupOptions()} value={lf.groupId} disabled={!!editing?.party}
          onChange={(v) => { setLf((f) => ({ ...f, groupId: v })); if (!(drawer?.kind === "ledger" && drawer.id)) suggestCode(v); }} />
        {fieldErr("groupId")}
        <div className="h-4 leading-4 text-[12px] muted">{lf.groupId ? pathOf(lf.groupId) : ""}</div></div>
      <div className="field"><label>{t("Code")} *</label>
        <input className="inp" value={lf.code} disabled={drawer?.kind === "ledger" && !!drawer.id}
          onChange={(e) => { codeTouched.current = true; setLf({ ...lf, code: e.target.value }); }} />{fieldErr("code")}</div>
      <div className="field"><label>{t("Name")} *</label>
        <input className="inp" value={lf.name} onChange={(e) => setLf({ ...lf, name: e.target.value })} />{fieldErr("name")}</div>
      <div className="field"><label>{t("Name (Bangla)")}</label>
        <input className="inp" value={lf.nameBn} onChange={(e) => setLf({ ...lf, nameBn: e.target.value })} /></div>
      <div className="field"><label>{t("Description")}</label>
        <textarea className="inp" rows={2} value={lf.description} onChange={(e) => setLf({ ...lf, description: e.target.value })} /></div>
      {lfNature && (
        <div className="note">{t("Nature")}: <b>{t(lfNature)}</b> · {t("Normal balance")}: <b>{normalBalance(lfNature)}</b>
          <div className="text-[12px] muted mt-1">{t("Opening balances are entered in Financial year.")}</div></div>)}
      {isBankGroup && (
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={lf.defaultDeposit}
          onChange={(e) => setLf({ ...lf, defaultDeposit: e.target.checked })} />
          <span>{t("Default bank for cheques")}<span className="block text-[12px] muted">{t("cheques are posted here unless another bank is picked")}</span></span></label>)}
      {drawer?.kind === "ledger" && drawer.id && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lf.active}
          onChange={(e) => setLf({ ...lf, active: e.target.checked })} />{t("Active")}</label>)}
      {editing?.party && <div className="note">{t("This ledger belongs to a customer or supplier and is managed automatically.")}</div>}
      {errors.form && <div className="note note-err">{errors.form}</div>}
    </div>
  );

  const isGroupDrawer = drawer?.kind === "group";
  const isEdit = !!(drawer && drawer.id);

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Setup"]} title={t("Chart of accounts")}
        subtitle={t("Groups add up their ledgers; entries are posted to ledgers only. Balances are for the current financial year.")}
        actions={<>
          <button className="btn-ghost" onClick={() => openNewGroup()}>+ {t("New group")}</button>
          <button className="btn" onClick={() => openNewLedger()}>+ {t("New ledger")}</button>
        </>} />

      {msg && <div className={`note mb-3 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className="inp" style={{ maxWidth: 280 }} placeholder={t("Search code or name…")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          {(["ALL", ...NATURES] as const).map((n) => (
            <button key={n} className={natureFilter === n ? "btn btn-sm" : "btn-ghost btn-sm"} onClick={() => setNatureFilter(n)}>
              {n === "ALL" ? t("All") : t(n)}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[13px] muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />{t("Show inactive")}</label>
        <button className="btn-ghost btn-sm" onClick={expandAll}>{t("Expand all")}</button>
        <button className="btn-ghost btn-sm" onClick={collapseAll}>{t("Collapse all")}</button>
      </div>

      <div className="card table-wrap">
        <table className="tbl" style={{ tableLayout: "fixed", minWidth: 1120 }}>
          <colgroup>
            <col style={{ width: 150 }} /><col /><col style={{ width: 130 }} />
            <col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 150 }} /><col style={{ width: 200 }} />
          </colgroup>
          <thead><tr>
            <th style={{ textAlign: "left" }}>{t("Code")}</th>
            <th style={{ textAlign: "left" }}>{t("Group / Ledger")}</th>
            <th style={{ textAlign: "right" }}>{t("Opening")}</th>
            <th style={{ textAlign: "right" }}>{t("Debit")}</th>
            <th style={{ textAlign: "right" }}>{t("Credit")}</th>
            <th style={{ textAlign: "right" }}>{t("Closing balance")}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {roots.map((g) => renderGroup(g, 0))}
            {roots.every((g) => !hasVisible[g.id]) && (
              <tr><td colSpan={COLS} className="muted text-sm" style={{ padding: 20 }}>{t("Nothing matches.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Drawer open={!!drawer} onClose={closeDrawer}
        title={isGroupDrawer ? (isEdit ? t("Edit group") : t("New group")) : (isEdit ? t("Edit ledger") : t("New ledger"))}
        subtitle={isGroupDrawer ? t("A group is a folder: it adds up the ledgers and sub-groups under it.") : t("A ledger is the account that entries are posted to.")}
        footer={<>
          <button className="btn-ghost" onClick={closeDrawer} disabled={busy}>{t("Cancel")}</button>
          <button className="btn" onClick={isGroupDrawer ? saveGroup : saveLedger} disabled={busy}>{busy ? "…" : isEdit ? t("Update") : t("Add")}</button>
        </>}>
        <div onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); isGroupDrawer ? saveGroup() : saveLedger(); } }}>
          {isGroupDrawer ? groupDrawerBody : ledgerDrawerBody}
        </div>
      </Drawer>
    </div>
  );
}
