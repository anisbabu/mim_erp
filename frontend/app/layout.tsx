import "./globals.css";
import type { ReactNode } from "react";
import { Noto_Sans_Bengali } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import Shell from "@/components/Shell";

const notoSansBengali = Noto_Sans_Bengali({
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata = { title: "MIM Enterprise ERP", description: "Trading ERP" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={notoSansBengali.variable}>
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
