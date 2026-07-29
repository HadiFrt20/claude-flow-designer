// VS Code extension host. Registers the custom editor for *.clauflow.json (canvas
// webview), the new/import/export/run commands, and the "Claude Workflows" tree
// view. The extension host owns ALL filesystem access; the webview talks to it
// only through the typed postMessage protocol (src/protocol.ts). FS logic is the
// pure host-fs.ts module — this file is the thin vscode-API adapter over it.
import * as vscode from 'vscode';
import {
  generate,
  parseProject,
  safeParseGraph,
  serializeGraph,
  emptyGraph,
  ExportGateError,
} from '@clauflow/core';
import type { GeneratedFile, WorkflowGraph } from '@clauflow/core';
import { isWebviewToHost, type HostToWebview } from './protocol.js';
import {
  planExport,
  changesToWrite,
  collectWorkspaceAssets,
  detectAssets,
  type FsAccess,
  type FileChange,
} from './host-fs.js';

export function activate(ctx: vscode.ExtensionContext): void {
  const assets = new AssetsTreeProvider();
  ctx.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'clauflow.editor',
      new ClauflowEditorProvider(ctx),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false },
    ),
    vscode.workspace.registerTextDocumentContentProvider('clauflow-preview', previewContentProvider),
    vscode.commands.registerCommand('claudeFlow.new', () => newWorkflow()),
    vscode.commands.registerCommand('claudeFlow.import', () => importToNewGraph()),
    vscode.commands.registerCommand('claudeFlow.export', () => exportActiveGraph()),
    vscode.commands.registerCommand('claudeFlow.run', () => runActiveGraph()),
    vscode.window.registerTreeDataProvider('claudeFlow.assets', assets),
    vscode.commands.registerCommand('claudeFlow.refreshAssets', () => assets.refresh()),
  );
}

export function deactivate(): void {}

// Serves proposed generated content for the native diff view. The content is
// URI-encoded in the query so the provider is stateless.
const previewContentProvider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return decodeURIComponent(uri.query);
  },
};

function previewUri(path: string, content: string): vscode.Uri {
  return vscode.Uri.parse(`clauflow-preview:${path}`).with({ query: encodeURIComponent(content) });
}

// --- workspace fs adapter (implements the pure FsAccess surface) ------------
function workspaceFs(): FsAccess | null {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return null;
  const abs = (rel: string) => vscode.Uri.joinPath(root, rel);
  return {
    async read(rel) {
      try {
        return Buffer.from(await vscode.workspace.fs.readFile(abs(rel))).toString('utf8');
      } catch {
        return null;
      }
    },
    async write(rel, content) {
      const uri = abs(rel);
      const dir = vscode.Uri.joinPath(uri, '..');
      await vscode.workspace.fs.createDirectory(dir);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    },
    async list(rel) {
      const dirUri = rel === '.' ? root : abs(rel);
      return listRecursive(dirUri, root);
    },
  };
}

async function listRecursive(dir: vscode.Uri, root: vscode.Uri): Promise<string[]> {
  const out: string[] = [];
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return out;
  }
  for (const [name, kind] of entries) {
    const child = vscode.Uri.joinPath(dir, name);
    const rel = child.path.slice(root.path.length + 1);
    if (kind === vscode.FileType.Directory) {
      if (name === 'node_modules' || name === '.git') continue;
      out.push(...(await listRecursive(child, root)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

// --- custom editor ----------------------------------------------------------
class ClauflowEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private ctx: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'dist')],
    };
    panel.webview.html = webviewHtml(panel.webview, this.ctx.extensionUri);

    const graphOf = (): WorkflowGraph => {
      const parsed = safeParseGraph(safeJson(document.getText()));
      return parsed.success ? parsed.data : emptyGraph('Untitled', 'untitled');
    };

    const postToWebview = (msg: HostToWebview) => void panel.webview.postMessage(msg);

    // Text the host itself last wrote to the document. Used to suppress the
    // change-event echo of our own writes so the webview only reloads (and
    // rebuilds its store) on GENUINELY external edits (git checkout, manual edit).
    let selfWritten: string | null = null;

    const sub = panel.webview.onDidReceiveMessage(async (raw) => {
      if (!isWebviewToHost(raw)) return;
      switch (raw.type) {
        case 'ready':
          postToWebview({ type: 'load', graph: graphOf() });
          break;
        case 'edit':
          selfWritten = await applyEdit(document, raw.graph);
          break;
        case 'export':
          if (!(await requireTrust('export to .claude/'))) {
            postToWebview({ type: 'error', message: 'Workspace is not trusted.' });
            break;
          }
          await doExport(raw.files, postToWebview);
          break;
        case 'import': {
          if (!(await requireTrust('import from .claude/'))) {
            postToWebview({ type: 'error', message: 'Workspace is not trusted.' });
            break;
          }
          const g = await readWorkspaceGraph();
          postToWebview(g ? { type: 'imported', graph: g } : { type: 'error', message: 'No .claude assets found.' });
          break;
        }
        case 'notify':
          notify(raw.level, raw.message);
          break;
      }
    });

    // Reflect EXTERNAL document edits (git checkout, manual edit) back into the
    // webview. Skip the echo of our own applyEdit writes — otherwise every canvas
    // edit would round-trip a 'load' and rebuild the store, wiping undo/redo and
    // the current selection.
    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      const text = e.document.getText();
      if (text === selfWritten) return; // our own write — already reflected
      postToWebview({ type: 'load', graph: graphOf() });
    });

    panel.onDidDispose(() => {
      sub.dispose();
      changeSub.dispose();
    });
  }
}

/**
 * Write the graph back into the document (round-trips through canonical JSON).
 * Returns the text now in the document so the caller can recognise (and ignore)
 * the resulting change event as its own.
 */
async function applyEdit(document: vscode.TextDocument, graph: WorkflowGraph): Promise<string> {
  const next = serializeGraph(graph);
  if (next === document.getText()) return next;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), next);
  await vscode.workspace.applyEdit(edit);
  return next;
}

// --- commands ---------------------------------------------------------------

/**
 * Gate a side-effecting action (write files / open a terminal) on Workspace
 * Trust. In Restricted Mode we can't write to disk or run commands; instead of
 * silently doing nothing, offer to manage trust. Returns true when trusted.
 */
async function requireTrust(action: string): Promise<boolean> {
  if (vscode.workspace.isTrusted) return true;
  const choice = await vscode.window.showWarningMessage(
    `Trust this workspace to ${action}.`,
    { modal: true, detail: 'Claude Flow writes to .claude/ and can open a terminal, which need a trusted workspace. Editing the canvas works without trust.' },
    'Manage Trust',
  );
  if (choice === 'Manage Trust') await vscode.commands.executeCommand('workbench.trust.manage');
  return false;
}

/**
 * The first workspace folder, or — if none is open — a modal offering to open one
 * (so commands guide the user instead of dead-ending on "Open a folder first").
 * Returns null if the user dismisses the prompt.
 */
async function requireWorkspaceRoot(action: string): Promise<vscode.Uri | null> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (root) return root;
  const choice = await vscode.window.showInformationMessage(
    `Open a folder to ${action}.`,
    { modal: true, detail: 'Claude Flow writes workflow files into the open folder.' },
    'Open Folder…',
  );
  if (choice === 'Open Folder…') await vscode.commands.executeCommand('vscode.openFolder');
  return null;
}

async function newWorkflow(): Promise<void> {
  if (!(await requireTrust('create a workflow'))) return;
  const root = await requireWorkspaceRoot('create a workflow');
  if (!root) return;
  const uri = await uniqueUri(root, 'workflow', '.clauflow.json');
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeGraph(emptyGraph('Untitled workflow', 'untitled')), 'utf8'));
  await vscode.commands.executeCommand('vscode.openWith', uri, 'clauflow.editor');
}

/** A non-colliding <base><n?><ext> uri in dir (workflow.clauflow.json, workflow-2…). */
async function uniqueUri(dir: vscode.Uri, base: string, ext: string): Promise<vscode.Uri> {
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}${ext}` : `${base}-${i}${ext}`;
    const uri = vscode.Uri.joinPath(dir, name);
    try {
      await vscode.workspace.fs.stat(uri); // exists → try next
    } catch {
      return uri; // not found → use it
    }
  }
}

async function importToNewGraph(): Promise<void> {
  if (!(await requireTrust('import a workflow'))) return;
  const root = await requireWorkspaceRoot('import a workflow');
  if (!root) return;
  const g = await readWorkspaceGraph();
  if (!g) {
    notify('warn', 'No .claude assets found in this workspace.');
    return;
  }
  const uri = await uniqueUri(root, g.meta.slug || 'imported', '.clauflow.json');
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeGraph(g), 'utf8'));
  await vscode.commands.executeCommand('vscode.openWith', uri, 'clauflow.editor');
}

async function exportActiveGraph(): Promise<void> {
  if (!(await requireTrust('export to .claude/'))) return;
  const graph = await activeGraph();
  if (!graph) return;
  let files: GeneratedFile[];
  try {
    files = generate(graph);
  } catch (err) {
    notify('error', err instanceof ExportGateError ? `Export blocked: ${err.message}` : String(err));
    return;
  }
  await doExport(files, () => {});
}

async function runActiveGraph(): Promise<void> {
  if (!(await requireTrust('run the workflow'))) return;
  const graph = await activeGraph();
  if (!graph) return;
  // Generate first: this runs the export gate, so an invalid workflow surfaces
  // its blocking diagnostics here rather than failing silently at invocation.
  let files: GeneratedFile[];
  try {
    files = generate(graph);
  } catch (err) {
    notify('error', String(err));
    return;
  }
  // Write the emitted .claude/workflows/<slug>.js, then invoke it as /<name> in
  // a Claude Code terminal (dynamic workflows run via their slash command).
  const fs = workspaceFs();
  if (!fs) {
    notify('error', 'Open a folder to run the workflow into.');
    return;
  }
  for (const f of files) await fs.write(f.path, f.content);
  const name = workflowName(graph);
  runInTerminal(`claude "/${name}"`);
}

/** The `/command` name of a workflow: its meta.name if present, else the slug. */
function workflowName(graph: WorkflowGraph): string {
  const meta = graph.nodes.find((n) => n.kind === 'workflow.meta');
  return meta?.kind === 'workflow.meta' ? meta.data.name : graph.meta.slug;
}

// --- shared host operations -------------------------------------------------
async function doExport(files: GeneratedFile[], reply: (m: HostToWebview) => void): Promise<void> {
  const fs = workspaceFs();
  if (!fs) {
    notify('error', 'Open a folder to export into.');
    reply({ type: 'error', message: 'No workspace folder.' });
    return;
  }
  let plan;
  try {
    plan = await planExport(files, fs);
  } catch (err) {
    notify('error', String(err));
    reply({ type: 'error', message: String(err) });
    return;
  }
  const toWrite = changesToWrite(plan);
  if (toWrite.length === 0) {
    notify('info', 'Nothing to write — .claude is already up to date.');
    reply({ type: 'exported', written: [], skipped: plan.map((c) => c.path) });
    return;
  }
  const modified = toWrite.filter((c) => c.kind === 'modify');
  const detail = toWrite.map((c) => `${c.kind === 'create' ? '＋' : '～'} ${c.path}`).join('\n');
  // Confirm loop: user can open a native per-file diff for modified files before
  // deciding. "Write" commits; anything else cancels.
  for (;;) {
    const actions = modified.length ? (['Write', 'Show diff'] as const) : (['Write'] as const);
    const choice = await vscode.window.showInformationMessage(
      `Write ${toWrite.length} file(s) to .claude?`,
      { modal: true, detail },
      ...actions,
    );
    if (choice === 'Show diff') {
      await showExportDiffs(modified);
      continue;
    }
    if (choice !== 'Write') {
      reply({ type: 'exported', written: [], skipped: files.map((f) => f.path) });
      return;
    }
    break;
  }
  const written: string[] = [];
  for (const c of toWrite) {
    await fs.write(c.path, c.content);
    written.push(c.path);
  }
  notify('info', `Wrote ${written.length} file(s) to .claude.`);
  reply({ type: 'exported', written, skipped: plan.filter((c) => c.kind === 'unchanged').map((c) => c.path) });
}

/** Open a native diff (current on-disk ⇢ proposed) for each modified file. */
async function showExportDiffs(modified: FileChange[]): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) return;
  for (const c of modified) {
    if (c.kind !== 'modify') continue;
    const left = vscode.Uri.joinPath(root, c.path); // current file on disk
    const right = previewUri(c.path, c.content); // proposed content (virtual)
    await vscode.commands.executeCommand('vscode.diff', left, right, `${c.path} (current ⇢ proposed)`);
  }
}

async function readWorkspaceGraph(): Promise<WorkflowGraph | null> {
  const fs = workspaceFs();
  if (!fs) return null;
  const files = await collectWorkspaceAssets(fs);
  return files.length ? parseProject(files) : null;
}

async function activeGraph(): Promise<WorkflowGraph | null> {
  const doc = vscode.window.activeTextEditor?.document
    ?? vscode.workspace.textDocuments.find((d) => d.fileName.endsWith('.clauflow.json'));
  if (!doc) {
    notify('warn', 'Open a .clauflow.json workflow first.');
    return null;
  }
  const parsed = safeParseGraph(safeJson(doc.getText()));
  if (!parsed.success) {
    notify('error', 'Active document is not a valid workflow graph.');
    return null;
  }
  return parsed.data;
}

function runInTerminal(command: string): void {
  const term = vscode.window.createTerminal('Claude Flow');
  term.show();
  term.sendText(command, false);
}

function notify(level: 'info' | 'warn' | 'error', message: string): void {
  if (level === 'error') void vscode.window.showErrorMessage(message);
  else if (level === 'warn') void vscode.window.showWarningMessage(message);
  else void vscode.window.showInformationMessage(message);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// --- tree view --------------------------------------------------------------
class AssetsTreeProvider implements vscode.TreeDataProvider<AssetItem> {
  private emitter = new vscode.EventEmitter<AssetItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(item: AssetItem): vscode.TreeItem {
    return item;
  }

  async getChildren(item?: AssetItem): Promise<AssetItem[]> {
    const fs = workspaceFs();
    if (!fs) return [];
    const detected = detectAssets(await fs.list('.'));
    if (!item) {
      return [
        group('Workflows', detected.workflows),
        group('Graphs', detected.graphs),
      ].filter((g): g is AssetItem => g !== null);
    }
    return (item.children ?? []).map((p) => {
      const leaf = new AssetItem(p, vscode.TreeItemCollapsibleState.None);
      const uri = fileUri(p);
      // Open the file: a .clauflow.json sidecar opens in the registered canvas
      // editor; a .js workflow opens as text (it is one-way output).
      if (uri) leaf.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
      leaf.resourceUri = uri;
      return leaf;
    });
  }
}

function group(label: string, paths: string[]): AssetItem | null {
  if (paths.length === 0) return null;
  const item = new AssetItem(`${label} (${paths.length})`, vscode.TreeItemCollapsibleState.Collapsed);
  item.children = paths;
  return item;
}

function fileUri(rel: string): vscode.Uri | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  return root ? vscode.Uri.joinPath(root, rel) : undefined;
}

class AssetItem extends vscode.TreeItem {
  children?: string[];
  constructor(label: string, state: vscode.TreeItemCollapsibleState) {
    super(label, state);
  }
}

// --- webview html (strict CSP + nonce) --------------------------------------
function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'));
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${style}" />
    <title>Claude Flow Designer</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
}

function makeNonce(): string {
  // Cryptographically strong, unguessable CSP nonce (matches the official VS Code
  // webview sample) — Math.random() is not suitable for a security token.
  return crypto.randomUUID().replace(/-/g, '');
}
