import "./globals.css";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import Shell from "@/components/Shell";

// Bangla: SolaimanLipi (regular + bold only; 500 renders as regular, 600 as bold).
const solaimanLipi = localFont({
  src: [
    { path: "./fonts/SolaimanLipi.ttf", weight: "400", style: "normal" },
    { path: "./fonts/SolaimanLipi-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

// Latin text renders in Inter; Bangla falls through to SolaimanLipi (see tailwind fontFamily.sans).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata = { title: "MIM Enterprise ERP", description: "Trading ERP" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${solaimanLipi.variable}`}>
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
