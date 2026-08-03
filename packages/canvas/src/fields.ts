// Data-driven property-panel field descriptors. One table per node kind lists
// EVERY data field (DoD requirement), grouped Basic / Advanced (DESIGN-BRIEF).
// The React PropertyPanel renders these generically, so adding a schema field =
// adding a row here (no bespoke component). Field keys match the zod data schema.
//
// M6: the graph models a Claude Code dynamic workflow (.claude/workflows/<slug>.js).
import type { NodeKind } from '@clauflow/core';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'model' // model picker (known aliases + free text)
  | 'resultRef' // reference to a producing node id (or 'args')
  | 'fieldPath' // dotted identifier path into a result
  | 'transform' // return transform: none | filterBoolean | flatten
  | 'json' // arbitrary object literal (e.g. an agent schema)
  | 'code' // verbatim JS (raw node) — monospace, no parsing
  | 'stringList'; // newline-separated strings → string[] (raw.produces)

export interface FieldDescriptor {
  /** Data key (dotted allowed for nested, but M6 fields are flat). */
  key: string;
  label: string;
  type: FieldType;
  group: 'Basic' | 'Advanced';
  /** Human help — copy names things by what users control (DESIGN-BRIEF). */
  hint?: string;
  options?: readonly string[]; // for select / transform
  placeholder?: string;
}

const TRANSFORMS = ['none', 'filterBoolean', 'flatten'] as const;

// A per-stage model picker, reused by agent / pipeline / loop.
const MODEL: FieldDescriptor = { key: 'model', label: 'Model', type: 'model', group: 'Advanced', hint: 'Alias (sonnet, opus) or full id. Blank = inherit the workflow default.' };

export const FIELD_DESCRIPTORS: Record<NodeKind, FieldDescriptor[]> = {
  'workflow.meta': [
    { key: 'name', label: 'Command name', type: 'text', group: 'Basic', hint: 'Becomes /<name>; the file is <slug>.js.' },
    { key: 'description', label: 'Description', type: 'textarea', group: 'Basic', hint: 'export const meta.description — shown when the workflow is listed.' },
    { key: 'argsHint', label: 'Args hint', type: 'text', group: 'Advanced', placeholder: 'an array of PR numbers', hint: 'Doc-only: what `args` is at invocation.' },
  ],
  phase: [
    { key: 'title', label: 'Phase title', type: 'text', group: 'Basic', hint: 'Names a block of work; emits phase("…"). Nodes placed inside are its members.' },
  ],
  agent: [
    { key: 'prompt', label: 'Prompt', type: 'textarea', group: 'Basic', hint: 'Refs: {{args}}, {{nodeId}}, {{nodeId.field}}.' },
    { key: 'promptExpr', label: 'Prompt (JS expression)', type: 'code', group: 'Basic', hint: 'A programmatic prompt (e.g. researchPrompt(d)) — imported verbatim, emitted as-is.' },
    { key: 'label', label: 'Agent label', type: 'text', group: 'Basic', hint: 'opts.label — shown in the runtime feed.' },
    { key: 'schema', label: 'Output schema', type: 'json', group: 'Advanced', hint: 'JSON Schema for structured output (opts.schema).' },
    MODEL,
  ],
  pipeline: [
    { key: 'source', label: 'Items source', type: 'resultRef', group: 'Basic', hint: 'Producing node id, or "args" to fan out over the input.' },
    { key: 'sourceField', label: 'List field', type: 'fieldPath', group: 'Basic', hint: 'Which array field of the source result; omit if the source IS the array.' },
    { key: 'itemPrompt', label: 'Per-item prompt', type: 'textarea', group: 'Basic', hint: 'Use {{item}} for the current element; upstream refs allowed.' },
    { key: 'itemPromptExpr', label: 'Per-item prompt (JS expression)', type: 'code', group: 'Basic', hint: 'A programmatic per-item prompt — imported verbatim, emitted as-is.' },
    { key: 'itemLabel', label: 'Per-item label', type: 'text', group: 'Advanced', placeholder: '{{item}}', hint: 'opts.label per fan-out agent.' },
    { key: 'itemSchema', label: 'Per-item schema', type: 'json', group: 'Advanced', hint: 'JSON Schema for each item agent.' },
    MODEL,
  ],
  parallel: [
    { key: 'source', label: 'Items source', type: 'resultRef', group: 'Basic', hint: 'Producing node id, "args", or an array binding to fan out over concurrently.' },
    { key: 'sourceField', label: 'List field', type: 'fieldPath', group: 'Basic', hint: 'Which array field of the source; omit if the source IS the array.' },
    { key: 'itemVar', label: 'Item variable', type: 'text', group: 'Basic', placeholder: 'item', hint: 'The .map parameter name; use {{<it>}} in the prompt/label.' },
    { key: 'itemPrompt', label: 'Per-item prompt', type: 'textarea', group: 'Basic', hint: 'Use {{<itemVar>}} for the current element; upstream refs allowed.' },
    { key: 'itemPromptExpr', label: 'Per-item prompt (JS expression)', type: 'code', group: 'Basic', hint: 'A programmatic per-item prompt — imported verbatim, emitted as-is.' },
    { key: 'itemLabel', label: 'Per-item label', type: 'text', group: 'Advanced', hint: 'opts.label per concurrent agent.' },
    { key: 'itemSchema', label: 'Per-item schema', type: 'json', group: 'Advanced' },
    MODEL,
  ],
  fanout: [
    { key: 'mode', label: 'Concurrency call', type: 'select', group: 'Basic', options: ['parallel', 'promiseAll'], hint: 'parallel([…]) or Promise.all([…]) — both run every lane concurrently.' },
    { key: 'branches', label: 'Branches (lanes)', type: 'json', group: 'Basic', hint: 'One lane per element. Each: {kind:"thunk", prompt} or {kind:"map", source, itemVar, itemPrompt}. Edited as JSON.' },
    { key: 'bindingPattern', label: 'Binding pattern', type: 'text', group: 'Advanced', hint: 'A destructuring LHS (e.g. [a, b]) preserved verbatim from import; blank = a single derived name.' },
  ],
  branch: [
    { key: 'condExpr', label: 'Condition (JS expression)', type: 'code', group: 'Basic', hint: 'A verbatim imported if-condition (e.g. failing.length) — emitted as-is. Leave blank to use the structured fields below.' },
    { key: 'source', label: 'Test result of', type: 'resultRef', group: 'Basic', hint: 'Node id whose result is tested (structured form; ignored if a JS condition is set).' },
    { key: 'field', label: 'Boolean field', type: 'fieldPath', group: 'Basic', hint: 'Boolean-ish field on that result.' },
    { key: 'negate', label: 'Negate condition', type: 'boolean', group: 'Advanced', hint: 'Take the "then" arm when the field is falsy.' },
  ],
  loopUntilCheck: [
    { key: 'checkPrompt', label: 'Check prompt', type: 'textarea', group: 'Basic', hint: 'Runs each round; should report whether the goal is met.' },
    { key: 'passField', label: 'Pass field', type: 'fieldPath', group: 'Basic', hint: 'Boolean field on the check result that ends the loop.' },
    { key: 'fixPrompt', label: 'Fix prompt', type: 'textarea', group: 'Basic', hint: 'Runs when the check fails; use {{check}} to see findings.' },
    { key: 'maxRounds', label: 'Max rounds', type: 'number', group: 'Advanced', hint: 'Loop bound (default 2).' },
    { key: 'checkSchema', label: 'Check schema', type: 'json', group: 'Advanced' },
    { key: 'checkModel', label: 'Check model', type: 'model', group: 'Advanced' },
    { key: 'fixModel', label: 'Fix model', type: 'model', group: 'Advanced' },
  ],
  'output.return': [
    { key: 'source', label: 'Return result of', type: 'resultRef', group: 'Basic', hint: 'Node id whose result is returned.' },
    { key: 'field', label: 'Field', type: 'fieldPath', group: 'Advanced', hint: 'Return source.field instead of the whole result.' },
    { key: 'transform', label: 'Transform', type: 'transform', group: 'Advanced', options: TRANSFORMS, hint: 'filterBoolean → .filter(Boolean); flatten → .flat().' },
  ],
  raw: [
    { key: 'code', label: 'Code', type: 'code', group: 'Basic', hint: 'Imported JS kept verbatim — edited as text, re-exported unchanged.' },
    { key: 'produces', label: 'Declares bindings', type: 'stringList', group: 'Advanced', hint: 'Binding names this block introduces (so downstream refs resolve). One per line.' },
  ],
};

/** Palette entries grouped as in DESIGN-BRIEF (Entry / Agents / Control). */
export interface PaletteEntry {
  kind: NodeKind;
  label: string;
}
export const PALETTE: { group: string; entries: PaletteEntry[] }[] = [
  {
    group: 'Entry',
    entries: [
      { kind: 'workflow.meta', label: 'Workflow (meta)' },
      { kind: 'phase', label: 'Phase (group)' },
    ],
  },
  {
    group: 'Agents',
    entries: [
      { kind: 'agent', label: 'Agent' },
      { kind: 'pipeline', label: 'Pipeline (fan-out)' },
      { kind: 'parallel', label: 'Parallel (concurrent)' },
      { kind: 'fanout', label: 'Fan-out (static array)' },
    ],
  },
  {
    group: 'Control',
    entries: [
      { kind: 'branch', label: 'Branch (if/else)' },
      { kind: 'loopUntilCheck', label: 'Loop until check' },
      { kind: 'output.return', label: 'Return' },
      { kind: 'raw', label: 'Raw code' },
    ],
  },
];

/** A blank data object for a freshly-created node of a kind (schema-valid defaults). */
export function defaultData(kind: NodeKind): Record<string, unknown> {
  switch (kind) {
    case 'workflow.meta':
      return { name: 'workflow', description: '' };
    case 'phase':
      return { title: 'Phase' };
    case 'agent':
      return { prompt: '' };
    case 'pipeline':
      return { source: 'args', itemPrompt: '' };
    case 'parallel':
      return { source: 'args', itemVar: 'item', itemPrompt: '' };
    case 'fanout':
      return { mode: 'parallel', branches: [{ kind: 'thunk', prompt: '' }] };
    case 'branch':
      return { source: '', field: 'ok' };
    case 'loopUntilCheck':
      return { checkPrompt: '', fixPrompt: '', passField: 'passed', maxRounds: 2 };
    case 'output.return':
      return { source: '', transform: 'none' };
    case 'raw':
      return { code: '' };
  }
}
