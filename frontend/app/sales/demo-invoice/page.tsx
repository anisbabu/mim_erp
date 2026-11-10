"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import QuickCustomer from "@/components/QuickCustomer";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { savePdf } from "@/components/reports/ReportKit";
import { useAuth } from "@/lib/auth";
import { endpoints, fmtDate, type Customer, type DemoInvoiceRow, type Product, type UserView } from "@/lib/api";

type Row = { pid: string; custom: boolean; name: string; unit: string; qty: string; price: string; disc: string };
const blank = (): Row => ({ pid: "", custom: false, name: "", unit: "", qty: "1", price: "", disc: "" });
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DemoInvoicePage() {
  const { t, dn, lang } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const [people, setPeople] = useState<UserView[]>([]);
  const [salesperson, setSalesperson] = useState("");
  const [salespersonBn, setSalespersonBn] = useState("");
  const [saved, setSaved] = useState<DemoInvoiceRow[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [custId, setCustId] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [err, setErr] = useState("");
  const [newCust, setNewCust] = useState(false);

  const loadSaved = () => endpoints.demoInvoices().then(setSaved).catch(() => setSaved([]));
  useEffect(() => {
    loadSaved();
    endpoints.customers().then(setCustomers).catch(() => {});
    endpoints.products().then(setProducts).catch(() => {});
    endpoints.users().then((u) => setPeople(u.filter((x) => x.active && x.role !== "ACCOUNTANT")
      .sort((p, q) => (p.fullName || p.username).localeCompare(q.fullName || q.username)))).catch(() => {});
  }, []);

  const custOpts: Option[] = useMemo(
    () => customers.map((c) => ({ value: c.id, label: dn(c), sublabel: c.code })), [customers, dn]);
  const peopleOpts: Option[] = useMemo(
    () => people.map((p) => ({ value: p.id, label: p.fullName || p.username })), [people]);
  // default the seller to whoever is signed in; still changeable
  useEffect(() => {
    if (salesperson || !user) return;
    setSalesperson(user.fullName || user.username);
  }, [user, salesperson]);
  // fill the Bangla name from the user master whenever the English name matches a user
  useEffect(() => {
    const p = people.find((x) => (x.fullName || x.username) === salesperson);
    if (p) setSalespersonBn(p.fullNameBn ?? "");
  }, [people, salesperson]);
  // same product names as the sales invoice: product table name (Bangla in Bangla mode), with thickness
  const productLabel = (p: Product) =>
    lang === "bn" && p.nameBn ? p.nameBn : p.fullName || (p.name + (p.thicknessMm ? ` (${p.thicknessMm}mm)` : ""));
  const productOpts: Option[] = useMemo(
    () => products.filter((p) => p.active !== false).map((p) => ({
      value: p.id, label: productLabel(p),
      sublabel: [p.sku, p.unit, p.priceLower != null && p.priceUpper != null ? `${p.priceLower}–${p.priceUpper}` : ""].filter(Boolean).join(" · "),
    })), [products, lang]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function pickCustomer(id: string) {
    setCustId(id);
    const c: any = customers.find((x) => x.id === id);
    if (c) { setName(dn(c)); setMobile(c.mobile ?? ""); setAddress(c.address ?? ""); }
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  // choosing a real product fills its name and unit
  function pickProduct(i: number, id: string) {
    const p = productById.get(id);
    if (p) setRow(i, { pid: id, name: productLabel(p), unit: p.unit ?? "" });
  }

  const num = (s: string) => Number(s) || 0;
  const lineAmt = (r: Row) => Math.max(0, num(r.qty) * num(r.price) - num(r.disc));
  const gross = rows.reduce((s, r) => s + num(r.qty) * num(r.price), 0);
  const total = rows.reduce((s, r) => s + lineAmt(r), 0);
  const used = rows.filter((r) => r.name.trim());

  function download(toSales = false) {
    setErr("");
    if (used.length === 0) { setErr(t("Add at least one item.")); return; }
    const bad = used.find((r) => !(num(r.qty) > 0));
    if (bad) { setErr(`${t("Enter a quantity for")} ${bad.name}`); return; }
    const lines = used.map((r) => ({ productId: r.pid || null, name: r.name.trim(), unit: r.unit.trim(), qty: num(r.qty), unitPrice: num(r.price), discount: num(r.disc) }));
    setBusy(true); setOkMsg("");
    endpoints.saveDemoInvoice({ customerId: custId || null, customerName: name, customerMobile: mobile, customerAddress: address, salesperson, salespersonBn, note, lines })
      .then((r) => {
        setOkMsg(`${t("Saved as")} ${r.code}`);
        loadSaved();
        if (toSales) { router.push(`/sales/new?demo=${r.id}`); return; }
        return savePdf(() => endpoints.demoInvoicePdf(r.id, lang), `${r.code}${lang === "bn" ? "-bn" : ""}.pdf`, setErr);
      })
      .catch((e: any) => setErr(e.message))
      .finally(() => setBusy(false));
  }

  // reopen a saved slip in the form (saving it again issues a new code)
  async function openSaved(id: string) {
    setErr(""); setOkMsg("");
    try {
      const d = await endpoints.demoInvoice(id);
      const r = d.request;
      setCustId(r.customerId ?? ""); setName(r.customerName ?? ""); setMobile(r.customerMobile ?? ""); setAddress(r.customerAddress ?? "");
      setSalesperson(r.salesperson ?? ""); setSalespersonBn(r.salespersonBn ?? ""); setNote(r.note ?? "");
      setRows(r.lines.map((l) => {
        const p = (l.productId && productById.get(l.productId)) || products.find((x) => productLabel(x) === l.name || x.name === l.name || x.fullName === l.name);
        return { pid: p?.id ?? "", custom: !p, name: l.name, unit: l.unit ?? "", qty: String(l.qty), price: String(l.unitPrice), disc: l.discount ? String(l.discount) : "" };
      }));
      setOkMsg(`${t("Editing")} ${d.code}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) { setErr(e.message); }
  }
  const pdfOf = (row: DemoInvoiceRow) =>
    savePdf(() => endpoints.demoInvoicePdf(row.id, lang), `${row.code}${lang === "bn" ? "-bn" : ""}.pdf`, setErr);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? saved.filter((r) => [r.code, r.customer_name, r.customer_mobile, r.salesperson].some((v) => v && String(v).toLowerCase().includes(k))) : saved;
  }, [saved, q]);

  function clear() { setSalesperson(user ? (user.fullName || user.username) : ""); setCustId(""); setName(""); setMobile(""); setAddress(""); setNote(""); setRows([blank()]); setErr(""); setOkMsg(""); }

  return (
    <div>
      <PageHeader crumbs={["Sales", "Transactions"]} title={t("Demo invoice")}
        subtitle={t("A priced list for a customer to compare with the market. Each slip gets a unique code and is kept below; no stock or accounts are touched.")}
        actions={<><button className="btn-ghost" onClick={clear}>{t("Clear")}</button>
          <button className="btn-ghost" onClick={() => download(false)} disabled={busy}>{t("Save & download PDF")}</button>
          <button className="btn" onClick={() => download(true)} disabled={busy}>{t("Submit to sales")}</button></>} />

      <QuickCustomer open={newCust} onClose={() => setNewCust(false)} existing={customers}
        onCreated={(c) => { setCustomers((cs) => [...cs, c]); setCustId(c.id); setName(dn(c)); setMobile(c.mobile ?? ""); setAddress(c.address ?? ""); }} />
      <div className="card p-5 mb-5">
        <div className="section-label mb-3">{t("Customer")}</div>
        <div className="form-grid cols-4">
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label className="flex items-center justify-between">{t("Pick an existing customer (optional)")}
              <button type="button" className="text-[12px] font-medium" style={{ color: "var(--brand)" }} onClick={() => setNewCust(true)}>+ {t("New customer")}</button></label>
            <SearchSelect options={custOpts} value={custId} onChange={pickCustomer} placeholder={t("Select…")} />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Customer name")}</label>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Mobile")}</label>
            <input className="inp" value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Address")}</label>
            <input className="inp" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Salesperson")}</label>
            <SearchSelect options={peopleOpts} value={people.find((p) => (p.fullName || p.username) === salesperson)?.id ?? ""}
              onChange={(id) => { const p = people.find((x) => x.id === id); if (p) { setSalesperson(p.fullName || p.username); setSalespersonBn(p.fullNameBn ?? ""); } }}
              placeholder={salesperson || t("Select…")} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Salesperson (Bangla)")}</label>
            <input className="inp" value={salespersonBn} onChange={(e) => setSalespersonBn(e.target.value)} /></div>
        </div>
      </div>

      <div className="card table-wrap mb-5">
        <table className="tbl" style={{ minWidth: 820 }}>
          <thead><tr>
            <th style={{ textAlign: "left", width: 36 }}>#</th>
            <th style={{ textAlign: "left" }}>{t("Item")}</th>
            <th style={{ textAlign: "left", width: 90 }}>{t("Unit")}</th>
            <th style={{ textAlign: "right", width: 100 }}>{t("Qty")}</th>
            <th style={{ textAlign: "right", width: 120 }}>{t("Unit price")}</th>
            <th style={{ textAlign: "right", width: 110 }}>{t("Discount")}</th>
            <th style={{ textAlign: "right", width: 120 }}>{t("Amount")}</th>
            <th style={{ width: 44 }} />
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="muted">{i + 1}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      {r.custom
                        ? <input className="inp" placeholder={t("Type the item name")} value={r.name} onChange={(e) => setRow(i, { name: e.target.value, pid: "" })} />
                        : <SearchSelect options={productOpts} value={r.pid} onChange={(id) => pickProduct(i, id)} placeholder={t("Search product…")} />}
                    </div>
                    <button className="btn-ghost btn-sm" style={{ whiteSpace: "nowrap" }}
                      title={r.custom ? t("Choose from the product list") : t("Item not in the list? Type it")}
                      onClick={() => setRow(i, { custom: !r.custom, pid: "", name: "", unit: "" })}>{r.custom ? t("List") : t("Custom")}</button>
                  </div>
                </td>
                <td><input className="inp" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} /></td>
                <td><input className="inp num" type="number" min={0} value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} /></td>
                <td><input className="inp num" type="number" min={0} value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} /></td>
                <td><input className="inp num" type="number" min={0} value={r.disc} onChange={(e) => setRow(i, { disc: e.target.value })} /></td>
                <td className="num">{money(lineAmt(r))}</td>
                <td><button className="btn-ghost btn-sm" title={t("Remove")} disabled={rows.length === 1}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {gross !== total && (
              <tr><td colSpan={6} className="text-right muted">{t("Discount")}</td><td className="num muted">- {money(gross - total)}</td><td /></tr>
            )}
            <tr><td colSpan={6} className="text-right font-medium">{t("Total")}</td><td className="num font-semibold">{money(total)}</td><td /></tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <button className="btn-ghost" onClick={() => setRows((rs) => [...rs, blank()])}>+ {t("Add item")}</button>
      </div>
      <div className="card p-5">
        <div className="field"><label>{t("Note (optional)")}</label>
          <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {err && <div className="note note-err mt-4">{err}</div>}
        {okMsg && <div className="note note-ok mt-4">{okMsg}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-8 mb-3">
        <div className="section-label">{t("Saved demo invoices")}</div>
        <div className="flex-1" />
        <input className="inp" style={{ maxWidth: 260 }} placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 760 }}>
          <thead><tr>
            <th style={{ textAlign: "left" }}>{t("Demo no.")}</th>
            <th style={{ textAlign: "left" }}>{t("Date")}</th>
            <th style={{ textAlign: "left" }}>{t("Customer")}</th>
            <th style={{ textAlign: "left" }}>{t("Salesperson")}</th>
            <th style={{ textAlign: "right" }}>{t("Total")}</th>
            <th />
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-[13px]">{r.code}</td>
                <td>{fmtDate(r.demo_date)}</td>
                <td>{r.customer_name ?? "—"}{r.customer_mobile && <span className="muted ml-2 text-[12px]">{r.customer_mobile}</span>}</td>
                <td>{r.salesperson ?? "—"}</td>
                <td className="num font-medium">{money(Number(r.total))}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn-ghost btn-sm" onClick={() => openSaved(r.id)}>{t("Open")}</button>{" "}
                  <button className="btn-ghost btn-sm" onClick={() => pdfOf(r)}>{t("PDF")}</button>{" "}
                  {r.so_no
                    ? <span className="chip bg-slate-100 text-slate-600">{r.so_no}</span>
                    : <button className="btn-ghost btn-sm" onClick={() => router.push(`/sales/new?demo=${r.id}`)}>{t("Submit to sales")}</button>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="muted text-sm" style={{ padding: 20 }}>{t("No demo invoices yet.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
