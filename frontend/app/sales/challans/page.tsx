"use client";
import { useEffect, useState, useMemo } from "react";
import { endpoints, fmtDate, type DeliveryChallan, type Customer } from "@/lib/api";
import { beep } from "@/lib/beep";
import { useI18n } from "@/lib/i18n";
import TopMessage, { type Msg } from "@/components/TopMessage";

const PAGE_SIZE = 20;

export default function ChallanListPage() {
  const { t, dn, lang } = useI18n();
  const [challans, setChallans] = useState<DeliveryChallan[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [topMsg, setTopMsg] = useState<Msg>(null);   // shown in the top message bar

  useEffect(() => {
    endpoints.allChallans().then(setChallans).catch(() => {});
    endpoints.customers()
      .then((c) => setCustomers(Object.fromEntries(c.map((x) => [x.id, x]))))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return challans;
    return challans.filter((dc) => {
      const cust = customers[dc.customerId];
      return (
        dc.dcNo.toLowerCase().includes(q) ||
        (cust?.name ?? "").toLowerCase().includes(q) ||
        (cust?.mobile ?? "").includes(q) ||
        dc.challanDate.includes(q)
      );
    });
  }, [challans, customers, search]);

  useEffect(() => { setPage(1); }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function fetchBlob(dcId: string): Promise<{ blob: Blob; url: string } | null> {
    setBusy(dcId);
    setTopMsg(null);
    try {
      const blob = await endpoints.challanBlob(dcId, lang);
      const url = URL.createObjectURL(blob);
      beep();
      return { blob, url };
    } catch (e: any) {
      setTopMsg({ kind: "err", text: e.message });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function openChallan(dcId: string) {
    const r = await fetchBlob(dcId);
    if (!r) return;
    window.open(r.url, "_blank");
  }

  async function openToken(dcId: string) {
    setBusy(dcId);
    setTopMsg(null);
    try {
      const blob = await endpoints.challanTokenBlob(dcId, lang);
      window.open(URL.createObjectURL(blob), "_blank");
      beep();
    } catch (e: any) {
      setTopMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function downloadChallan(dcId: string, dcNo: string) {
    const r = await fetchBlob(dcId);
    if (!r) return;
    const a = document.createElement("a");
    a.href = r.url;
    a.download = `${dcNo}.pdf`;
    a.click();
    URL.revokeObjectURL(r.url);
  }

  /** One click: sends the challan PDF straight to the customer's WhatsApp (Meta Cloud API) — no OS share sheet. */
  async function shareChallan(dcId: string) {
    setBusy(dcId);
    setTopMsg(null);
    try {
      const r = await endpoints.shareChallanWhatsApp(dcId, lang);
      beep();
      setTopMsg({ kind: "ok", text: `${t("Sent to WhatsApp")} ${r.sentTo}` });
    } catch (e: any) {
      setTopMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <TopMessage msg={topMsg} />
      <h1 className="page-title mb-4">{t("Challans")}</h1>

      <input
        className="inp mb-4 max-w-sm"
        placeholder={t("Search DC no, customer, mobile, date…")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="border border-line rounded-xl bg-surface overflow-hidden">
        <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>{t("DC no")}</th><th>{t("Customer")}</th><th>{t("Date")}</th><th>{t("Status")}</th><th></th></tr></thead>
          <tbody>
            {pageItems.length === 0 && (
              <tr><td colSpan={5} className="text-[var(--muted)]">
                {search ? t("No matching challans.") : t("No challans yet.")}
              </td></tr>
            )}
            {pageItems.map((dc) => {
              const cust = customers[dc.customerId];
              const loading = busy === dc.id;
              return (
                <tr key={dc.id}>
                  <td className="font-mono text-[13px] text-brand">{dc.dcNo}</td>
                  <td>
                    <div>{cust ? dn(cust) : "—"}</div>
                    {cust?.mobile && (
                      <div className="text-[12px] text-[var(--muted)]">{cust.mobile}</div>
                    )}
                  </td>
                  <td>{fmtDate(dc.challanDate)}</td>
                  <td>
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: dc.status === "ISSUED" ? "var(--chip-open-bg)" : "var(--chip-other-bg)",
                        color:      dc.status === "ISSUED" ? "var(--chip-open-fg)" : "var(--chip-other-fg)",
                      }}>
                      {t(dc.status)}
                    </span>
                    {dc.collectedAt && (
                      <div className="text-[11px] mt-1" style={{ color: "var(--role-save)" }}>
                        {t("Collected")} {fmtDate(dc.collectedAt)}
                      </div>
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="btn-ghost btn-sm" disabled={loading} title={t("Open / Print")}
                        onClick={() => openChallan(dc.id)}>
                        {loading ? "…" : `🖨 ${t("Print")}`}
                      </button>
                      <button className="btn btn-print btn-sm" disabled={loading} title={t("Download PDF")}
                        onClick={() => downloadChallan(dc.id, dc.dcNo)}>
                        ↓ PDF
                      </button>
                      <button className="btn-ghost btn-sm" disabled={loading} title={t("Print warehouse gate-pass token (with QR)")}
                        onClick={() => openToken(dc.id)}>
                        🎫 {t("Token")}
                      </button>
                      <button className="btn btn-share btn-sm" disabled={loading} title={t("Send to customer's WhatsApp")}
                        onClick={() => shareChallan(dc.id)}>
                        ↗ {t("Share")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-[var(--muted)]">
          <span>{filtered.length} {t("challans")} · {t("page")} {page} {t("of")} {totalPages}</span>
          <div className="flex gap-2">
            <button className="btn-ghost px-3 py-1"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}>← {t("Prev")}</button>
            <button className="btn-ghost px-3 py-1"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}>{t("Next")} →</button>
          </div>
        </div>
      )}
    </div>
  );
}
