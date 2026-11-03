"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { endpoints, type Role, type Shop } from "@/lib/api";
import {
  ArrowLeftRight, Banknote, BarChart3, BookOpen, Boxes, Building2, CalendarRange, ChevronDown, ChevronRight,
  ClipboardList, FileText, Landmark, LayoutDashboard, ListTree, Package, PackageCheck, ReceiptText, Scale,
  ShoppingCart, Store, Truck, UserCog, Users, Wallet, Warehouse, type LucideIcon,
} from "lucide-react";

type Item = { href: string; label: string; roles: Role[]; icon: LucideIcon; also?: string[] };
type Heading = { heading: string };          // small caption that splits a group into sub-sections
type Entry = Item | Heading;
const isHeading = (e: Entry): e is Heading => "heading" in e;
const ALL: Role[] = ["SALESPERSON", "MANAGER", "ACCOUNTANT", "ADMIN"];
const SALES: Role[] = ["SALESPERSON", "MANAGER", "ADMIN"];
const BOOKS: Role[] = ["ACCOUNTANT", "ADMIN"];

const groups: { label: string; items: Entry[] }[] = [
  { label: "", items: [{ href: "/", label: "Dashboard", roles: ALL, icon: LayoutDashboard }] },
  { label: "Purchase", items: [
    { href: "/purchase/orders/new", label: "New purchase order", roles: ["MANAGER", "ADMIN"], icon: ShoppingCart },
    { href: "/purchase/orders", label: "Purchase orders", roles: ["MANAGER", "ADMIN"], icon: ClipboardList },
    { href: "/purchase/receive", label: "Receive goods", roles: ["MANAGER", "ADMIN"], icon: PackageCheck },
  ]},
  { label: "Inventory", items: [
    { href: "/inventory/stock", label: "Stock on hand", roles: ALL, icon: Boxes },
    { href: "/inventory/variance", label: "Price variance", roles: ["MANAGER", "ACCOUNTANT", "ADMIN"], icon: Scale },
    { href: "/inventory/adjust", label: "Stock adjustment", roles: ["MANAGER", "ADMIN"], icon: ArrowLeftRight },
  ]},
  { label: "Sales", items: [
    { href: "/sales/new", label: "Sales Order", roles: SALES, icon: ReceiptText },
    { href: "/sales/orders", label: "Sales Orders List", roles: SALES, icon: ClipboardList },
    { href: "/sales/challan", label: "Challan", roles: SALES, icon: Truck },
    { href: "/sales/challans", label: "Challan list", roles: SALES, icon: FileText },
    { href: "/sales/consolidate", label: "Day-end consolidate", roles: SALES, icon: CalendarRange },
  ]},
  { label: "Accounting", items: [
    { heading: "Setup" },
    { href: "/accounting/coa", label: "Chart of accounts", roles: BOOKS, icon: ListTree },
    { href: "/accounting/financial-year", label: "Financial year", roles: BOOKS, icon: CalendarRange },
    { heading: "Transactions" },
    { href: "/accounting/journal", label: "Journal entry", roles: BOOKS, icon: BookOpen },
    { href: "/accounting/payments", label: "Receipts & payments", roles: BOOKS, icon: Banknote },
    { href: "/accounting/cheques", label: "Cheques received", roles: BOOKS, icon: Landmark },
    { href: "/accounting/petty-cash", label: "Petty cash", roles: BOOKS, icon: Wallet },
    { heading: "Reports" },
    { href: "/reports", label: "Financial reports", roles: ["ACCOUNTANT", "MANAGER", "ADMIN"], icon: BarChart3,
      also: ["/accounting/trial-balance", "/accounting/pnl", "/accounting/balance-sheet"] },
  ]},
  { label: "Administration", items: [
    { href: "/admin/users", label: "Users", roles: ["ADMIN"], icon: UserCog },
    { href: "/hr/employees", label: "Employees", roles: ["ADMIN", "ACCOUNTANT"], icon: Users },
    { href: "/master/products", label: "Products", roles: ["ADMIN"], icon: Package },
    { href: "/master/suppliers", label: "Suppliers", roles: ["ADMIN"], icon: Building2 },
    { href: "/master/customers", label: "Customers", roles: ["ADMIN"], icon: Users },
    { href: "/master/shops", label: "Shops", roles: ["ADMIN"], icon: Store },
    { href: "/master/warehouses", label: "Warehouses", roles: ["ADMIN"], icon: Warehouse },
  ]},
];

const NAV_CLOSED_KEY = "mim_nav_closed";

type Theme = "light" | "dark";
const THEME_KEY   = "mim_theme";
const SIDEBAR_KEY = "mim_sidebar";

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", t === "dark");
}

export default function Shell({ children }: { children: ReactNode }) {
  const { user, ready, logout, activeShopId, setActiveShopId } = useAuth();
  const { t, lang, setLang } = useI18n();
  const pathname = usePathname();
  const [openNav,   setOpenNav]   = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [theme,     setTheme]     = useState<Theme>("light");
  const [shops,     setShops]     = useState<Shop[]>([]);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_CLOSED_KEY);
      if (raw) setClosedGroups(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, []);

  // load shop names for the header switcher (only useful when assigned >1 shop)
  useEffect(() => {
    if (user && user.shopIds.length > 1) {
      endpoints.shops().then(setShops).catch(() => {});
    } else {
      setShops([]);
    }
  }, [user]);

  useEffect(() => {
    const savedTheme = (typeof window !== "undefined" && localStorage.getItem(THEME_KEY)) as Theme | null;
    const initial: Theme = savedTheme === "dark" ? "dark" : "light";
    setTheme(initial);
    applyTheme(initial);

    const savedSidebar = typeof window !== "undefined" && localStorage.getItem(SIDEBAR_KEY);
    if (savedSidebar === "collapsed") setCollapsed(true);
  }, []);

  useEffect(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    function patch(el: HTMLInputElement, val: string) {
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    let busy = false;
    function onInput(e: Event) {
      if (busy) return;
      const el = e.target as HTMLInputElement;
      if (el.tagName !== "INPUT" || el.type !== "number") return;
      if (!/^0[0-9]/.test(el.value)) return;
      busy = true;
      patch(el, el.value.replace(/^0+([1-9])/, "$1"));
      busy = false;
    }

    function onBlur(e: Event) {
      const el = e.target as HTMLInputElement;
      if (el.tagName !== "INPUT" || el.type !== "number") return;
      if (el.value === "0" || el.value === "00") patch(el, "");
    }

    const ALLOWED_KEYS = new Set([
      "Backspace","Delete","Tab","Enter","Escape",
      "ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End",
      ".", "0","1","2","3","4","5","6","7","8","9",
    ]);
    function onKeyDown(e: KeyboardEvent) {
      const el = e.target as HTMLInputElement;
      if (el.tagName !== "INPUT" || el.type !== "number") return;
      if (e.ctrlKey || e.metaKey) return; // allow Ctrl+A/C/V/X
      if (!ALLOWED_KEYS.has(e.key)) e.preventDefault();
    }

    function onPaste(e: ClipboardEvent) {
      const el = e.target as HTMLInputElement;
      if (el.tagName !== "INPUT" || el.type !== "number") return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (!/^\d*\.?\d*$/.test(text)) e.preventDefault();
    }

    document.addEventListener("input",   onInput,   true);
    document.addEventListener("blur",    onBlur,    true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("paste",   onPaste,   true);
    return () => {
      document.removeEventListener("input",   onInput,   true);
      document.removeEventListener("blur",    onBlur,    true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("paste",   onPaste,   true);
    };
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    if (typeof window !== "undefined") localStorage.setItem(THEME_KEY, next);
  }

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    if (typeof window !== "undefined") localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "expanded");
  }

  if (!ready) return <div className="min-h-screen flex items-center justify-center muted">{t("Loading…")}</div>;
  if (!user) return <>{children}</>;

  // role filter; a sub-section caption stays only if at least one item under it is visible
  const visible = groups
    .map((g) => {
      const kept: Entry[] = [];
      g.items.forEach((e) => {
        if (isHeading(e)) kept.push(e);
        else if (e.roles.includes(user.role)) kept.push(e);
      });
      const items = kept.filter((e, i) => !isHeading(e) || (kept[i + 1] !== undefined && !isHeading(kept[i + 1])));
      return { ...g, items };
    })
    .filter((g) => g.items.some((e) => !isHeading(e)));

  const isActive = (n: Item) =>
    pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href + "/")) || !!n.also?.some((p) => pathname === p || pathname.startsWith(p + "/"));
  function toggleGroup(label: string) {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      try { localStorage.setItem(NAV_CLOSED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  const sidebar = (isMobile = false) => (
    <aside
      className="bg-ash border-r border-ashdark flex flex-col h-full overflow-hidden transition-all duration-200"
      style={{ width: isMobile || !collapsed ? 220 : 44 }}>

      {/* logo + collapse */}
      <div className="flex items-center justify-between px-3 py-3 shrink-0 border-b border-ashdark">
        {(!collapsed || isMobile) && (
          <div className="min-w-0">
            <div className="font-mono text-[13px] font-bold tracking-tight text-brand">MIM ERP</div>
            <div className="text-[10px] muted truncate">{t("Plywood & Hardware")}</div>
          </div>
        )}
        {!isMobile && (
          <button onClick={toggleSidebar} title={collapsed ? "Expand" : "Collapse"}
            className="shrink-0 h-6 w-6 rounded flex items-center justify-center transition-colors"
            style={{ background: "#0f766e", color: "#fff" }}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? <polyline points="5,3 9,7 5,11" /> : <polyline points="9,3 5,7 9,11" />}
            </svg>
          </button>
        )}
      </div>

      {/* nav */}
      <nav className="flex flex-col gap-2 flex-1 overflow-y-auto px-1.5 py-2">
        {visible.map((g, i) => {
          const rail = collapsed && !isMobile;                          // icon-only rail
          const hasActive = g.items.some((e) => !isHeading(e) && isActive(e));
          const open = rail || !g.label || !closedGroups.has(g.label) || hasActive;
          return (
            <div key={i}>
              {g.label && !rail && (
                <button type="button" onClick={() => toggleGroup(g.label)} aria-expanded={open}
                  className="w-full flex items-center justify-between px-2 mb-0.5 mt-1 section-label"
                  style={{ borderLeft: "2px solid #0f766e", cursor: "pointer", textAlign: "left" }}>
                  <span>{t(g.label)}</span>
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              )}
              {rail && g.label && <div className="mx-2 my-1 border-t border-ashdark" />}
              {open && (
                <div className="flex flex-col gap-0.5">
                  {g.items.map((n, j) => {
                    if (isHeading(n)) {
                      return rail ? null : (
                        <div key={`h${j}`} className="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wider font-semibold muted">
                          {t(n.heading)}
                        </div>
                      );
                    }
                    const active = isActive(n);
                    const Icon = n.icon;
                    return (
                      <Link key={n.href} href={n.href} onClick={() => setOpenNav(false)} title={rail ? t(n.label) : undefined}
                        aria-current={active ? "page" : undefined}
                        className={`${rail ? "justify-center px-0" : "px-2"} py-1.5 rounded text-[12px] transition-colors flex items-center gap-2`}
                        style={{
                          background: active ? "#0f766e" : "transparent",
                          color: active ? "#fff" : "var(--aside-text)",
                          fontWeight: active ? 600 : 500,
                          whiteSpace: "nowrap", overflow: "hidden",
                        }}>
                        <Icon size={15} strokeWidth={active ? 2.2 : 1.8} className="shrink-0" />
                        {!rail && <span className="truncate">{t(n.label)}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* user footer */}
      {(!collapsed || isMobile) && (
        <div className="border-t border-ashdark pt-2 pb-3 px-3 shrink-0">
          <div className="text-[12px] font-semibold truncate">{user.fullName || user.username}</div>
          <div className="text-[10px] muted mb-1.5 capitalize">{user.role.toLowerCase()}</div>
          <button className="btn-ghost btn-sm w-full" onClick={logout}>{t("Sign out")}</button>
        </div>
      )}
    </aside>
  );

  return (
    <div className="min-h-screen flex bg-body w-full">
      <div className="hidden md:flex h-screen sticky top-0 shrink-0">{sidebar(false)}</div>

      {openNav && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpenNav(false)} />
          <div className="absolute left-0 top-0 h-full">{sidebar(true)}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col bg-body min-w-0">
        <header className="h-10 border-b border-line flex items-center justify-between px-4 md:px-6 gap-3 sticky top-0 z-30"
                style={{ background: "var(--header-bg)" }}>
          <button className="md:hidden btn-ghost btn-sm" onClick={() => setOpenNav(true)} aria-label="Menu">☰</button>
          <div className="flex-1" />

          {user.shopIds.length > 1 && shops.length > 0 && (
            <select
              aria-label={t("Active shop")}
              className="inp inp-shop h-7 w-auto max-w-[180px] text-[12px]"
              value={activeShopId ?? ""}
              onChange={(e) => setActiveShopId(e.target.value)}>
              {shops
                .filter((s) => user.shopIds.includes(s.id))
                .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}

          <button onClick={toggleTheme} aria-label="Toggle dark mode"
            className="inline-flex items-center justify-center h-7 w-7 rounded border border-line text-[13px] transition-colors hover:bg-[var(--tbl-tr-hover)]"
            style={{ background: "var(--surface)", color: "var(--text)" }}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          <div className="flex items-center rounded border border-line overflow-hidden text-[12px]">
            {(["en", "bn"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)}
                className={`px-2.5 h-7 text-[12px] font-medium transition-colors ${
                  lang === l ? "bg-brand text-white" : "text-[color:var(--muted)] hover:bg-[var(--tbl-tr-hover)]"
                }`}
                style={lang !== l ? { background: "var(--surface)" } : undefined}>
                {l === "en" ? "EN" : "বাংলা"}
              </button>
            ))}
          </div>
        </header>
        <main className="flex-1 px-4 md:px-6 py-4 md:py-5 max-w-5xl w-full">{children}</main>
      </div>
    </div>
  );
}
