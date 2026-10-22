import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { jsPDF } from 'jspdf';
import { renderNotebook, renderMarkdown } from './render';
import { Notebook } from './notebook';
import { isDarkColor, resolvePageTheme, resolveTheme, PageThemeInfo, ThemeInfo } from './themes';
import { resolvePageDimensions } from './paper';

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

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Ipynb PDF Converter');

  const register = (command: string, withPassword: boolean) =>
    vscode.commands.registerCommand(command, async (fileUri?: vscode.Uri) => {
      const target = fileUri ?? resolveActiveSourceUri();
      if (!target || !isSupported(target.fsPath)) {
        vscode.window.showErrorMessage('Please select a .ipynb or .md file');
        return;
      }
      const password = withPassword ? await resolvePassword() : undefined;
      if (withPassword && password === undefined) {
        return; // prompt dismissed
      }
      await convertToPdf(context, target.fsPath, password);
    });

  context.subscriptions.push(
    register('ipynb-pdf-converter.convertToPdf', false),
    register('ipynb-pdf-converter.convertToPdfWithPassword', true)
  );
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
  password?: string
): Promise<void> {
  const fileName = path.basename(filePath);
  const outputPath = filePath.replace(/\.(ipynb|md)$/i, '.pdf');

  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.appendLine(`📝 Converting: ${fileName} → PDF`);

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const bodyHtml = filePath.toLowerCase().endsWith('.md')
      ? renderMarkdown(raw)
      : renderNotebook(JSON.parse(raw) as Notebook);

    const config = vscode.workspace.getConfiguration('ipynb-pdf-converter');
    const scale = clamp(config.get<number>('deviceScaleFactor', 3), 1, 5);
    const orientation = config.get<string>('pdfPageOrientation', 'portrait');
    const page = resolvePageDimensions(config.get<string>('pdfPageSize'), orientation);
    const pdfPageWidth = page.widthPx;
    const pdfPageHeight = page.heightPx;
    const pdfPageMargin = clamp(
      config.get<number>('pdfPageMargin', 48),
      0,
      Math.min(Math.floor(pdfPageWidth / 2) - 1, Math.floor(pdfPageHeight / 2) - 1)
    );
    const theme = resolveTheme(config.get<string>('codeTheme'));
    const pageTheme = resolvePageTheme(config.get<string>('pdfTheme'));

    outputChannel.appendLine(
      `Rendering in webview (page theme: ${pageTheme.info.label}, code theme: ${theme.info.label}, ` +
        `paper: ${page.key} ${orientation} = ${pdfPageWidth}×${pdfPageHeight}px CSS, margin: ${pdfPageMargin}px, scale: ${scale}x)…`
    );
    const pages = await captureInWebview(context, {
      bodyHtml,
      title: fileName.replace(/\.(ipynb|md)$/i, ''),
      scale,
      pageWidth: pdfPageWidth,
      pageHeight: pdfPageHeight,
      margin: pdfPageMargin,
      theme: theme.info,
      themeKey: theme.key,
      pageTheme: pageTheme.info,
      pageThemeKey: pageTheme.key,
    });

    outputChannel.appendLine(
      `Assembling PDF (${pages.length} page${pages.length === 1 ? '' : 's'}${password ? ', password protected' : ''})…`
    );
    const buffer = await generatePdfFromPages(pages, pdfPageWidth, pdfPageHeight, { password });
    await fs.writeFile(outputPath, buffer);

    outputChannel.appendLine(`✅ Saved: ${outputPath}`);
    vscode.window.showInformationMessage(
      `✅ Converted to PDF${password ? ' (password protected)' : ''}: ${path.basename(outputPath)}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`❌ Error: ${message}`);
    vscode.window.showErrorMessage(`Failed to convert notebook: ${message}`);
  }
}

export interface CaptureParams {
  bodyHtml: string;
  title: string;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  theme: ThemeInfo;
  themeKey: string;
  pageTheme: PageThemeInfo;
  pageThemeKey: string;
}

async function captureInWebview(
  context: vscode.ExtensionContext,
  params: CaptureParams
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

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      panel.dispose();
      reject(new Error('Webview rendering timed out after 60s'));
    }, 60_000);

    const subscription = panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'result') {
        clearTimeout(timeout);
        subscription.dispose();
        panel.dispose();
        resolve((msg.pages as string[]) ?? [msg.dataUrl as string]);
      } else if (msg?.type === 'error') {
        clearTimeout(timeout);
        subscription.dispose();
        panel.dispose();
        reject(new Error(String(msg.message ?? 'Unknown webview error')));
      }
    });

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
  const { bodyHtml, title, scale, pageWidth, pageHeight, margin, theme, themeKey, pageTheme, pageThemeKey } =
    params;
  const asset = (...segments: string[]) => path.join(mediaDir, ...segments);
  const captureWidth = pageWidth - 2 * margin;

  // Inline CSS into a <style> tag. html2canvas clones the DOM into an iframe
  // and cannot fetch external stylesheets across webview origins, so <link>
  // tags would produce an unstyled capture even though the live webview looks
  // correct. Order matters: later sheets override earlier ones.
  // 'default' keeps the GitHub look plus the optional per-code-theme chrome
  // (headings, tables, output accents). The Markdown Reader themes replace
  // github-markdown.css with mdr.css and own the page chrome themselves.
  const isMdr = pageThemeKey !== 'default';
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

  const themeVars = `:root {
  --capture-width: ${captureWidth}px;
  --code-bg: ${theme.background};
  --code-fg: ${theme.foreground};
  --code-border: ${theme.border};
  --line-number-color: ${theme.lineNumber};
}`;

  // mdr.css selects its palette from these attributes and expects the content
  // wrapped in body.mdr-pre.mdr > article.mdr-content (apply_mdr_dom in nb_convert.py).
  const codeBlockTheme = isDarkColor(theme.background) ? 'dark' : 'light';
  const htmlAttrs = isMdr
    ? ` data-mdr-theme="${pageThemeKey}" data-mdr-code-block-theme="${codeBlockTheme}"`
    : '';
  const bodyAttrs = isMdr ? ' class="mdr-pre mdr"' : '';
  const content = isMdr ? `<article class="mdr-content">${bodyHtml}</article>` : bodyHtml;

  return buildWebviewHtml({
    bodyHtml: content,
    htmlAttrs,
    bodyAttrs,
    background: pageTheme.background,
    title,
    scale,
    pageWidth,
    pageHeight,
    margin,
    cspSource,
    html2canvasUri,
    inlineCss: `${themeVars}\n${css}`,
  });
}

function buildWebviewHtml(params: {
  bodyHtml: string;
  htmlAttrs: string;
  bodyAttrs: string;
  background: string;
  title: string;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  cspSource: string;
  html2canvasUri: string;
  inlineCss: string;
}): string {
  const {
    bodyHtml,
    htmlAttrs,
    bodyAttrs,
    background,
    title,
    scale,
    pageWidth,
    pageHeight,
    margin,
    cspSource,
    html2canvasUri,
    inlineCss,
  } = params;
  // The title lands inside a <script>; keep it JSON-safe and tag-safe.
  const titleJs = JSON.stringify(title).replace(/</g, '\\u003c');
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
  const scale = ${scale};
  const pageW = ${pageWidth};
  const pageH = ${pageHeight};
  const margin = ${margin};
  const contentH = pageH - 2 * margin;
  const background = '${background}';
  const title = ${titleJs};
  // Running header (file name, top right) and footer (page number, bottom
  // right) sit in the margin band. They are drawn on the canvas so Korean
  // file names use the system fonts instead of a font embedded in the PDF.
  const RUNNING_FONT_PX = 10;
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
    root.querySelectorAll('tr, img, svg, figure').forEach((el) => {
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

  // h1:not(:first-of-type) { break-before: page } in nb_convert.py.
  function forcedBreaks(root) {
    const rootTop = root.getBoundingClientRect().top;
    return Array.from(root.querySelectorAll('h1'))
      .slice(1)
      .map((el) => el.getBoundingClientRect().top - rootTop);
  }

  function computeCuts(totalH, pageH, boxes, forced) {
    const cuts = [];
    let y = 0;
    while (y < totalH - 0.5) {
      let end = Math.min(y + pageH, totalH);
      const nextForced = forced.find((f) => f > y + 1 && f < end);
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

  function sliceIntoPages(srcCanvas, cuts) {
    const W = Math.round(pageW * scale);
    const H = Math.round(pageH * scale);
    const M = Math.round(margin * scale);
    const pages = [];
    cuts.forEach(([y0, y1], i) => {
      const sy = Math.round(y0 * scale);
      const sh = Math.min(Math.round(y1 * scale), srcCanvas.height) - sy;
      if (sh <= 0) return;
      const page = document.createElement('canvas');
      page.width = W;
      page.height = H;
      const ctx = page.getContext('2d');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(srcCanvas, 0, sy, srcCanvas.width, sh, M, M, srcCanvas.width, sh);
      drawRunning(ctx, W, H, M, i + 1, cuts.length);
      pages.push(page.toDataURL('image/png'));
    });
    return pages.length > 0 ? pages : [srcCanvas.toDataURL('image/png')];
  }

  function drawRunning(ctx, W, H, M, pageNo, pageCount) {
    const px = RUNNING_FONT_PX * scale;
    if (M < 2 * px) return; // margin band too thin to hold the text
    ctx.fillStyle = RUNNING_COLOR;
    ctx.font = px + 'px "Helvetica Neue", -apple-system, "Segoe UI", "Noto Sans CJK KR", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, title, W - 2 * M), W - M, M / 2);
    ctx.fillText(pageNo + ' / ' + pageCount, W - M, H - M / 2);
  }

  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '\u2026').width > maxWidth) t = t.slice(0, -1);
    return t + '\u2026';
  }

  function capture() {
    const target = document.getElementById('capture-root');
    const boxes = collectKeepTogether(target);
    const forced = forcedBreaks(target);
    html2canvas(target, {
      scale: scale,
      backgroundColor: background,
      useCORS: true,
      logging: false,
      windowWidth: target.scrollWidth,
      windowHeight: target.scrollHeight,
    })
      .then((canvas) => {
        const cuts = computeCuts(canvas.height / scale, contentH, boxes, forced);
        vscode.postMessage({ type: 'result', pages: sliceIntoPages(canvas, cuts) });
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
  Promise.all([document.fonts ? document.fonts.ready : Promise.resolve(), ...imgPromises])
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

export async function generatePdfFromPages(
  pages: string[],
  pageWidthCss: number,
  pageHeightCss: number,
  options: { password?: string }
): Promise<Buffer> {
  const orientation = pageHeightCss >= pageWidthCss ? 'portrait' : 'landscape';
  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [pageWidthCss, pageHeightCss],
    hotfixes: ['px_scaling'],
    compress: true,
    // jsPDF only offers 40-bit RC4. Permissions mirror secure_pdf_with_pikepdf in
    // nb_convert.py (annotations/forms only; no print, copy or edit). The owner
    // password is random so those limits hold for anyone who has the user password.
    encryption: options.password
      ? {
          userPassword: options.password,
          ownerPassword: randomBytes(16).toString('hex'),
          userPermissions: ['annot-forms'],
        }
      : undefined,
  });
  // Each page image already carries margins, paper color, header and footer.
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) {
      pdf.addPage([pageWidthCss, pageHeightCss], orientation);
    }
    pdf.addImage(pages[i], 'PNG', 0, 0, pageWidthCss, pageHeightCss, undefined, 'FAST');
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
