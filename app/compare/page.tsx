"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CompareRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/translate/compare");
  }, [router]);
  return null;
}
