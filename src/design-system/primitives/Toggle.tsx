export function ThemeToggle({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button className="ds-theme-toggle" onClick={onToggle} type="button">
      {theme === "light" ? "Dark Mode" : "Light Mode"}
    </button>
  );
}
