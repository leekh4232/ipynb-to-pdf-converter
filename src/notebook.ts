export type MultilineString = string | string[];

export interface Notebook {
  cells: Cell[];
  metadata?: NotebookMetadata;
  nbformat?: number;
  nbformat_minor?: number;
}

export interface NotebookMetadata {
  kernelspec?: { name?: string; display_name?: string; language?: string };
  language_info?: { name?: string; pygments_lexer?: string };
}

export type Cell = MarkdownCell | CodeCell | RawCell;

export interface MarkdownCell {
  cell_type: 'markdown';
  source: MultilineString;
  metadata?: Record<string, unknown>;
  // Images pasted into the cell: ![x](attachment:name) -> attachments[name] = { 'image/png': base64 }
  attachments?: Record<string, MimeBundle>;
}

export interface RawCell {
  cell_type: 'raw';
  source: MultilineString;
  metadata?: Record<string, unknown>;
}

export interface CodeCell {
  cell_type: 'code';
  source: MultilineString;
  metadata?: Record<string, unknown>;
  execution_count: number | null;
  outputs: CellOutput[];
}

export type CellOutput =
  | StreamOutput
  | DisplayDataOutput
  | ExecuteResultOutput
  | ErrorOutput;

export interface StreamOutput {
  output_type: 'stream';
  name: 'stdout' | 'stderr';
  text: MultilineString;
}

export interface DisplayDataOutput {
  output_type: 'display_data';
  data: MimeBundle;
  metadata?: Record<string, unknown>;
}

export interface ExecuteResultOutput {
  output_type: 'execute_result';
  data: MimeBundle;
  metadata?: Record<string, unknown>;
  execution_count: number | null;
}

export interface ErrorOutput {
  output_type: 'error';
  ename: string;
  evalue: string;
  traceback: string[];
}

export type MimeBundle = {
  'text/plain'?: MultilineString;
  'text/html'?: MultilineString;
  'text/markdown'?: MultilineString;
  'image/png'?: string;
  'image/jpeg'?: string;
  'image/svg+xml'?: MultilineString;
  'application/json'?: unknown;
} & Record<string, unknown>;

export function joinSource(source: MultilineString): string {
  return Array.isArray(source) ? source.join('') : source;
}
