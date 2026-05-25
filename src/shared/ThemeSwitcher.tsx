import { useEffect, useState } from "react";
import { applyTheme, getTheme, THEMES, type ThemeName } from "./theme";

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [current, setCurrent] = useState<ThemeName>(getTheme());

  useEffect(() => {
    applyTheme(current);
  }, [current]);

  return (
    <div className={`themeSwitcher${compact ? " themeSwitcher--compact" : ""}`} role="radiogroup" aria-label="Theme">
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          role="radio"
          aria-checked={theme.id === current}
          className={`themeChip themeChip--${theme.id}${theme.id === current ? " is-active" : ""}`}
          onClick={() => setCurrent(theme.id)}
          title={`${theme.label} · ${theme.tagline}`}
        >
          <span className="themeChipLabel">{theme.label}</span>
          <span className="themeChipTag">{theme.tagline}</span>
        </button>
      ))}
    </div>
  );
}
