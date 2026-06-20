import "./globals.css";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import Shell from "@/components/Shell";

export const metadata = { title: "MIM Enterprise ERP", description: "Trading ERP" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          <AuthProvider>
            <Shell>{children}</Shell>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
