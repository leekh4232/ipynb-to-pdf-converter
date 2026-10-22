export interface ThemeInfo {
  label: string;
  background: string;
  foreground: string;
  border: string;
  lineNumber: string;
}

export const DEFAULT_THEME = 'mdr-dark';

export const THEMES: Record<string, ThemeInfo> = {
  // Markdown Reader One Dark/Light: nb_convert.py's --code-theme palettes
  // (media/themes/mdr-dark.css, mdr-light.css). Hex values are the hsl() ones
  // from MDR_CSS, converted.
  'mdr-dark': {
    label: 'Markdown Reader Dark',
    background: '#1d222a',
    foreground: '#c0c6d3',
    border: '#30363d',
    lineNumber: '#6a707c',
  },
  'mdr-light': {
    label: 'Markdown Reader Light',
    background: '#f5f7fa',
    foreground: '#2f3237',
    border: '#d0d7de',
    lineNumber: '#85888e',
  },
  'dracula': {
    label: 'Dracula',
    background: '#282936',
    foreground: '#e9e9f4',
    border: '#44475a',
    lineNumber: '#6272a4',
  },
  'github': {
    label: 'GitHub Light',
    background: '#ffffff',
    foreground: '#24292e',
    border: '#d0d7de',
    lineNumber: '#8b949e',
  },
  'github-dark': {
    label: 'GitHub Dark',
    background: '#0d1117',
    foreground: '#c9d1d9',
    border: '#30363d',
    lineNumber: '#6e7681',
  },
  'atom-one-light': {
    label: 'Atom One Light',
    background: '#fafafa',
    foreground: '#383a42',
    border: '#d4d4d4',
    lineNumber: '#9d9d9f',
  },
  'atom-one-dark': {
    label: 'Atom One Dark',
    background: '#282c34',
    foreground: '#abb2bf',
    border: '#3e4451',
    lineNumber: '#636d83',
  },
  'monokai': {
    label: 'Monokai',
    background: '#272822',
    foreground: '#dddddd',
    border: '#49483e',
    lineNumber: '#75715e',
  },
  'nord': {
    label: 'Nord',
    background: '#2e3440',
    foreground: '#d8dee9',
    border: '#4c566a',
    lineNumber: '#616e88',
  },
  'vs2015': {
    label: 'Visual Studio Dark',
    background: '#1e1e1e',
    foreground: '#dcdcdc',
    border: '#333333',
    lineNumber: '#5a5a5a',
  },
  // Light, GitHub-print look from nb_convert.py's vertical (A4) mode. Pairs with
  // media/themes/leekh.css (syntax) and leekh.chrome.css (document styling).
  'leekh': {
    label: 'Leekh',
    background: '#f6f8fa',
    foreground: '#24292e',
    border: '#d0d7de',
    lineNumber: '#8b949e',
  },
};

export function resolveTheme(name: string | undefined): { key: string; info: ThemeInfo } {
  const key = name && name in THEMES ? name : DEFAULT_THEME;
  return { key, info: THEMES[key] };
}

// Page (document) themes, mirroring nb_convert.py's --theme. 'default' is the
// GitHub look (github-markdown.css + styles.css); 'light'/'dark' are the Markdown
// Reader palettes in media/page-themes/mdr.css. `background` repeats that
// palette's --bg-base so html2canvas and jsPDF can paint the paper color.
export interface PageThemeInfo {
  label: string;
  background: string;
}

export const DEFAULT_PAGE_THEME = 'light';

export const PAGE_THEMES: Record<string, PageThemeInfo> = {
  default: { label: 'Default (GitHub)', background: '#ffffff' },
  light: { label: 'Light (Markdown Reader)', background: '#ffffff' },
  dark: { label: 'Dark (Markdown Reader)', background: '#0f1014' },
};

export function resolvePageTheme(name: string | undefined): { key: string; info: PageThemeInfo } {
  const key = name && name in PAGE_THEMES ? name : DEFAULT_PAGE_THEME;
  return { key, info: PAGE_THEMES[key] };
}

// Used to pick the MDR code-block palette that matches the selected code theme,
// so fenced blocks inside markdown cells look like the code cells next to them.
export function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}
