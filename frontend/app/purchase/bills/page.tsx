"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Supplier bills moved to Accounting (they are the payable, not the goods). Old links land there. */
export default function OldSupplierBillsPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/accounting/supplier-bills"); }, [router]);
  return null;
}
