"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import { endpoints, type Shop, type Account } from "@/lib/api";

export default function PettyCashPage() {
  const { t, dn } = useI18n();
  const [shops, setShops] = useState<Shop[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [shopId, setShopId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.shops().then(setShops).catch(() => {});
    endpoints.accounts().then((a) => setAccounts(a.filter((x) => x.type === "EXPENSE"))).catch(() => {});
  }, []);

  async function submit() {
    setMsg(null);
    if (!shopId || !expenseAccountId || !(Number(amount) > 0)) {
      setMsg({ kind: "err", text: t("Shop, expense account and amount are required.") }); return;
    }
    setBusy(true);
    try {
      const v: any = await endpoints.pettyCash({ shopId, expenseAccountId, amount: Number(amount), description });
      setMsg({ kind: "ok", text: `${t("Voucher")} ${v.voucherNo} ${t("posted (Dr expense / Cr petty cash).")}` });
      setAmount(""); setDescription("");
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-lg">
      <PageHeader crumbs={["Accounting", "Transactions"]} title={t("Petty cash voucher")}
        subtitle={t("Record a small shop expense paid from the petty-cash float (imprest system).")} />
      <div className="space-y-4">
        <div>
          <label className="text-xs text-[#6b6960]">{t("Shop")}</label>
          <select className="inp inp-shop mt-1" value={shopId} onChange={(e) => setShopId(e.target.value)}>
            <option value="">{t("Select shop…")}</option>
            {shops.map((s) => <option key={s.id} value={s.id}>{dn(s)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">{t("Expense account")}</label>
          <select className="inp mt-1" value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}>
            <option value="">{t("Select…")}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {dn(a)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">{t("Amount")}</label>
          <input className="inp mt-1 text-right tabular-nums" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">{t("Description")}</label>
          <input className="inp mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? t("Posting…") : t("Post voucher")}</button>
      </div>
      {msg && (
        <div className="mt-4 text-sm rounded-lg px-4 py-3"
             style={{ background: msg.kind === "ok" ? "#e6efe9" : "#fbeceb", color: msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
