"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "bn";

// Translation dictionary. Keys are English; bn holds the Bangla string.
// Add keys here and use t("key") anywhere. Missing bn falls back to the key.
const DICT: Record<string, { en: string; bn: string }> = {
  // app / chrome
  "MIM Enterprise": { en: "MIM Enterprise", bn: "এমআইএম এন্টারপ্রাইজ" },
  "Plywood & Hardware": { en: "Plywood & Hardware", bn: "প্লাইউড ও হার্ডওয়্যার" },
  "Sign in": { en: "Sign in", bn: "সাইন ইন" },
  "Sign out": { en: "Sign out", bn: "সাইন আউট" },
  "Username": { en: "Username", bn: "ইউজারনেম" },
  "Password": { en: "Password", bn: "পাসওয়ার্ড" },
  "Loading…": { en: "Loading…", bn: "লোড হচ্ছে…" },
  "Active shop": { en: "Active shop", bn: "সক্রিয় দোকান" },
  // nav groups
  "Dashboard": { en: "Dashboard", bn: "ড্যাশবোর্ড" },
  "Purchase": { en: "Purchase", bn: "ক্রয়" },
  "Inventory": { en: "Inventory", bn: "ইনভেন্টরি" },
  "Sales": { en: "Sales", bn: "বিক্রয়" },
  "Accounting": { en: "Accounting", bn: "হিসাব" },
  "Administration": { en: "Administration", bn: "প্রশাসন" },
  // nav items
  "New purchase order": { en: "New purchase order", bn: "নতুন ক্রয় অর্ডার" },
  "Purchase orders": { en: "Purchase orders", bn: "ক্রয় অর্ডারসমূহ" },
  "Receive goods": { en: "Receive goods", bn: "পণ্য গ্রহণ" },
  "Stock on hand": { en: "Stock on hand", bn: "মজুদ পণ্য" },
  "Price variance": { en: "Price variance", bn: "মূল্য পার্থক্য" },
  "Stock adjustment": { en: "Stock adjustment", bn: "মজুদ সমন্বয়" },
  "New sale": { en: "New sale", bn: "নতুন বিক্রয়" },
  "Issue challan": { en: "Issue challan", bn: "চালান ইস্যু" },
  "Day-end consolidate": { en: "Day-end consolidate", bn: "দিনশেষে একত্রীকরণ" },
  "Sales orders": { en: "Sales orders", bn: "বিক্রয় অর্ডারসমূহ" },
  "Payments & receipts": { en: "Payments & receipts", bn: "পরিশোধ ও প্রাপ্তি" },
  "Petty cash": { en: "Petty cash", bn: "খুচরা নগদ" },
  "Trial balance": { en: "Trial balance", bn: "রেওয়ামিল" },
  "Profit & loss": { en: "Profit & loss", bn: "লাভ-ক্ষতি" },
  "Balance sheet": { en: "Balance sheet", bn: "স্থিতিপত্র" },
  "Users": { en: "Users", bn: "ব্যবহারকারী" },
  "Products": { en: "Products", bn: "পণ্য" },
  "Suppliers": { en: "Suppliers", bn: "সরবরাহকারী" },
  "Customers": { en: "Customers", bn: "গ্রাহক" },
  "Shops": { en: "Shops", bn: "দোকান" },
  "Warehouses": { en: "Warehouses", bn: "গুদাম" },
  // common form labels / actions
  "Save": { en: "Save", bn: "সংরক্ষণ" },
  "Add": { en: "Add", bn: "যোগ করুন" },
  "Update": { en: "Update", bn: "হালনাগাদ" },
  "Edit": { en: "Edit", bn: "সম্পাদনা" },
  "Delete": { en: "Delete", bn: "মুছুন" },
  "Cancel": { en: "Cancel", bn: "বাতিল" },
  "Code": { en: "Code", bn: "কোড" },
  "Name": { en: "Name", bn: "নাম" },
  "Mobile": { en: "Mobile", bn: "মোবাইল" },
  "Address": { en: "Address", bn: "ঠিকানা" },
  "Location": { en: "Location", bn: "অবস্থান" },
  "Actions": { en: "Actions", bn: "কার্যক্রম" },
  "Primary line": { en: "Primary line", bn: "প্রধান পণ্যধারা" },
  "Monthly target": { en: "Monthly target", bn: "মাসিক লক্ষ্য" },
  "Petty cash float": { en: "Petty cash float", bn: "খুচরা নগদ তহবিল" },
  "Board": { en: "Board", bn: "বোর্ড" },
  "Hardware": { en: "Hardware", bn: "হার্ডওয়্যার" },
  "Confirm delete?": { en: "Confirm delete?", bn: "মুছে ফেলা নিশ্চিত?" },
  "Saved.": { en: "Saved.", bn: "সংরক্ষিত হয়েছে।" },
  "Deleted.": { en: "Deleted.", bn: "মুছে ফেলা হয়েছে।" },
  "Name (Bangla)": { en: "Name (Bangla)", bn: "নাম (বাংলা)" },
  "Search…": { en: "Search…", bn: "খুঁজুন…" },
  "PO no": { en: "PO no", bn: "পিও নং" },
  "Auto-generated": { en: "Auto-generated", bn: "স্বয়ংক্রিয়ভাবে তৈরি" },
  "Free product": { en: "Free product", bn: "ফ্রি পণ্য" },
  "Free": { en: "Free", bn: "ফ্রি" },
  "low": { en: "low", bn: "নিম্ন" },
  "high": { en: "high", bn: "উচ্চ" },
  "Unit price": { en: "Unit price", bn: "একক মূল্য" },
  "Qty": { en: "Qty", bn: "পরিমাণ" },
  "Line total": { en: "Line total", bn: "লাইন মোট" },
  "Total": { en: "Total", bn: "মোট" },
  "Supplier": { en: "Supplier", bn: "সরবরাহকারী" },
  "Customer": { en: "Customer", bn: "গ্রাহক" },
  "Product": { en: "Product", bn: "পণ্য" },
  "Warehouse": { en: "Warehouse", bn: "গুদাম" },
  "Employees": { en: "Employees", bn: "কর্মচারী" },
  "Employee": { en: "Employee", bn: "কর্মচারী" },
  "Salary profile": { en: "Salary profile", bn: "বেতন প্রোফাইল" },
  "Designation": { en: "Designation", bn: "পদবি" },
  "Joining date": { en: "Joining date", bn: "যোগদানের তারিখ" },
  "Salary type": { en: "Salary type", bn: "বেতনের ধরন" },
  "Monthly": { en: "Monthly", bn: "মাসিক" },
  "Daily wage": { en: "Daily wage", bn: "দৈনিক মজুরি" },
  "Basic salary": { en: "Basic salary", bn: "মূল বেতন" },
  "House rent": { en: "House rent", bn: "বাড়িভাড়া" },
  "Medical": { en: "Medical", bn: "চিকিৎসা" },
  "Transport": { en: "Transport", bn: "যাতায়াত" },
  "Other allowance": { en: "Other allowance", bn: "অন্যান্য ভাতা" },
  "Overtime rate / hour": { en: "Overtime rate / hour", bn: "ওভারটাইম রেট / ঘণ্টা" },
  "Gross salary": { en: "Gross salary", bn: "মোট বেতন" },
  "Shop": { en: "Shop", bn: "দোকান" },
  "Chart of accounts": { en: "Chart of accounts", bn: "হিসাব তালিকা" },
  "Financial year": { en: "Financial year", bn: "অর্থবছর" },
  "Account head": { en: "Account head", bn: "হিসাব শিরোনাম" },
  "Ledger": { en: "Ledger", bn: "খতিয়ান" },
  "Nature": { en: "Nature", bn: "প্রকৃতি" },
  "Opening": { en: "Opening", bn: "প্রারম্ভিক" },
  "Closing balance": { en: "Closing balance", bn: "সমাপনী স্থিতি" },
  "Debit": { en: "Debit", bn: "ডেবিট" },
  "Credit": { en: "Credit", bn: "ক্রেডিট" },
  "Set current": { en: "Set current", bn: "বর্তমান করুন" },
  "Current": { en: "Current", bn: "বর্তমান" },
  "Start date": { en: "Start date", bn: "শুরুর তারিখ" },
  "End date": { en: "End date", bn: "শেষ তারিখ" },
  "Opening balances": { en: "Opening balances", bn: "প্রারম্ভিক স্থিতি" },
  "New ledger": { en: "New ledger", bn: "নতুন খতিয়ান" },
  "New head": { en: "New head", bn: "নতুন শিরোনাম" },
  "Status": { en: "Status", bn: "অবস্থা" },
  "Journal voucher": { en: "Journal voucher", bn: "জার্নাল ভাউচার" },
  "Journal entry": { en: "Journal entry", bn: "জার্নাল এন্ট্রি" },
  "Narration": { en: "Narration", bn: "বিবরণ" },
  "Date": { en: "Date", bn: "তারিখ" },
  "Post": { en: "Post", bn: "পোস্ট" },
  "Journal register": { en: "Journal register", bn: "জার্নাল রেজিস্টার" },
  "Receipt history": { en: "Receipt history", bn: "গ্রহণের ইতিহাস" },
  "Received": { en: "Received", bn: "গৃহীত" },
  "Ordered": { en: "Ordered", bn: "অর্ডারকৃত" },
  "Balance": { en: "Balance", bn: "ব্যালেন্স" },
  "New balance": { en: "New balance", bn: "নতুন ব্যালেন্স" },
  "Not balanced": { en: "Not balanced", bn: "ব্যালেন্স হয়নি" },
  "Add line": { en: "Add line", bn: "লাইন যোগ" },
  "Delivery details (for driver)": { en: "Delivery details (for driver)", bn: "ডেলিভারি তথ্য (চালকের জন্য)" },
  "Delivery address": { en: "Delivery address", bn: "ডেলিভারি ঠিকানা" },
  "Landmark": { en: "Landmark", bn: "নিকটবর্তী চিহ্ন" },
  "Contact person": { en: "Contact person", bn: "যোগাযোগের ব্যক্তি" },
  "Contact phone": { en: "Contact phone", bn: "যোগাযোগ ফোন" },
  "Note for driver": { en: "Note for driver", bn: "চালকের জন্য নোট" },
  "Map link": { en: "Map link", bn: "ম্যাপ লিংক" },
  "Type": { en: "Type", bn: "ধরন" },
  "Thickness": { en: "Thickness", bn: "পুরুত্ব" },
  "Price band": { en: "Price band", bn: "মূল্যসীমা" },
  "Unit": { en: "Unit", bn: "একক" },
  "Credit limit": { en: "Credit limit", bn: "ক্রেডিট সীমা" },
  "Credit days": { en: "Credit days", bn: "ক্রেডিট দিন" },
  "Individual (cash)": { en: "Individual (cash)", bn: "ব্যক্তি (নগদ)" },
  "Party (credit)": { en: "Party (credit)", bn: "পার্টি (বাকি)" },
  // dashboard
  "Single application for purchase, inventory, sales and accounting.":
    { en: "Single application for purchase, inventory, sales and accounting.",
      bn: "ক্রয়, ইনভেন্টরি, বিক্রয় ও হিসাবের জন্য একটিই অ্যাপ্লিকেশন।" },
};

type I18n = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  dn: (rec: { name?: string; nameBn?: string } | null | undefined) => string;
};
const Ctx = createContext<I18n | null>(null);

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("mim_lang")) as Lang | null;
    if (saved === "en" || saved === "bn") setLangState(saved);
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem("mim_lang", l);
  }

  function t(key: string) {
    const entry = DICT[key];
    if (!entry) return key;            // fall back to the key itself
    return lang === "bn" ? entry.bn || entry.en : entry.en;
  }

  // pick a data record's name by current language (Bangla name if present)
  function dn(rec: { name?: string; nameBn?: string } | null | undefined): string {
    if (!rec) return "";
    if (lang === "bn" && rec.nameBn) return rec.nameBn;
    return rec.name ?? "";
  }

  return <Ctx.Provider value={{ lang, setLang, t, dn }}>{children}</Ctx.Provider>;
}
