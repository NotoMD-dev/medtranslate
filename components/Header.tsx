"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Upload" },
  { href: "/translate", label: "Translate" },
  { href: "/review", label: "Review" },
  { href: "/metrics", label: "Metrics" },
];

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="border-b border-surface-700 px-8 py-4 flex items-center justify-between">
      <Link href="/" className="flex items-center gap-3.5 no-underline">
        <div
          className="w-9 h-9 rounded-[10px] flex items-center justify-center text-lg font-bold text-white"
          style={{
            background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
          }}
        >
          M
        </div>
        <div>
          <div className="text-[17px] font-bold tracking-tight text-slate-100">
            MedTranslate
          </div>
          <div className="text-[11px] text-slate-500 tracking-wider font-medium">
            Clinical Translation Research Tool
          </div>
        </div>
      </Link>

      <nav className="flex gap-0.5 bg-surface-700 rounded-[10px] p-[3px]">
        {NAV_ITEMS.map(({ href, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`px-5 py-[7px] rounded-lg text-[13px] font-semibold no-underline transition-all ${
                isActive
                  ? "bg-accent-blue text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
