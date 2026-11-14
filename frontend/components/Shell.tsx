"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { endpoints, type Role, type Shop } from "@/lib/api";
import {
  ArrowLeftRight, Banknote, BarChart3, BookOpen, Boxes, Building2, CalendarRange, ChevronDown, Contact,
  ClipboardList, FileText, History, Landmark, LayoutDashboard, LayoutGrid, ListTree, LogOut, Menu, Moon, Package, PackageCheck,
  ReceiptText, Scale, Settings, Sun,
  FilePen, ShoppingCart, Store, Truck, Undo2, UserCog, Users, Wallet, Warehouse, type LucideIcon,
} from "lucide-react";

type Item = { href: string; label: string; roles: Role[]; icon: LucideIcon; also?: string[] };
type Heading = { heading: string };          // small caption that splits a group into sub-sections
type Entry = Item | Heading;
const isHeading = (e: Entry): e is Heading => "heading" in e;
const ALL: Role[] = ["SALESPERSON", "MANAGER", "ACCOUNTANT", "ADMIN"];
const SALES: Role[] = ["SALESPERSON", "MANAGER", "ADMIN"];
const BOOKS: Role[] = ["ACCOUNTANT", "ADMIN"];

// one group = one app: tile in the app switcher, its items become the top menu
type Group = { label: string; icon: LucideIcon; color: string; items: Entry[] };
const groups: Group[] = [
  { label: "", icon: LayoutDashboard, color: "#1d4f91", items: [{ href: "/", label: "Dashboard", roles: ALL, icon: LayoutDashboard }] },
  { label: "Purchase", icon: ShoppingCart, color: "#0f8a7e", items: [
    { href: "/purchase/orders/new", label: "Purchase Order", roles: ["MANAGER", "ADMIN"], icon: ShoppingCart },
    { href: "/purchase/orders", label: "Purchase Order List", roles: ["MANAGER", "ADMIN"], icon: ClipboardList },
    { href: "/purchase/receive", label: "Receive goods", roles: ["MANAGER", "ADMIN"], icon: PackageCheck },
    { href: "/purchase/bills", label: "Supplier bills", roles: ["MANAGER", "ADMIN"], icon: FileText },
    { href: "/purchase/returns", label: "Purchase returns", roles: ["MANAGER", "ADMIN"], icon: Undo2 },
  ]},
  { label: "Inventory", icon: Boxes, color: "#e99d00", items: [
    { href: "/inventory/stock", label: "Stock on hand", roles: ALL, icon: Boxes },
    { href: "/inventory/variance", label: "Price variance", roles: ["MANAGER", "ACCOUNTANT", "ADMIN"], icon: Scale },
    { href: "/inventory/adjust", label: "Stock adjustment", roles: ["MANAGER", "ADMIN"], icon: ArrowLeftRight },
  ]},
  { label: "Sales", icon: ReceiptText, color: "#e46e78", items: [
    { href: "/sales/new", label: "Sales Order", roles: SALES, icon: ReceiptText },
    { href: "/sales/orders", label: "Sales Orders List", roles: SALES, icon: ClipboardList },
    { href: "/sales/demo-invoice", label: "Demo invoice", roles: SALES, icon: FilePen },
    { href: "/sales/challan", label: "Challan", roles: SALES, icon: Truck },
    { href: "/sales/challans", label: "Challan list", roles: SALES, icon: FileText },
    { href: "/sales/consolidate", label: "Day-end consolidate", roles: SALES, icon: CalendarRange },
    { href: "/sales/returns", label: "Sales returns", roles: ["MANAGER", "ADMIN"], icon: Undo2 },
  ]},
  { label: "Accounting", icon: Landmark, color: "#5b8dd9", items: [
    { heading: "Setup" },
    { href: "/accounting/coa", label: "Chart of accounts", roles: BOOKS, icon: ListTree },
    { href: "/accounting/financial-year", label: "Financial year", roles: BOOKS, icon: CalendarRange },
    { href: "/accounting/tax-settings", label: "VAT settings", roles: BOOKS, icon: Settings },
    { href: "/accounting/fixed-assets", label: "Fixed assets", roles: BOOKS, icon: Package },
    { heading: "Transactions" },
    { href: "/accounting/journal", label: "Journal entry", roles: BOOKS, icon: BookOpen },
    { href: "/accounting/payments", label: "Receipts & payments", roles: BOOKS, icon: Banknote },
    { href: "/accounting/contra", label: "Contra voucher", roles: ["ACCOUNTANT", "ADMIN"], icon: ArrowLeftRight },
    { href: "/accounting/approvals", label: "Voucher approvals", roles: ["ACCOUNTANT", "MANAGER", "ADMIN"], icon: ClipboardList },
    { href: "/accounting/cheques", label: "Cheques received", roles: BOOKS, icon: Landmark },
    { href: "/accounting/petty-cash", label: "Petty cash", roles: BOOKS, icon: Wallet },
    { href: "/accounting/bank-recon", label: "Bank reconciliation", roles: BOOKS, icon: Scale },
    { heading: "Reports" },
    { href: "/accounting/party-statement", label: "Party statement", roles: ["ACCOUNTANT", "MANAGER", "ADMIN"], icon: Contact },
    { href: "/reports", label: "Financial reports", roles: ["ACCOUNTANT", "MANAGER", "ADMIN"], icon: BarChart3,
      also: ["/accounting/trial-balance", "/accounting/pnl", "/accounting/balance-sheet"] },
  ]},
  { label: "Administration", icon: Settings, color: "#6b7280", items: [
    { href: "/admin/users", label: "Users", roles: ["ADMIN"], icon: UserCog },
    { href: "/admin/activity-log", label: "Activity Log", roles: ["ADMIN"], icon: History },
    { href: "/hr/employees", label: "Employees", roles: ["ADMIN", "ACCOUNTANT"], icon: Users },
    { href: "/master/products", label: "Products", roles: ["ADMIN"], icon: Package },
    { href: "/master/suppliers", label: "Suppliers", roles: ["ADMIN"], icon: Building2 },
    { href: "/master/customers", label: "Customers", roles: ["ADMIN"], icon: Users },
    { href: "/master/shops", label: "Shops", roles: ["ADMIN"], icon: Store },
    { href: "/master/warehouses", label: "Warehouses", roles: ["ADMIN"], icon: Warehouse },
  ]},
];

/** Role filter; a sub-section caption stays only if at least one item under it is visible. */
function visibleGroups(role: Role): Group[] {
  return groups
    .map((g) => {
      const kept = g.items.filter((e) => isHeading(e) || e.roles.includes(role));
      const items = kept.filter((e, i) => !isHeading(e) || (kept[i + 1] !== undefined && !isHeading(kept[i + 1])));
      return { ...g, items };
    })
    .filter((g) => g.items.some((e) => !isHeading(e)));
}

export type AppTile = { label: string; href: string; icon: LucideIcon; color: string };
/** Apps the role can open — used by the navbar switcher and the home screen. */
export function appsFor(role: Role): AppTile[] {
  return visibleGroups(role).map((g) => {
    const first = g.items.find((e): e is Item => !isHeading(e))!;
    return { label: g.label || "Dashboard", href: first.href, icon: g.icon, color: g.color };
  });
}

type Theme = "light" | "dark";
const THEME_KEY = "mim_theme";

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", t === "dark");
}

export default function Shell({ children }: { children: ReactNode }) {
  const { user, ready, logout, activeShopId, setActiveShopId } = useAuth();
  const { t, lang, setLang } = useI18n();
  const pathname = usePathname();
  const [openNav,   setOpenNav]   = useState(false);
  const [menu,      setMenu]      = useState<string | null>(null);   // open navbar dropdown id
  const [theme,     setTheme]     = useState<Theme>("light");
  const [shops,     setShops]     = useState<Shop[]>([]);

  // navbar dropdowns close on navigation, outside click and Esc
  useEffect(() => { setMenu(null); setOpenNav(false); }, [pathname]);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-menu]")) setMenu(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menu]);

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

  if (!ready) return <div className="min-h-screen flex items-center justify-center muted">{t("Loading…")}</div>;
  if (!user) return <>{children}</>;

  const visible = visibleGroups(user.role);

  const matches = (n: Item) =>
    pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href + "/")) || !!n.also?.some((p) => pathname === p || pathname.startsWith(p + "/"));
  // the most specific entry wins: /purchase/orders/new must not also light up /purchase/orders
  const allItems = groups.flatMap((g) => g.items).filter((e): e is Item => !isHeading(e));
  const isActive = (n: Item) =>
    matches(n) && !allItems.some((o) => o !== n && o.href.length > n.href.length && o.href.startsWith(n.href + "/") && matches(o));

  // current app = the group owning the active page (fallback: first path segment, then Dashboard)
  const seg = "/" + (pathname.split("/")[1] ?? "");
  const app =
    visible.find((g) => g.items.some((e) => !isHeading(e) && isActive(e))) ??
    visible.find((g) => seg !== "/" && g.items.some((e) => !isHeading(e) && (e.href === seg || e.href.startsWith(seg + "/")))) ??
    visible[0];

  // split the app's entries into caption sections; apps without captions render flat links
  const sections: { heading: string | null; items: Item[] }[] = [];
  (app?.items ?? []).forEach((e) => {
    if (isHeading(e)) sections.push({ heading: e.heading, items: [] });
    else {
      if (sections.length === 0) sections.push({ heading: null, items: [] });
      sections[sections.length - 1].items.push(e);
    }
  });
  const flat = sections.length === 1 && sections[0].heading === null;
  const isHome = !app || app.label === "";
  const apps = appsFor(user.role);
  const appHref = isHome ? "/" : apps.find((a) => a.label === app.label)?.href ?? "/";
  const initial = (user.fullName || user.username || "?").trim().charAt(0).toUpperCase();
  const toggleMenu = (id: string) => setMenu((m) => (m === id ? null : id));

  return (
    <div className="min-h-screen flex flex-col bg-body w-full">
      <header className="o-nav flex items-center sticky top-0 z-40 pr-2">
        {/* mobile: full menu */}
        <button className="o-nav-btn md:hidden" onClick={() => setOpenNav(true)} aria-label={t("Menu")}><Menu size={18} /></button>

        {/* app switcher */}
        <div className="relative hidden md:block" data-menu>
          <button className={`o-nav-btn ${menu === "apps" ? "is-open" : ""}`} onClick={() => toggleMenu("apps")}
            aria-label={t("Apps")} title={t("Apps")} aria-expanded={menu === "apps"}>
            <LayoutGrid size={18} />
          </button>
          {menu === "apps" && (
            <div className="o-menu" style={{ left: 0 }}>
              <div className="o-apps">
                {apps.map((a) => {
                  const Icon = a.icon;
                  return (
                    <Link key={a.label} href={a.href} className="o-app" onClick={() => setMenu(null)}>
                      <span className="o-app-icon" style={{ background: a.color }}><Icon size={24} strokeWidth={1.8} /></span>
                      <span>{t(a.label)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <Link href={appHref} className="o-nav-brand">{isHome ? "MIM ERP" : t(app.label)}</Link>

        {/* current app's menu */}
        <nav className={`hidden md:flex items-center min-w-0 flex-1 ${flat ? "o-nav-scroll" : ""}`}>
          {!isHome && flat && sections[0].items.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n) ? "page" : undefined}
              className={`o-nav-btn ${isActive(n) ? "is-active" : ""}`}>{t(n.label)}</Link>
          ))}
          {!isHome && !flat && sections.map((s) => {
            const id = `sec:${s.heading}`;
            const has = s.items.some(isActive);
            return (
              <div key={id} className="relative" data-menu>
                <button className={`o-nav-btn ${menu === id ? "is-open" : ""} ${has ? "is-active" : ""}`}
                  onClick={() => toggleMenu(id)} aria-expanded={menu === id}>
                  {t(s.heading ?? app.label)} <ChevronDown size={13} />
                </button>
                {menu === id && (
                  <div className="o-menu" style={{ left: 0 }}>
                    {s.items.map((n) => {
                      const Icon = n.icon;
                      return (
                        <Link key={n.href} href={n.href} onClick={() => setMenu(null)}
                          aria-current={isActive(n) ? "page" : undefined}
                          className={`o-menu-item ${isActive(n) ? "is-active" : ""}`}>
                          <Icon size={15} strokeWidth={1.8} className="shrink-0" />{t(n.label)}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="flex-1 md:hidden" />

        {/* systray */}
        <div className="flex items-center gap-1 shrink-0 pl-2">
          {user.shopIds.length > 1 && shops.length > 0 && (
            <select
              aria-label={t("Active shop")}
              className="inp inp-shop h-7 w-auto max-w-[160px] text-[12px]"
              value={activeShopId ?? ""}
              onChange={(e) => setActiveShopId(e.target.value)}>
              {shops
                .filter((s) => user.shopIds.includes(s.id))
                .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}

          <button onClick={() => setLang(lang === "en" ? "bn" : "en")} className="o-nav-btn !px-2 text-[12px]"
            title={lang === "en" ? "বাংলা" : "English"} aria-label="Language">
            {lang === "en" ? "EN" : "বাং"}
          </button>

          <button onClick={toggleTheme} aria-label="Toggle dark mode" className="o-nav-btn !px-2">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          <div className="relative" data-menu>
            <button className={`o-nav-btn !px-2 ${menu === "user" ? "is-open" : ""}`} onClick={() => toggleMenu("user")}
              aria-expanded={menu === "user"}>
              <span className="o-avatar">{initial}</span>
              <span className="hidden lg:inline max-w-[140px] truncate">{user.fullName || user.username}</span>
            </button>
            {menu === "user" && (
              <div className="o-menu" style={{ right: 0 }}>
                <div className="px-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="text-[13px] font-semibold truncate">{user.fullName || user.username}</div>
                  <div className="text-[11px] muted capitalize">{user.role.toLowerCase()}</div>
                </div>
                <button className="o-menu-item" onClick={logout}><LogOut size={15} />{t("Sign out")}</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* mobile slide-in menu: every app with its items */}
      {openNav && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpenNav(false)} />
          <aside className="absolute left-0 top-0 h-full w-[250px] overflow-y-auto pb-4"
            style={{ background: "var(--surface)", borderRight: "1px solid var(--border)" }}>
            <div className="o-nav flex items-center px-4 text-[15px] font-medium">MIM ERP</div>
            {visible.map((g, i) => (
              <div key={i}>
                {g.label && <div className="o-menu-head">{t(g.label)}</div>}
                {g.items.map((n) => isHeading(n) ? null : (
                  <Link key={n.href} href={n.href} onClick={() => setOpenNav(false)}
                    className={`o-menu-item ${isActive(n) ? "is-active" : ""}`}>
                    <n.icon size={15} strokeWidth={1.8} className="shrink-0" />{t(n.label)}
                  </Link>
                ))}
              </div>
            ))}
          </aside>
        </div>
      )}

      <main className="flex-1 px-4 md:px-6 py-4 md:py-5 max-w-6xl w-full mx-auto">{children}</main>
    </div>
  );
}
