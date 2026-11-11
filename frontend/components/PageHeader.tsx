"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";

/** A breadcrumb: plain text, or a link back to a parent page when it has an href. */
export type Crumb = string | { label: string; href: string };

/**
 * Standard page header (control panel): breadcrumb, title, one-line description and the page's primary actions on the right.
 * Every list / form page starts with this so titles, spacing and action placement are the same everywhere.
 */
export default function PageHeader({ title, subtitle, crumbs, actions }: {
  title: string; subtitle?: string; crumbs?: Crumb[]; actions?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          {crumbs?.map((c) => {
            const label = typeof c === "string" ? c : c.label;
            return (
              <span key={label} className="text-[18px] leading-6 text-brand">
                {typeof c === "string" ? t(label) : <Link href={c.href} className="hover:underline">{t(label)}</Link>}
                {" "}<span className="muted">/</span>
              </span>
            );
          })}
          <h1 className="page-title">{title}</h1>
        </div>
        {subtitle && <p className="text-[13px] muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
