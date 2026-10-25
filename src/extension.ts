import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { jsPDF } from 'jspdf';
import { renderNotebook, renderMarkdown } from './render';
import { Notebook } from './notebook';
import { isDarkColor, resolvePageTheme, resolveTheme } from './themes';
import { resolvePageDimensions } from './paper';
import { inlineImages, loadAsDataUrl } from './images';

let outputChannel: vscode.OutputChannel;

const SUPPORTED_EXTENSIONS = ['.ipynb', '.md'];

function isSupported(fsPath: string): boolean {
  return SUPPORTED_EXTENSIONS.some((ext) => fsPath.endsWith(ext));
}

// Vendored CSS assets never change during a session, so cache reads by path.
// A `null` entry records an absent optional file (e.g. a theme without chrome).
const cssCache = new Map<string, string | null>();

async function readAssetCached(filePath: string, optional = false): Promise<string> {
  const cached = cssCache.get(filePath);
  if (cached !== undefined) {
    return cached ?? '';
  }
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    cssCache.set(filePath, content);
    return content;
  } catch (error) {
    if (optional) {
      cssCache.set(filePath, null);
      return '';
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const TABLE_NOWRAP_MODES = ['first', 'all', 'none'] as const;
const LINE_NUMBER_MODES = ['auto', 'on', 'off'] as const;
const PAGE_BREAK_MODES = ['h1', 'h1-h2', 'none'] as const;
const IMAGE_FORMATS = ['png', 'jpeg'] as const;
const ALIGNMENTS = ['left', 'center', 'right'] as const;
const PERMISSIONS = ['print', 'modify', 'copy', 'annot-forms'] as const;

export type TableNowrap = (typeof TABLE_NOWRAP_MODES)[number];
export type LineNumberMode = (typeof LINE_NUMBER_MODES)[number];
export type PageBreakMode = (typeof PAGE_BREAK_MODES)[number];
export type ImageFormat = (typeof IMAGE_FORMATS)[number];
export type Alignment = (typeof ALIGNMENTS)[number];
export type Permission = (typeof PERMISSIONS)[number];

// Everything under ipynb-pdf-converter.* except pdfPassword, which only the
// "with Password" command reads.
export interface Settings {
  pdfTheme: string;
  codeTheme: string;
  pdfPageSize: string;
  pdfPageOrientation: 'portrait' | 'landscape';
  pdfPageMargin: number;
  outputDirectory: string;
  outputFileName: string;
  openAfterConvert: boolean;
  headerText: string;
  footerText: string;
  headerAlign: Alignment;
  footerAlign: Alignment;
  headerFooterFontSize: number;
  pageBreakBefore: PageBreakMode;
  breakBeforeTags: string[];
  hideCodeCells: boolean;
  hideOutputs: boolean;
  excludeCellTags: string[];
  tableNowrap: TableNowrap;
  showLineNumbers: LineNumberMode;
  baseFontSize: number;
  bodyFontFamily: string;
  codeFontFamily: string;
  imageFormat: ImageFormat;
  jpegQuality: number;
  deviceScaleFactor: number;
  pdfPermissions: Permission[];
  ownerPassword: string;
  coverPage: boolean;
  coverTitle: string;
  coverSubtitle: string;
  coverAuthor: string;
  watermarkImage: string;
  watermarkWidth: number;
  allowRemoteImages: boolean;
  renderTimeoutSeconds: number;
  teacherMode: boolean;
}

// Mirrors the defaults declared in package.json.
export function defaultSettings(): Settings {
  return {
    pdfTheme: 'light',
    codeTheme: 'mdr-dark',
    pdfPageSize: 'A4',
    pdfPageOrientation: 'portrait',
    pdfPageMargin: 48,
    outputDirectory: '',
    outputFileName: '{name}',
    openAfterConvert: false,
    headerText: '{file}',
    footerText: '{page} / {total}',
    headerAlign: 'right',
    footerAlign: 'right',
    headerFooterFontSize: 10,
    pageBreakBefore: 'none',
    breakBeforeTags: [],
    hideCodeCells: false,
    hideOutputs: false,
    excludeCellTags: [],
    tableNowrap: 'first',
    showLineNumbers: 'auto',
    baseFontSize: 16,
    bodyFontFamily: '',
    codeFontFamily: '',
    imageFormat: 'png',
    jpegQuality: 85,
    deviceScaleFactor: 3,
    pdfPermissions: ['annot-forms'],
    ownerPassword: '',
    coverPage: false,
    coverTitle: '{file}',
    coverSubtitle: '',
    coverAuthor: '',
    watermarkImage: '',
    watermarkWidth: 100,
    allowRemoteImages: true,
    renderTimeoutSeconds: 60,
    teacherMode: false,
  };
}

interface ConfigLike {
  get<T>(key: string, defaultValue: T): T;
}

// Reads and validates every setting; anything malformed falls back to its default.
export function readSettings(config: ConfigLike): Settings {
  const d = defaultSettings();
  const str = (key: keyof Settings): string => {
    const value = config.get<unknown>(key, d[key]);
    return typeof value === 'string' ? value : String(d[key]);
  };
  const bool = (key: keyof Settings): boolean => Boolean(config.get<unknown>(key, d[key]));
  const num = (key: keyof Settings, min: number, max: number): number => {
    const value = Number(config.get<unknown>(key, d[key]));
    return clamp(Number.isFinite(value) ? value : (d[key] as number), min, max);
  };
  const list = (key: keyof Settings): string[] => {
    const value = config.get<unknown>(key, d[key]);
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  };
  const pick = <T extends string>(key: keyof Settings, allowed: readonly T[]): T => {
    const value = str(key);
    return (allowed as readonly string[]).includes(value) ? (value as T) : (d[key] as T);
  };
  return {
    pdfTheme: str('pdfTheme'),
    codeTheme: str('codeTheme'),
    pdfPageSize: str('pdfPageSize'),
    pdfPageOrientation: pick('pdfPageOrientation', ['portrait', 'landscape'] as const),
    pdfPageMargin: num('pdfPageMargin', 0, 200),
    outputDirectory: str('outputDirectory').trim(),
    outputFileName: str('outputFileName').trim() || d.outputFileName,
    openAfterConvert: bool('openAfterConvert'),
    headerText: str('headerText'),
    footerText: str('footerText'),
    headerAlign: pick('headerAlign', ALIGNMENTS),
    footerAlign: pick('footerAlign', ALIGNMENTS),
    headerFooterFontSize: num('headerFooterFontSize', 6, 24),
    pageBreakBefore: pick('pageBreakBefore', PAGE_BREAK_MODES),
    breakBeforeTags: list('breakBeforeTags'),
    hideCodeCells: bool('hideCodeCells'),
    hideOutputs: bool('hideOutputs'),
    excludeCellTags: list('excludeCellTags'),
    tableNowrap: pick('tableNowrap', TABLE_NOWRAP_MODES),
    showLineNumbers: pick('showLineNumbers', LINE_NUMBER_MODES),
    baseFontSize: num('baseFontSize', 8, 32),
    bodyFontFamily: sanitizeFontFamily(str('bodyFontFamily')),
    codeFontFamily: sanitizeFontFamily(str('codeFontFamily')),
    imageFormat: pick('imageFormat', IMAGE_FORMATS),
    jpegQuality: num('jpegQuality', 10, 100),
    deviceScaleFactor: num('deviceScaleFactor', 1, 5),
    pdfPermissions: list('pdfPermissions').filter((p): p is Permission =>
      (PERMISSIONS as readonly string[]).includes(p)
    ),
    ownerPassword: str('ownerPassword'),
    coverPage: bool('coverPage'),
    coverTitle: str('coverTitle'),
    coverSubtitle: str('coverSubtitle'),
    coverAuthor: str('coverAuthor'),
    watermarkImage: str('watermarkImage').trim(),
    watermarkWidth: num('watermarkWidth', 10, 2000),
    allowRemoteImages: bool('allowRemoteImages'),
    renderTimeoutSeconds: num('renderTimeoutSeconds', 10, 600),
    teacherMode: bool('teacherMode'),
  };
}

// The value is dropped into a <style> block; strip anything that could end
// the declaration or the element.
function sanitizeFontFamily(value: string): string {
  return value.replace(/[;{}<>]/g, '').trim();
}

// {file} = file name without extension, {name} = same (output file names),
// {date} = local YYYY-MM-DD. {page}/{total} are filled in per page later.
export function expandPlaceholders(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? vars[key] : whole));
}

function localDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

// Teacher mode (nb_convert.py's --ssam): an instructor mark drawn at the top
// right of every page instead of the header text. The menus show these
// commands only while the teacherMode setting is on.
type Mark = 'ho' | 'ju';
const MARK_IMAGES: Record<Mark, string> = {
  ho: 'https://data.hossam.kr/itwill-ho.png',
  ju: 'https://data.hossam.kr/itwill-ju.png',
};
const MARK_WIDTH = 100;

const COMMANDS: { id: string; withPassword: boolean; mark?: Mark }[] = [
  { id: 'ipynb-pdf-converter.convertToPdf', withPassword: false },
  { id: 'ipynb-pdf-converter.convertToPdfWithPassword', withPassword: true },
  { id: 'ipynb-pdf-converter.convertToPdfHossam', withPassword: false, mark: 'ho' },
  { id: 'ipynb-pdf-converter.convertToPdfHossamWithPassword', withPassword: true, mark: 'ho' },
  { id: 'ipynb-pdf-converter.convertToPdfJussam', withPassword: false, mark: 'ju' },
  { id: 'ipynb-pdf-converter.convertToPdfJussamWithPassword', withPassword: true, mark: 'ju' },
];

// API for other extensions (e.g. pdf2note): the same pipeline, returning the
// PDF bytes instead of writing a file. Obtain it with
// vscode.extensions.getExtension('leekh.ipynb-pdf-converter').exports.
export interface ConvertRequest {
  filePath: string;
  // Settings to override on top of the user's configuration (e.g. headerText: '').
  overrides?: Partial<Settings>;
  password?: string;
  mark?: Mark;
  token?: vscode.CancellationToken;
  onProgress?: (message: string, fraction: number) => void;
}

export interface ConverterApi {
  readonly apiVersion: 1;
  convertToPdfBytes(request: ConvertRequest): Promise<Uint8Array>;
}

export function activate(context: vscode.ExtensionContext): ConverterApi {
  outputChannel = vscode.window.createOutputChannel('Ipynb PDF Converter');

  for (const { id, withPassword, mark } of COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (arg?: unknown) => {
        // Explorer/editor menus pass the file Uri; notebook cell menus pass a
        // cell context instead, so fall back to the active editor's file.
        const target = arg instanceof vscode.Uri ? arg : resolveActiveSourceUri();
        if (!target || !isSupported(target.fsPath)) {
          vscode.window.showErrorMessage('Please select a .ipynb or .md file');
          return;
        }
        const password = withPassword ? await resolvePassword() : undefined;
        if (withPassword && password === undefined) {
          return; // prompt dismissed
        }
        await convertToPdf(context, target.fsPath, password, mark);
      })
    );
  }

  return {
    apiVersion: 1,
    convertToPdfBytes: async (request) => {
      const settings = {
        ...readSettings(vscode.workspace.getConfiguration('ipynb-pdf-converter')),
        ...(request.overrides ?? {}),
      };
      const baseName = path.basename(request.filePath).replace(/\.(ipynb|md)$/i, '');
      const vars = { file: baseName, name: baseName, date: localDate() };
      const token = request.token ?? new vscode.CancellationTokenSource().token;
      const report = request.onProgress ?? (() => undefined);
      outputChannel.appendLine(`📝 API request: ${path.basename(request.filePath)} → PDF bytes`);
      const { buffer } = await producePdf(context, request.filePath, settings, vars, request.password, request.mark, token, report);
      return buffer;
    },
  };
}

// The "with Password" command uses the configured default and prompts only when
// it is empty. The plain command never encrypts, even if a default is set.
async function resolvePassword(): Promise<string | undefined> {
  const configured = vscode.workspace
    .getConfiguration('ipynb-pdf-converter')
    .get<string>('pdfPassword', '');
  if (configured) {
    return configured;
  }
  return vscode.window.showInputBox({
    title: 'PDF Password',
    prompt: 'No default password is set (ipynb-pdf-converter.pdfPassword). Enter a password for this PDF.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value ? undefined : 'Password cannot be empty'),
  });
}

async function convertToPdf(
  context: vscode.ExtensionContext,
  filePath: string,
  password?: string,
  mark?: Mark
): Promise<void> {
  const fileName = path.basename(filePath);
  const baseName = fileName.replace(/\.(ipynb|md)$/i, '');
  const settings = readSettings(vscode.workspace.getConfiguration('ipynb-pdf-converter'));
  const vars = { file: baseName, name: baseName, date: localDate() };

  // The log stays in the background; the progress notification is the UI.
  outputChannel.clear();
  outputChannel.appendLine(`📝 Converting: ${fileName} → PDF`);

  // The notification carries a progress bar and a cancel button; stages add up to 100.
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Converting ${fileName} to PDF`, cancellable: true },
    (progress, token) => runConversion(context, filePath, password, mark, settings, vars, progress, token)
  );
}

async function runConversion(
  context: vscode.ExtensionContext,
  filePath: string,
  password: string | undefined,
  mark: Mark | undefined,
  settings: Settings,
  vars: Record<string, string>,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
): Promise<void> {
  const fileName = path.basename(filePath);
  const baseName = vars.name;
  try {
    const sourceDir = path.dirname(filePath);
    const outputDir = settings.outputDirectory
      ? path.resolve(sourceDir, settings.outputDirectory)
      : sourceDir;
    const outputName = (expandPlaceholders(settings.outputFileName, vars) || baseName).replace(/\.pdf$/i, '');

    // producePdf reports fractions 0..1; the notification wants increments summing to 100.
    let reached = 0;
    const { buffer, pages, warnings } = await producePdf(context, filePath, settings, vars, password, mark, token, (message, fraction) => {
      const next = Math.round(fraction * 90);
      progress.report({ message, increment: next - reached });
      reached = next;
    });
    progress.report({ message: 'Saving…', increment: 100 - reached });
    await fs.mkdir(outputDir, { recursive: true });
    // Never overwrite: an existing "name.pdf" yields "name (1).pdf", then "(2)"…
    const outputPath = await uniquePdfPath(outputDir, outputName);
    await fs.writeFile(outputPath, buffer);
    outputChannel.appendLine(`✅ Saved: ${outputPath} (${pages} page${pages === 1 ? '' : 's'})`);
    const summary = `✅ Converted to PDF${password ? ' (password protected)' : ''}: ${path.basename(outputPath)}`;
    // Not awaited: the progress notification must close when this function returns.
    if (warnings > 0) {
      vscode.window
        .showWarningMessage(`${summary} — ${warnings} image${warnings === 1 ? '' : 's'} could not be embedded`, 'Show Log')
        .then((choice) => {
          if (choice === 'Show Log') outputChannel.show();
        });
    } else {
      vscode.window.showInformationMessage(summary);
    }
    if (settings.openAfterConvert) {
      await vscode.env.openExternal(vscode.Uri.file(outputPath));
    }
  } catch (error) {
    if (token.isCancellationRequested) {
      outputChannel.appendLine('⏹ Cancelled');
      vscode.window.showInformationMessage(`Conversion of ${fileName} cancelled`);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`❌ Error: ${message}`);
    vscode.window.showErrorMessage(`Failed to convert notebook: ${message}`, 'Show Log').then((choice) => {
      if (choice === 'Show Log') outputChannel.show();
    });
  }
}

// Renders the source to PDF bytes: document assembly, webview capture and
// jsPDF assembly. Shared by the commands and the extension API.
async function producePdf(
  context: vscode.ExtensionContext,
  filePath: string,
  settings: Settings,
  vars: Record<string, string>,
  password: string | undefined,
  mark: Mark | undefined,
  token: vscode.CancellationToken,
  report: (message: string, fraction: number) => void
): Promise<{ buffer: Buffer; pages: number; warnings: number }> {
  const sourceDir = path.dirname(filePath);
  report('Rendering document…', 0.05);
  const raw = await fs.readFile(filePath, 'utf-8');
  let warnings = 0;
  const bodyHtml = await buildDocumentHtml(filePath, raw, settings, vars, (warning) => {
    warnings++;
    outputChannel.appendLine(`⚠️ ${warning}`);
  });

  // The mark is fetched on purpose, so allowRemoteImages does not apply.
  let markImage: string | undefined;
  if (mark) {
    try {
      markImage = await loadAsDataUrl(MARK_IMAGES[mark], sourceDir);
      outputChannel.appendLine(`🖼️ Teacher mode: ${mark === 'ho' ? 'hossam' : 'jussam'} mark on every page`);
    } catch (error) {
      outputChannel.appendLine(
        `⚠️ Instructor mark not available (${MARK_IMAGES[mark]}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const layout = resolveLayout(settings);
  const theme = resolveTheme(settings.codeTheme);
  const pageTheme = resolvePageTheme(settings.pdfTheme);
  outputChannel.appendLine(
    `Rendering in webview (page theme: ${pageTheme.info.label}, code theme: ${theme.info.label}, ` +
      `paper: ${layout.key} ${settings.pdfPageOrientation} = ${layout.widthPx}×${layout.heightPx}px CSS, ` +
      `margin: ${layout.margin}px, scale: ${settings.deviceScaleFactor}x, pages as ${settings.imageFormat.toUpperCase()})…`
  );
  report('Capturing pages…', 0.1);
  // The webview reports each captured chunk; capture spans 10%..85%.
  const pages = await captureInWebview(context, { bodyHtml, settings, vars, markImage }, token, (done, total) =>
    report(`Capturing pages… (${done}/${total})`, 0.1 + (done / total) * 0.75)
  );

  report('Assembling PDF…', 0.9);
  outputChannel.appendLine(
    `Assembling PDF (${pages.length} page${pages.length === 1 ? '' : 's'}${password ? ', password protected' : ''})…`
  );
  const buffer = await generatePdfFromPages(pages, layout.widthPx, layout.heightPx, {
    password,
    ownerPassword: settings.ownerPassword,
    permissions: settings.pdfPermissions,
  });
  report('Assembled', 1);
  return { buffer, pages: pages.length, warnings };
}

export async function uniquePdfPath(dir: string, name: string): Promise<string> {
  const exists = (p: string) => fs.access(p).then(() => true, () => false);
  let candidate = path.join(dir, `${name}.pdf`);
  for (let n = 1; await exists(candidate); n++) {
    candidate = path.join(dir, `${name} (${n}).pdf`);
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Document assembly (no vscode API, so it can be exercised outside the host)
// ---------------------------------------------------------------------------

// Renders the source, prepends the optional cover, appends the optional
// watermark and embeds every referenced image as a data: URL.
export async function buildDocumentHtml(
  filePath: string,
  raw: string,
  settings: Settings,
  vars: Record<string, string>,
  warn: (message: string) => void
): Promise<string> {
  const rendered = filePath.toLowerCase().endsWith('.md')
    ? renderMarkdown(raw)
    : renderNotebook(JSON.parse(raw) as Notebook, {
        hideCodeCells: settings.hideCodeCells,
        hideOutputs: settings.hideOutputs,
        excludeCellTags: settings.excludeCellTags,
        breakBeforeTags: settings.breakBeforeTags,
      });
  // The watermark goes last: it is absolutely positioned, so order only
  // decides paint order, and the cover must stay the first element in flow.
  const cover = settings.coverPage ? coverHtml(settings, vars) : '';
  const watermark = settings.watermarkImage
    ? `<img class="jp-Watermark" src="${escapeAttr(settings.watermarkImage)}" style="width:${settings.watermarkWidth}px" alt="" />`
    : '';
  // Referenced images (relative/absolute paths, file: or http(s) URLs) are
  // embedded as data: URLs; the webview cannot load them from disk itself.
  const { html, failures } = await inlineImages(cover + rendered + watermark, path.dirname(filePath), {
    allowRemote: settings.allowRemoteImages,
  });
  for (const failure of failures) {
    warn(`Image not embedded: ${failure}`);
  }
  return html;
}

// A full-page cover: .jp-PageBreakAfter makes the paginator end the page
// exactly at its bottom edge, and the CSS sizes it to one content area.
function coverHtml(settings: Settings, vars: Record<string, string>): string {
  const title = expandPlaceholders(settings.coverTitle || '{file}', vars);
  const subtitle = expandPlaceholders(settings.coverSubtitle, vars);
  const author = expandPlaceholders(settings.coverAuthor, vars);
  return (
    `<section class="pdf-cover jp-PageBreakAfter"><h1>${escapeHtml(title)}</h1>` +
    (subtitle ? `<p class="pdf-cover-subtitle">${escapeHtml(subtitle)}</p>` : '') +
    (author ? `<p class="pdf-cover-author">${escapeHtml(author)}</p>` : '') +
    `</section>`
  );
}

interface Layout {
  key: string;
  widthPx: number;
  heightPx: number;
  margin: number;
}

function resolveLayout(settings: Settings): Layout {
  const page = resolvePageDimensions(settings.pdfPageSize, settings.pdfPageOrientation);
  const margin = clamp(
    settings.pdfPageMargin,
    0,
    Math.min(Math.floor(page.widthPx / 2) - 1, Math.floor(page.heightPx / 2) - 1)
  );
  return { key: page.key, widthPx: page.widthPx, heightPx: page.heightPx, margin };
}

export interface CaptureParams {
  bodyHtml: string;
  settings: Settings;
  vars: Record<string, string>;
  // data: URL of the instructor mark (teacher mode); replaces the header text.
  markImage?: string;
}

async function captureInWebview(
  context: vscode.ExtensionContext,
  params: CaptureParams,
  token: vscode.CancellationToken,
  onProgress: (done: number, total: number) => void
): Promise<string[]> {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');

  const panel = vscode.window.createWebviewPanel(
    'ipynbPdfRenderer',
    'Converting notebook…',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot],
    }
  );

  const html2canvasUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(mediaRoot, 'html2canvas.min.js')
  );

  let html: string;
  try {
    html = await buildCaptureHtml(
      mediaRoot.fsPath,
      params,
      panel.webview.cspSource,
      html2canvasUri.toString()
    );
  } catch (error) {
    panel.dispose();
    throw error;
  }

  const timeoutSeconds = params.settings.renderTimeoutSeconds;
  return new Promise((resolve, reject) => {
    const disposables: vscode.Disposable[] = [];
    const finish = (settle: () => void) => {
      clearTimeout(timeout);
      disposables.forEach((d) => d.dispose());
      panel.dispose();
      settle();
    };
    const timeout = setTimeout(
      () => finish(() => reject(new Error(`Webview rendering timed out after ${timeoutSeconds}s (renderTimeoutSeconds)`))),
      timeoutSeconds * 1000
    );

    disposables.push(
      panel.webview.onDidReceiveMessage((msg) => {
        if (msg?.type === 'progress') {
          onProgress(Number(msg.done), Number(msg.total));
        } else if (msg?.type === 'result') {
          finish(() => resolve((msg.pages as string[]) ?? [msg.dataUrl as string]));
        } else if (msg?.type === 'error') {
          finish(() => reject(new Error(String(msg.message ?? 'Unknown webview error'))));
        }
      }),
      token.onCancellationRequested(() => finish(() => reject(new Error('Cancelled')))),
      // Closing the panel by hand also cancels.
      panel.onDidDispose(() => finish(() => reject(new Error('Cancelled: the conversion view was closed'))))
    );

    panel.webview.html = html;
  });
}

// Builds the page the webview renders and captures. Free of the vscode API so
// it can be exercised outside the extension host.
export async function buildCaptureHtml(
  mediaDir: string,
  params: CaptureParams,
  cspSource: string,
  html2canvasUri: string
): Promise<string> {
  const { bodyHtml, settings, vars, markImage } = params;
  const asset = (...segments: string[]) => path.join(mediaDir, ...segments);
  const layout = resolveLayout(settings);
  const theme = resolveTheme(settings.codeTheme);
  const pageTheme = resolvePageTheme(settings.pdfTheme);
  const themeKey = theme.key;
  const captureWidth = layout.widthPx - 2 * layout.margin;

  // Inline CSS into a <style> tag. html2canvas clones the DOM into an iframe
  // and cannot fetch external stylesheets across webview origins, so <link>
  // tags would produce an unstyled capture even though the live webview looks
  // correct. Order matters: later sheets override earlier ones.
  // 'default' keeps the GitHub look plus the optional per-code-theme chrome
  // (headings, tables, output accents). The Markdown Reader themes replace
  // github-markdown.css with mdr.css and own the page chrome themselves.
  const isMdr = pageTheme.key !== 'default';
  const sheets = isMdr
    ? [
        readAssetCached(asset('page-themes', 'mdr.css')),
        readAssetCached(asset('themes', `${themeKey}.css`)),
        readAssetCached(asset('styles.css')),
        readAssetCached(asset('page-themes', 'mdr-overrides.css')),
      ]
    : [
        readAssetCached(asset('github-markdown.css')),
        readAssetCached(asset('themes', `${themeKey}.css`)),
        readAssetCached(asset('styles.css')),
        readAssetCached(asset('themes', `${themeKey}.chrome.css`), true),
      ];
  const css = (await Promise.all(sheets)).join('\n');

  // The Markdown Reader themes add nb_convert.py's 30 px body margin on top of
  // the first page; the cover fills what is left of that page.
  const coverHeight = layout.heightPx - 2 * layout.margin - (isMdr ? 30 : 0);
  const themeVars = `:root {
  --capture-width: ${captureWidth}px;
  --cover-height: ${coverHeight}px;
  --code-bg: ${theme.info.background};
  --code-fg: ${theme.info.foreground};
  --code-border: ${theme.info.border};
  --line-number-color: ${theme.info.lineNumber};
}`;
  // User overrides win over every theme sheet.
  const userCss = [
    settings.baseFontSize !== 16 ? `html, body { font-size: ${settings.baseFontSize}px; }` : '',
    settings.bodyFontFamily
      ? `body, .mdr-content, .markdown-body { font-family: ${settings.bodyFontFamily} !important; }`
      : '',
    settings.codeFontFamily
      ? `.jp-InputArea-editor pre, .jp-RenderedText, .markdown-body pre, .markdown-body code, ` +
        `.mdr-content pre, .mdr-content code { font-family: ${settings.codeFontFamily} !important; }`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  // mdr.css selects its palette from these attributes and expects the content
  // wrapped in body.mdr-pre.mdr > article.mdr-content (apply_mdr_dom in nb_convert.py).
  const codeBlockTheme = isDarkColor(theme.info.background) ? 'dark' : 'light';
  const htmlAttrs =
    ` data-table-nowrap="${settings.tableNowrap}"` +
    (settings.showLineNumbers !== 'auto' ? ` data-line-numbers="${settings.showLineNumbers}"` : '') +
    (isMdr ? ` data-mdr-theme="${pageTheme.key}" data-mdr-code-block-theme="${codeBlockTheme}"` : '');
  const bodyAttrs = isMdr ? ' class="mdr-pre mdr"' : '';
  const content = isMdr ? `<article class="mdr-content">${bodyHtml}</article>` : bodyHtml;

  const breakBeforeSelector = {
    h1: 'h1, .jp-PageBreakBefore',
    'h1-h2': 'h1, h2, .jp-PageBreakBefore',
    none: '.jp-PageBreakBefore',
  }[settings.pageBreakBefore];

  return buildWebviewHtml({
    bodyHtml: content,
    htmlAttrs,
    bodyAttrs,
    cspSource,
    html2canvasUri,
    inlineCss: `${themeVars}\n${css}\n${userCss}`,
    config: {
      scale: settings.deviceScaleFactor,
      pageW: layout.widthPx,
      pageH: layout.heightPx,
      margin: layout.margin,
      background: pageTheme.info.background,
      imageFormat: settings.imageFormat,
      jpegQuality: settings.jpegQuality / 100,
      header: { text: expandPlaceholders(settings.headerText, vars), align: settings.headerAlign },
      footer: { text: expandPlaceholders(settings.footerText, vars), align: settings.footerAlign },
      runningFontPx: settings.headerFooterFontSize,
      breakBeforeSelector,
      mark: markImage ? { image: markImage, width: MARK_WIDTH } : null,
    },
  });
}

interface WebviewConfig {
  scale: number;
  pageW: number;
  pageH: number;
  margin: number;
  background: string;
  imageFormat: ImageFormat;
  jpegQuality: number;
  header: { text: string; align: Alignment };
  footer: { text: string; align: Alignment };
  runningFontPx: number;
  breakBeforeSelector: string;
  mark: { image: string; width: number } | null;
}

function buildWebviewHtml(params: {
  bodyHtml: string;
  htmlAttrs: string;
  bodyAttrs: string;
  cspSource: string;
  html2canvasUri: string;
  inlineCss: string;
  config: WebviewConfig;
}): string {
  const { bodyHtml, htmlAttrs, bodyAttrs, cspSource, html2canvasUri, inlineCss, config } = params;
  // The config lands inside a <script>; keep it JSON-safe and tag-safe.
  const configJs = JSON.stringify(config).replace(/</g, '\\u003c');
  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} data: blob:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource} data:`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en"${htmlAttrs}>
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>${inlineCss}</style>
<script src="${html2canvasUri}"></script>
</head>
<body${bodyAttrs}>
<div id="capture-root">${bodyHtml}</div>
<script>
(function () {
  const vscode = acquireVsCodeApi();
  const cfg = ${configJs};
  const scale = cfg.scale;
  const contentH = cfg.pageH - 2 * cfg.margin;
  // Running header and footer sit in the margin band. They are drawn on the
  // canvas so Korean text uses the system fonts instead of a PDF-embedded one.
  const RUNNING_COLOR = '#909090';
  // CSS px kept together at the top and bottom of a box (border + padding +
  // one line), so a page never ends with a bare box edge or an orphaned heading.
  const EDGE = 32;

  // Ranges (CSS px from the top of #capture-root) a page may not cut through.
  // Mirrors how WeasyPrint paginates the same document in nb_convert.py: never
  // inside a line of text, a table row or an image.
  function collectKeepTogether(root) {
    const rootTop = root.getBoundingClientRect().top;
    const boxes = [];
    const add = (top, bottom) => {
      if (bottom - top > 0.5) boxes.push({ top: top - rootTop, bottom: bottom - rootTop });
    };
    // The watermark is absolutely positioned and must not steer the cuts.
    root.querySelectorAll('tr, img:not(.jp-Watermark), svg, figure').forEach((el) => {
      const r = el.getBoundingClientRect();
      add(r.top, r.bottom);
    });
    root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
      const r = el.getBoundingClientRect();
      add(r.top, r.bottom + EDGE);
    });
    root.querySelectorAll('pre, blockquote, table, ul, ol, .jp-InputArea-editor, .jp-OutputArea').forEach((el) => {
      const r = el.getBoundingClientRect();
      add(r.top, Math.min(r.bottom, r.top + EDGE));
      add(Math.max(r.top, r.bottom - EDGE), r.bottom);
    });
    const range = document.createRange();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) add(r.top, r.bottom);
    }
    return boxes;
  }

  // Page starts forced by the pageBreakBefore setting (nb_convert.py: h1 { break-before: page }),
  // by tagged cells (.jp-PageBreakBefore) and after the cover (.jp-PageBreakAfter).
  // An element already at the very top of the document needs no break.
  function forcedBreaks(root, boxes) {
    const rootTop = root.getBoundingClientRect().top;
    const firstTop = boxes.reduce((min, b) => Math.min(min, b.top), Infinity);
    const tops = Array.from(root.querySelectorAll(cfg.breakBeforeSelector))
      .filter((el) => !el.closest('.pdf-cover')) // the cover's own title is not a section start
      .map((el) => el.getBoundingClientRect().top - rootTop);
    const bottoms = Array.from(root.querySelectorAll('.jp-PageBreakAfter')).map(
      (el) => el.getBoundingClientRect().bottom - rootTop
    );
    return tops.concat(bottoms).filter((y) => y > firstTop + 2);
  }

  function computeCuts(totalH, pageH, boxes, forced) {
    const cuts = [];
    // A forced break that would leave the page empty (e.g. a heading right
    // after the cover, or two breaks back to back) is skipped.
    const hasContent = (from, to) => boxes.some((b) => b.top >= from - 0.5 && b.top < to);
    let y = 0;
    while (y < totalH - 0.5) {
      let end = Math.min(y + pageH, totalH);
      const nextForced = forced.find((f) => f > y + 1 && f < end && hasContent(y, f));
      if (nextForced !== undefined) {
        end = nextForced;
      } else if (end < totalH) {
        // Pull the cut up to the top of whatever it would split; a box that
        // started on this page already (taller than the page) is cut anyway.
        for (let moved = true, guard = 0; moved && guard < 10000; guard++) {
          moved = false;
          for (const b of boxes) {
            if (b.top < end - 0.5 && b.bottom > end + 0.5 && b.top > y + 1) {
              end = b.top;
              moved = true;
            }
          }
        }
      }
      cuts.push([y, end]);
      y = end;
    }
    return cuts;
  }

  function encodePage(canvas) {
    return cfg.imageFormat === 'jpeg'
      ? canvas.toDataURL('image/jpeg', cfg.jpegQuality)
      : canvas.toDataURL('image/png');
  }

  // Chromium caps a canvas at 32,767 px per side and html2canvas then returns
  // a blank one, which a long notebook at scale 3 hits after about ten pages.
  // So the document is captured in chunks that end on page cuts.
  const MAX_CHUNK_PX = 16000;

  function groupCuts(cuts, maxChunkCss) {
    const chunks = [];
    let chunk = null;
    for (const cut of cuts) {
      if (!chunk || cut[1] - chunk.top > maxChunkCss) {
        chunk = { top: cut[0], bottom: cut[1], cuts: [] };
        chunks.push(chunk);
      }
      chunk.cuts.push(cut);
      chunk.bottom = cut[1];
    }
    return chunks;
  }

  function sliceIntoPages(srcCanvas, chunk, firstPageNo, pageCount) {
    const W = Math.round(cfg.pageW * scale);
    const H = Math.round(cfg.pageH * scale);
    const M = Math.round(cfg.margin * scale);
    return chunk.cuts.map(([y0, y1], i) => {
      const sy = Math.round((y0 - chunk.top) * scale);
      const sh = Math.min(Math.round((y1 - chunk.top) * scale), srcCanvas.height) - sy;
      const page = document.createElement('canvas');
      page.width = W;
      page.height = H;
      const ctx = page.getContext('2d');
      ctx.fillStyle = cfg.background;
      ctx.fillRect(0, 0, W, H);
      if (sh > 0) ctx.drawImage(srcCanvas, 0, sy, srcCanvas.width, sh, M, M, srcCanvas.width, sh);
      drawRunning(ctx, W, H, M, firstPageNo + i, pageCount);
      return encodePage(page);
    });
  }

  let markImg = null; // teacher mode: decoded instructor mark

  function drawRunning(ctx, W, H, M, pageNo, pageCount) {
    const px = cfg.runningFontPx * scale;
    ctx.fillStyle = RUNNING_COLOR;
    ctx.font = px + 'px "Helvetica Neue", -apple-system, "Segoe UI", "Noto Sans CJK KR", sans-serif';
    ctx.textBaseline = 'middle';
    const place = (part, y) => {
      if (!part.text || M < 2 * px) return; // margin band too thin to hold the text
      const text = part.text.replace(/\\{page\\}/g, String(pageNo)).replace(/\\{total\\}/g, String(pageCount));
      ctx.textAlign = part.align;
      const x = part.align === 'left' ? M : part.align === 'center' ? W / 2 : W - M;
      ctx.fillText(fitText(ctx, text, W - 2 * M), x, y);
    };
    if (markImg) {
      // Right-aligned to the content edge, centred in the top margin band and
      // shrunk if the band is too thin; it takes the header's place.
      let w = cfg.mark.width * scale;
      let h = (w * markImg.naturalHeight) / markImg.naturalWidth;
      const maxH = Math.max(M - 4 * scale, 1);
      if (h > maxH) {
        w = (w * maxH) / h;
        h = maxH;
      }
      ctx.drawImage(markImg, W - M - w, (M - h) / 2, w, h);
    } else {
      place(cfg.header, M / 2);
    }
    place(cfg.footer, H - M / 2);
  }

  function loadMark() {
    if (!cfg.mark) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { markImg = img; resolve(); };
      img.onerror = () => resolve();
      img.src = cfg.mark.image;
    });
  }

  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '\\u2026').width > maxWidth) t = t.slice(0, -1);
    return t + '\\u2026';
  }

  function capture() {
    const target = document.getElementById('capture-root');
    const boxes = collectKeepTogether(target);
    const forced = forcedBreaks(target, boxes);
    const rect = target.getBoundingClientRect();
    const cuts = computeCuts(rect.height, contentH, boxes, forced);
    if (cuts.length === 0) cuts.push([0, 1]); // empty document: still one page
    const chunks = groupCuts(cuts, MAX_CHUNK_PX / scale);
    const pages = [];
    let firstPageNo = 1;
    let chain = Promise.resolve();
    for (const chunk of chunks) {
      const pageNo = firstPageNo;
      chain = chain
        .then(() =>
          html2canvas(target, {
            scale: scale,
            backgroundColor: cfg.background,
            useCORS: true,
            logging: false,
            windowWidth: target.scrollWidth,
            windowHeight: target.scrollHeight,
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY + chunk.top,
            width: Math.ceil(rect.width),
            height: Math.ceil(chunk.bottom - chunk.top),
          })
        )
        .then((canvas) => {
          pages.push(...sliceIntoPages(canvas, chunk, pageNo, cuts.length));
          vscode.postMessage({ type: 'progress', done: chunks.indexOf(chunk) + 1, total: chunks.length });
        });
      firstPageNo += chunk.cuts.length;
    }
    chain
      .then(() => {
        vscode.postMessage({ type: 'result', pages, debug: { forced, cuts, chunks: chunks.length } });
      })
      .catch((err) => {
        vscode.postMessage({ type: 'error', message: String(err && err.message || err) });
      });
  }
  // Wait for fonts and images before capturing
  const imgPromises = Array.from(document.images).map((img) =>
    img.complete ? Promise.resolve() : new Promise((r) => {
      img.addEventListener('load', r);
      img.addEventListener('error', r);
    })
  );
  Promise.all([document.fonts ? document.fonts.ready : Promise.resolve(), loadMark(), ...imgPromises])
    .then(() => requestAnimationFrame(() => requestAnimationFrame(capture)))
    .catch(() => capture());
})();
</script>
</body>
</html>`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text);
}

export async function generatePdfFromPages(
  pages: string[],
  pageWidthCss: number,
  pageHeightCss: number,
  options: { password?: string; ownerPassword?: string; permissions?: Permission[] }
): Promise<Buffer> {
  const orientation = pageHeightCss >= pageWidthCss ? 'portrait' : 'landscape';
  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [pageWidthCss, pageHeightCss],
    hotfixes: ['px_scaling'],
    compress: true,
    // jsPDF only offers 40-bit RC4. Default permissions mirror
    // secure_pdf_with_pikepdf in nb_convert.py (annotations/forms only). The
    // owner password is random unless the user sets one, so the limits hold
    // for anyone who only has the user password.
    encryption: options.password
      ? {
          userPassword: options.password,
          ownerPassword: options.ownerPassword || randomBytes(16).toString('hex'),
          userPermissions: options.permissions ?? ['annot-forms'],
        }
      : undefined,
  });
  // Each page image already carries margins, paper color, header and footer.
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) {
      pdf.addPage([pageWidthCss, pageHeightCss], orientation);
    }
    const format = pages[i].startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
    pdf.addImage(pages[i], format, 0, 0, pageWidthCss, pageHeightCss, undefined, 'FAST');
  }
  return Buffer.from(pdf.output('arraybuffer'));
}

function resolveActiveSourceUri(): vscode.Uri | undefined {
  const notebook = vscode.window.activeNotebookEditor?.notebook.uri;
  if (notebook && isSupported(notebook.fsPath)) {
    return notebook;
  }
  const editor = vscode.window.activeTextEditor?.document.uri;
  if (editor && isSupported(editor.fsPath)) {
    return editor;
  }
  return undefined;
}

export function deactivate() {}
