import {
  OTTO_PAPER_THEME,
  THEME_COLOR_ROLES,
  getThemeColorsForAppearance,
  type ThemeAppearance,
  type ThemeColorRole,
} from "@otto/shared/themePalettes";

const APP_THEME_VARIABLES: Readonly<Record<ThemeColorRole, string>> = {
  canvas: "--app-theme-canvas",
  chrome: "--app-theme-chrome",
  toolbar: "--app-theme-toolbar",
  toolbarForeground: "--app-theme-toolbar-foreground",
  toolbarBorder: "--app-theme-toolbar-border",
  toolbarControl: "--app-theme-toolbar-control",
  toolbarControlForeground: "--app-theme-toolbar-control-foreground",
  toolbarControlHover: "--app-theme-toolbar-control-hover",
  surface: "--app-theme-surface",
  surfaceRaised: "--app-theme-surface-raised",
  surfaceOverlay: "--app-theme-surface-overlay",
  text: "--app-theme-text",
  textMuted: "--app-theme-text-muted",
  border: "--app-theme-border",
  input: "--app-theme-input",
  focus: "--app-theme-focus",
  accent: "--app-theme-accent",
  accentForeground: "--app-theme-accent-foreground",
  secondary: "--app-theme-secondary",
  secondaryForeground: "--app-theme-secondary-foreground",
  muted: "--app-theme-muted",
  mutedForeground: "--app-theme-muted-foreground",
  placeholder: "--app-theme-placeholder",
  secondaryLabel: "--app-theme-secondary-label",
  iconMuted: "--app-theme-icon-muted",
  error: "--app-theme-error",
  errorForeground: "--app-theme-error-foreground",
  errorSurface: "--app-theme-error-surface",
  warning: "--app-theme-warning",
  warningForeground: "--app-theme-warning-foreground",
  warningSurface: "--app-theme-warning-surface",
  update: "--app-theme-update",
  updateForeground: "--app-theme-update-foreground",
  updateSurface: "--app-theme-update-surface",
  accentSurface: "--app-theme-accent-surface",
  accentSurfaceForeground: "--app-theme-accent-surface-foreground",
  messageSurface: "--app-theme-message-surface",
  messageForeground: "--app-theme-message-foreground",
  messageAction: "--app-theme-message-action",
  messageActionForeground: "--app-theme-message-action-foreground",
  messageActionHover: "--app-theme-message-action-hover",
  codeBackground: "--app-theme-code-background",
  codeForeground: "--app-theme-code-foreground",
  sidebar: "--app-theme-sidebar",
  sidebarForeground: "--app-theme-sidebar-foreground",
  sidebarMutedForeground: "--app-theme-sidebar-muted-foreground",
  sidebarControlSurface: "--app-theme-sidebar-control-surface",
  sidebarRowHover: "--app-theme-sidebar-row-hover",
  sidebarRowActive: "--app-theme-sidebar-row-active",
  sidebarRowSelected: "--app-theme-sidebar-row-selected",
  sidebarBorder: "--app-theme-sidebar-border",
  terminalBackground: "--app-theme-terminal-background",
  terminalForeground: "--app-theme-terminal-foreground",
  terminalCursor: "--app-theme-terminal-cursor",
  terminalSelection: "--app-theme-terminal-selection-background",
  terminalScrollbar: "--app-theme-terminal-scrollbar",
  terminalScrollbarHover: "--app-theme-terminal-scrollbar-hover",
};

export function applyThemePalette(theme: string, appearance?: ThemeAppearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (!root?.style) return;
  const mode = appearance ?? (theme === "dark" ? "dark" : "light");
  const colors = getThemeColorsForAppearance(OTTO_PAPER_THEME, mode) ?? OTTO_PAPER_THEME.colors;
  root.dataset.themeId = OTTO_PAPER_THEME.id;

  for (const role of THEME_COLOR_ROLES) {
    root.style.setProperty(APP_THEME_VARIABLES[role], colors[role]);
  }
}
