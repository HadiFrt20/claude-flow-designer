#!/usr/bin/env node
// Tiny CLI so saved graphs can be gated in CI. Usage:
//   clauflow validate <file.clauflow.json>   → exit 1 if the export gate blocks
// (errors always block; unacked warnings block; meta.ackedWarnings are honoured).
import { readFileSync } from 'node:fs';
import { safeParseGraph } from './schema/graph.js';
import { validateGraph, exportGate } from './validate.js';
import type { Diagnostic } from './diagnostics.js';

const USAGE = 'Usage: clauflow validate <file.clauflow.json>';

function formatDiag(d: Diagnostic): string {
  const where = d.nodeId ? ` [node ${d.nodeId}${d.field ? `.${d.field}` : ''}]` : '';
  return `  ${d.severity.toUpperCase().padEnd(5)} ${d.ruleId}${where}: ${d.message}`;
}

function validateCommand(file: string | undefined): number {
  if (!file) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    process.stderr.write(`clauflow: cannot read ${file}\n`);
    return 2;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`clauflow: ${file} is not valid JSON: ${(err as Error).message}\n`);
    return 2;
  }

  const parsed = safeParseGraph(json);
  if (!parsed.success) {
    process.stderr.write(`clauflow: ${file} is not a valid WorkflowGraph:\n`);
    for (const issue of parsed.error.issues) {
      process.stderr.write(`  ${issue.path.join('.') || '<root>'}: ${issue.message}\n`);
    }
    return 2;
  }

  const graph = parsed.data;
  const diags = validateGraph(graph);
  const acked = graph.meta.ackedWarnings ?? [];
  const { ok, blocking } = exportGate(diags, acked);

  // Print every diagnostic, blocking or not, so CI logs are actionable.
  if (diags.length > 0) {
    process.stdout.write(`clauflow: ${diags.length} diagnostic(s) for ${file}:\n`);
    for (const d of diags) process.stdout.write(`${formatDiag(d)}\n`);
  } else {
    process.stdout.write(`clauflow: ${file} — no diagnostics.\n`);
  }

  if (!ok) {
    process.stderr.write(
      `clauflow: export gate FAILED — ${blocking.length} blocking diagnostic(s).\n`,
    );
    return 1;
  }
  process.stdout.write('clauflow: export gate passed.\n');
  return 0;
}

export function run(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  switch (command) {
    case 'validate':
      return validateCommand(rest[0]);
    case undefined:
    case '--help':
    case '-h':
      process.stdout.write(`${USAGE}\n`);
      return command === undefined ? 2 : 0;
    default:
      process.stderr.write(`clauflow: unknown command "${command}"\n${USAGE}\n`);
      return 2;
  }
}

// Execute only when invoked directly (not when imported by tests).
// import.meta.url vs argv[1] comparison, robust to symlinks in node_modules/.bin.
const invokedPath = process.argv[1] ?? '';
if (import.meta.url === `file://${invokedPath}` || invokedPath.endsWith('cli.js')) {
  process.exit(run(process.argv.slice(2)));
}
