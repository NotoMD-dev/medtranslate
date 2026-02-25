import Link from "next/link";

export function TabNavigation({ current }: { current: "/" | "/translate" | "/review" | "/metrics" }) {
  const tabs = [
    { href: "/", label: "Upload" },
    { href: "/translate", label: "Translate" },
    { href: "/review", label: "Review" },
    { href: "/metrics", label: "Metrics" },
  ] as const;

  return (
    <nav className="ds-tabs" aria-label="Primary">
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className={`ds-tab ${current === tab.href ? "active" : ""}`.trim()}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
