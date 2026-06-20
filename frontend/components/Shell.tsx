"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { Role } from "@/lib/api";

type Item = { href: string; label: string; roles: Role[] };
const ALL: Role[] = ["SALESPERSON", "MANAGER", "ACCOUNTANT", "ADMIN"];

const groups: { label: string; items: Item[] }[] = [
  { label: "", items: [{ href: "/", label: "Dashboard", roles: ALL }] },
  { label: "Purchase", items: [
    { href: "/purchase/orders/new", label: "New purchase order", roles: ["MANAGER", "ADMIN"] },
    { href: "/purchase/orders", label: "Purchase orders", roles: ["MANAGER", "ADMIN"] },
    { href: "/purchase/receive", label: "Receive goods", roles: ["MANAGER", "ADMIN"] },
  ]},
  { label: "Inventory", items: [
    { href: "/inventory/stock", label: "Stock on hand", roles: ALL },
    { href: "/inventory/variance", label: "Price variance", roles: ["MANAGER", "ACCOUNTANT", "ADMIN"] },
    { href: "/inventory/adjust", label: "Stock adjustment", roles: ["MANAGER", "ADMIN"] },
  ]},
  { label: "Sales", items: [
    { href: "/sales/new", label: "New sale", roles: ["SALESPERSON", "MANAGER", "ADMIN"] },
    { href: "/sales/challan", label: "Issue challan", roles: ["SALESPERSON", "MANAGER", "ADMIN"] },
    { href: "/sales/consolidate", label: "Day-end consolidate", roles: ["SALESPERSON", "MANAGER", "ADMIN"] },
    { href: "/sales/challans", label: "Challan list", roles: ["SALESPERSON", "MANAGER", "ADMIN"] },
    { href: "/sales/orders", label: "Sales orders", roles: ["SALESPERSON", "MANAGER", "ADMIN"] },
  ]},
  { label: "Accounting", items: [
    { href: "/accounting/coa", label: "Chart of accounts", roles: ["ACCOUNTANT", "ADMIN"] },
    { href: "/accounting/financial-year", label: "Financial year", roles: ["ACCOUNTANT", "ADMIN"] },
    { href: "/accounting/journal", label: "Journal entry", roles: ["ACCOUNTANT", "ADMIN"] },
    { href: "/accounting/payments", label: "Payments & receipts", roles: ["ACCOUNTANT", "ADMIN"] },
    { href: "/accounting/petty-cash", label: "Petty cash", roles: ["ACCOUNTANT", "ADMIN"] },
    { href: "/accounting/trial-balance", label: "Trial balance", roles: ["ACCOUNTANT", "MANAGER", "ADMIN"] },
    { href: "/accounting/pnl", label: "Profit & loss", roles: ["ACCOUNTANT", "MANAGER", "ADMIN"] },
    { href: "/accounting/balance-sheet", label: "Balance sheet", roles: ["ACCOUNTANT", "MANAGER", "ADMIN"] },
  ]},
  { label: "Administration", items: [
    { href: "/admin/users", label: "Users", roles: ["ADMIN"] },
    { href: "/hr/employees", label: "Employees", roles: ["ADMIN", "ACCOUNTANT"] },
    { href: "/master/products", label: "Products", roles: ["ADMIN"] },
    { href: "/master/suppliers", label: "Suppliers", roles: ["ADMIN"] },
    { href: "/master/customers", label: "Customers", roles: ["ADMIN"] },
    { href: "/master/shops", label: "Shops", roles: ["ADMIN"] },
    { href: "/master/warehouses", label: "Warehouses", roles: ["ADMIN"] },
  ]},
];

type Theme = "light" | "dark";
const THEME_KEY = "mim_theme";

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", t === "dark");
}

export default function Shell({ children }: { children: ReactNode }) {
  const { user, ready, logout } = useAuth();
  const { t, lang, setLang } = useI18n();
  const pathname = usePathname();
  const [openNav, setOpenNav] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  // Apply the theme on mount + whenever the user toggles it. Runs whether or
  // not the user is signed in, so the login screen honours the saved choice.
  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem(THEME_KEY)) as Theme | null;
    const initial: Theme = saved === "dark" ? "dark" : "light";
    setTheme(initial);
    applyTheme(initial);
  }, []);
  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    if (typeof window !== "undefined") localStorage.setItem(THEME_KEY, next);
  }

  if (!ready) return <div className="min-h-screen flex items-center justify-center muted">{t("Loading…")}</div>;
  if (!user) return <>{children}</>;

  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((it) => it.roles.includes(user.role)) }))
    .filter((g) => g.items.length > 0);

  const sidebar = (
    <aside className="w-60 shrink-0 bg-ash border-r border-ashdark px-3 py-5 overflow-y-auto flex flex-col h-full">
      <div className="px-2 mb-5">
        <div className="font-mono text-sm tracking-tight text-brand">MIM</div>
        <div className="text-[11px] muted">{t("Plywood & Hardware")}</div>
      </div>
      <nav className="flex flex-col gap-4 flex-1">
        {visible.map((g, i) => (
          <div key={i}>
            {g.label && <div className="section-label px-2 mb-1">{t(g.label)}</div>}
            <div className="flex flex-col gap-0.5">
              {g.items.map((n) => {
                const active = pathname === n.href;
                return (
                  <Link key={n.href} href={n.href} onClick={() => setOpenNav(false)}
                    className="px-2.5 py-1.5 rounded-lg text-sm"
                    style={active ? { background: "#2f6f5e", color: "#fff" } : { color: "var(--aside-text)" }}>
                    {t(n.label)}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-ashdark pt-3 mt-3 px-2">
        <div className="text-sm font-medium">{user.fullName || user.username}</div>
        <div className="text-[11px] muted mb-2 capitalize">{user.role.toLowerCase()}</div>
        <button className="btn-ghost btn-sm w-full" onClick={logout}>{t("Sign out")}</button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen flex bg-body">
      {/* desktop sidebar */}
      <div className="hidden md:flex h-screen sticky top-0">{sidebar}</div>

      {/* mobile drawer */}
      {openNav && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpenNav(false)} />
          <div className="absolute left-0 top-0 h-full">{sidebar}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col bg-body min-w-0">
        <header className="h-14 border-b border-line flex items-center justify-between px-4 md:px-8 gap-4 sticky top-0 z-30"
                style={{ background: "var(--header-bg)" }}>
          <button className="md:hidden btn-ghost btn-sm" onClick={() => setOpenNav(true)} aria-label="Menu">☰</button>
          <div className="flex-1" />

          {/* Theme toggle — top-right corner */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-line text-sm transition-colors hover:bg-[var(--tbl-tr-hover)]"
            style={{ background: "var(--surface)", color: "var(--text)" }}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {/* Language toggle */}
          <div className="flex items-center rounded-lg border border-line overflow-hidden text-sm">
            {(["en", "bn"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)}
                className={`px-3 h-8 text-sm font-medium transition-colors ${
                  lang === l ? "bg-brand text-white" : "text-[color:var(--muted)] hover:bg-[var(--tbl-tr-hover)]"
                }`}
                style={lang !== l ? { background: "var(--surface)" } : undefined}>
                {l === "en" ? "EN" : "বাংলা"}
              </button>
            ))}
          </div>
        </header>
        <main className="flex-1 px-4 md:px-8 py-6 md:py-7 max-w-5xl w-full overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}