export type ThemeName = "operator" | "fieldnotes" | "studio";

export const THEMES: { id: ThemeName; label: string; tagline: string }[] = [
  { id: "operator", label: "Operator", tagline: "console" },
  { id: "fieldnotes", label: "Field Notes", tagline: "editorial" },
  { id: "studio", label: "Studio", tagline: "brutalist" }
];

const STORAGE_KEY = "bar-theme";

export function getTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (stored === "operator" || stored === "fieldnotes" || stored === "studio") return stored;
  } catch {
    /* ignore */
  }
  return "fieldnotes";
}

export function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function bootstrapTheme() {
  applyTheme(getTheme());
}
