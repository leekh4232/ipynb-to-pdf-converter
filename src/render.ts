import { marked } from 'marked';
import hljs from 'highlight.js';
import {
  Cell,
  CellOutput,
  CodeCell,
  MarkdownCell,
  MimeBundle,
  Notebook,
  RawCell,
  joinSource,
} from './notebook';

marked.setOptions({
  gfm: true,
  breaks: false,
});

// eslint-disable-next-line no-control-regex
const ANSI_SGR = /\x1b\[([0-9;]*)m/g;

// ansi2html's inline palette, which nb_convert.py uses for coloured outputs.
const ANSI_COLORS = ['#000316', '#aa0000', '#00aa00', '#aa5500', '#0000aa', '#E850A8', '#00aaaa', '#F5F1DE'];
const ANSI_BRIGHT = ['#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff'];

const RICH_MIME = ['image/png', 'image/jpeg', 'image/svg+xml', 'text/html', 'text/markdown'];

export function renderNotebook(nb: Notebook): string {
  const language =
    nb.metadata?.language_info?.name ??
    nb.metadata?.kernelspec?.language ??
    'python';

  const cellsHtml = nb.cells.map((cell) => renderCell(cell, language)).join('\n');
  return `<div class="jp-Notebook">\n${cellsHtml}\n</div>`;
}

// Renders a standalone Markdown document, reusing the same notebook chrome so it
// flows through the identical capture/theme pipeline as a .ipynb file.
export function renderMarkdown(source: string): string {
  const cell = markdownCellHtml(marked.parse(source) as string);
  return `<div class="jp-Notebook">\n${cell}\n</div>`;
}

function markdownCellHtml(html: string): string {
  return `<div class="jp-Cell jp-MarkdownCell"><div class="jp-Cell-inputWrapper"><div class="markdown-body">${html}</div></div></div>`;
}

function renderCell(cell: Cell, language: string): string {
  switch (cell.cell_type) {
    case 'markdown':
      return renderMarkdownCell(cell);
    case 'code':
      return renderCodeCell(cell, language);
    case 'raw':
      return renderRawCell(cell);
    default:
      return '';
  }
}

function renderMarkdownCell(cell: MarkdownCell): string {
  return markdownCellHtml(marked.parse(joinSource(cell.source)) as string);
}

function renderRawCell(cell: RawCell): string {
  return `<div class="jp-Cell jp-RawCell"><pre class="jp-RenderedText">${escapeHtml(joinSource(cell.source))}</pre></div>`;
}

function renderCodeCell(cell: CodeCell, language: string): string {
  const source = joinSource(cell.source).replace(/\n$/, '');
  const highlighted = highlightCode(source, language);
  const lineCount = source.split('\n').length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');

  const outputs = renderOutputs(cell.outputs ?? []);
  const outputsBlock = outputs
    ? `<div class="jp-Cell-outputWrapper">${outputs}</div>`
    : '';

  return `<div class="jp-Cell jp-CodeCell">
  <div class="jp-Cell-inputWrapper">
    <div class="jp-InputArea-editor">
      <pre class="jp-LineNumbers">${lineNumbers}</pre>
      <pre class="hljs"><code>${highlighted}</code></pre>
    </div>
  </div>
  ${outputsBlock}
</div>`;
}

// nb_convert.py goes through `nbconvert --to markdown`, where every text output
// (stream, text/plain result, error traceback) becomes an indented block and
// consecutive blocks fuse into one <pre> with a blank line between them. Mirror
// that grouping so a cell gets one box per run of text outputs.
function renderOutputs(outputs: CellOutput[]): string {
  const blocks: string[] = [];
  let run: { text: string; cls: string }[] = [];
  const flush = () => {
    if (run.length === 0) {
      return;
    }
    const text = run.map((o) => o.text).join('\n\n').replace(/\n+$/, '');
    const cls = run.find((o) => o.cls === 'jp-OutputArea-error')?.cls ?? run.find((o) => o.cls)?.cls ?? '';
    blocks.push(
      `<div class="jp-OutputArea${cls ? ` ${cls}` : ''}"><pre class="jp-RenderedText">${ansiToHtml(text)}</pre></div>`
    );
    run = [];
  };
  for (const output of outputs) {
    const text = textOutput(output);
    if (text) {
      run.push(text);
      continue;
    }
    flush();
    blocks.push(renderRich(output));
  }
  flush();
  return blocks.filter(Boolean).join('\n');
}

// Plain text of an output that has no richer representation, else undefined.
function textOutput(output: CellOutput): { text: string; cls: string } | undefined {
  switch (output.output_type) {
    case 'stream':
      return { text: joinSource(output.text), cls: output.name === 'stderr' ? 'jp-OutputArea-stderr' : '' };
    case 'error':
      return { text: (output.traceback ?? []).join('\n'), cls: 'jp-OutputArea-error' };
    case 'display_data':
    case 'execute_result': {
      const data = output.data;
      if (RICH_MIME.some((mime) => data[mime]) || !data['text/plain']) {
        return undefined;
      }
      return { text: joinSource(data['text/plain'] as string | string[]), cls: '' };
    }
    default:
      return undefined;
  }
}

function renderRich(output: CellOutput): string {
  if (output.output_type !== 'display_data' && output.output_type !== 'execute_result') {
    return '';
  }
  return renderMime(output.data);
}

function renderMime(data: MimeBundle): string {
  // Priority order — pick the richest representation Jupyter would show.
  if (data['image/png']) {
    const src = `data:image/png;base64,${(data['image/png'] as string).trim()}`;
    return `<div class="jp-OutputArea jp-OutputArea-image"><img class="jp-OutputImage" src="${src}" /></div>`;
  }
  if (data['image/jpeg']) {
    const src = `data:image/jpeg;base64,${(data['image/jpeg'] as string).trim()}`;
    return `<div class="jp-OutputArea jp-OutputArea-image"><img class="jp-OutputImage" src="${src}" /></div>`;
  }
  if (data['image/svg+xml']) {
    const svg = joinSource(data['image/svg+xml'] as string | string[]);
    return `<div class="jp-OutputArea jp-OutputArea-image"><div class="jp-OutputImage">${svg}</div></div>`;
  }
  if (data['text/html']) {
    const html = joinSource(data['text/html'] as string | string[]);
    return `<div class="jp-OutputArea jp-OutputArea-html"><div class="jp-RenderedHTML">${html}</div></div>`;
  }
  if (data['text/markdown']) {
    const html = marked.parse(joinSource(data['text/markdown'] as string | string[])) as string;
    return `<div class="jp-OutputArea jp-OutputArea-html"><div class="markdown-body">${html}</div></div>`;
  }
  return '';
}

function highlightCode(source: string, language: string): string {
  if (hljs.getLanguage(language)) {
    try {
      return hljs.highlight(source, { language, ignoreIllegals: true }).value;
    } catch {
      // fall through to escape-only
    }
  }
  return escapeHtml(source);
}

// ANSI SGR escapes → inline-styled spans (bold and the 16 foreground colours),
// the subset Jupyter outputs use. Unknown codes are dropped.
function ansiToHtml(text: string): string {
  let html = '';
  let last = 0;
  let open = false;
  let bold = false;
  let color: string | undefined;
  for (const match of text.matchAll(ANSI_SGR)) {
    html += escapeHtml(text.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;
    for (const code of (match[1] || '0').split(';').map(Number)) {
      if (code === 0) {
        bold = false;
        color = undefined;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        color = undefined;
      } else if (code >= 30 && code <= 37) {
        color = ANSI_COLORS[code - 30];
      } else if (code >= 90 && code <= 97) {
        color = ANSI_BRIGHT[code - 90];
      }
    }
    if (open) {
      html += '</span>';
      open = false;
    }
    const style = [bold ? 'font-weight: bold' : '', color ? `color: ${color}` : ''].filter(Boolean).join('; ');
    if (style) {
      html += `<span style="${style}">`;
      open = true;
    }
  }
  html += escapeHtml(text.slice(last));
  return open ? `${html}</span>` : html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
