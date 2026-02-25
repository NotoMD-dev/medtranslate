export function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return <button onClick={onToggle} style={{ borderRadius: 9999, border: "1px solid var(--border)", padding: "8px 16px", fontSize: 12, color: "var(--text-secondary)", background: "transparent", cursor: "pointer" }}>{theme === "light" ? "Dark Mode" : "Light Mode"}</button>;
}
