"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { LayoutDashboard, Languages, Mic, PanelLeftClose, PanelLeftOpen } from "lucide-react";

const SIDEBAR_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/translate", label: "Translate", icon: Languages },
  { href: "/transcribe", label: "Transcribe", icon: Mic },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("medtranslate-sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      localStorage.setItem("medtranslate-sidebar-collapsed", String(!prev));
      return !prev;
    });
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <aside
      className="app-sidebar"
      style={{
        width: collapsed ? 64 : 240,
        minHeight: "100vh",
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s ease",
        flexShrink: 0,
        position: "sticky",
        top: 0,
        height: "100vh",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {/* Logo / Brand */}
      <div
        style={{
          padding: collapsed ? "24px 8px" : "24px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          minHeight: 73,
        }}
      >
        <Link href="/" style={{ textDecoration: "none", display: "inline-flex", alignItems: "baseline", gap: 0 }}>
          <span
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontWeight: 700,
              fontSize: collapsed ? 18 : 22,
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            {collapsed ? "M" : "Med"}
          </span>
          <span
            style={{
              width: collapsed ? 3 : 4,
              height: collapsed ? 3 : 4,
              borderRadius: "50%",
              background: "var(--accent)",
              display: "inline-block",
              margin: collapsed ? "0 0 3px 0" : "0 1.5px 3.5px 1.5px",
              flexShrink: 0,
            }}
          />
          {!collapsed && (
            <span
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontWeight: 400,
                fontStyle: "italic",
                fontSize: 22,
                color: "var(--text-primary)",
                letterSpacing: "-0.02em",
              }}
            >
              Tools
            </span>
          )}
        </Link>
      </div>

      {/* Navigation items */}
      <nav style={{ flex: 1, padding: "12px 8px" }}>
        {SIDEBAR_NAV.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              style={{ textDecoration: "none", display: "block", marginBottom: 4 }}
            >
              <div
                className="sidebar-nav-item"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: collapsed ? "12px 0" : "12px 16px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  borderRadius: "var(--radius-xs)",
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "#fff" : "var(--text-muted)",
                  fontWeight: active ? 600 : 500,
                  fontSize: 14,
                  transition: "all 0.15s ease",
                  cursor: "pointer",
                }}
              >
                <Icon size={20} strokeWidth={1.5} />
                {!collapsed && <span>{item.label}</span>}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Collapse button */}
      <div style={{ padding: "12px 8px", borderTop: "1px solid var(--border)" }}>
        <button
          onClick={toggleCollapse}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: collapsed ? "10px 0" : "10px 16px",
            justifyContent: collapsed ? "center" : "flex-start",
            width: "100%",
            borderRadius: "var(--radius-xs)",
            background: "transparent",
            color: "var(--text-muted)",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "var(--font)",
            transition: "all 0.15s ease",
          }}
        >
          {collapsed ? (
            <PanelLeftOpen size={18} strokeWidth={1.5} />
          ) : (
            <>
              <PanelLeftClose size={18} strokeWidth={1.5} />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
