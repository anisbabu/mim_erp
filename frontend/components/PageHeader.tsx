"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * Standard page header: breadcrumb, title, one-line description and the page's primary actions on the right.
 * Every list / form page starts with this so titles, spacing and action placement are the same everywhere.
 */
export default function PageHeader({ title, subtitle, crumbs, actions }: {
  title: string; subtitle?: string; crumbs?: string[]; actions?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <div className="text-[11px] muted mb-0.5">{crumbs.map((c) => t(c)).join("  ›  ")}</div>
        )}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="text-sm muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
