"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Reports moved into the tabbed hub; keep old links working.
export default function Redirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/reports?tab=profit-or-loss"); }, [router]);
  return null;
}
