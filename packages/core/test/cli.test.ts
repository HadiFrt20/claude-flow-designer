import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { serializeGraph } from '../src/schema/graph.js';
import { validateGraph } from '../src/validate.js';
import { fixtures } from './fixtures.js';

let dir: string;
const write = (name: string, content: string) => {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'clauflow-cli-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('clauflow validate', () => {
  it('exits 2 with no file argument', () => {
    expect(run(['validate'])).toBe(2);
  });

  it('exits 2 on a missing file', () => {
    expect(run(['validate', join(dir, 'nope.json')])).toBe(2);
  });

  it('exits 2 on malformed JSON', () => {
    const p = write('bad.json', '{ not json');
    expect(run(['validate', p])).toBe(2);
  });

  it('exits 2 on a JSON file that is not a WorkflowGraph', () => {
    const p = write('wrong.json', JSON.stringify({ hello: 'world' }));
    expect(run(['validate', p])).toBe(2);
  });

  it('exits 1 on a graph with a blocking error (CF602)', () => {
    const p = write('cf602.clauflow.json', serializeGraph(fixtures.CF602.hit));
    expect(run(['validate', p])).toBe(1);
  });

  it('exits 0 after applying the CF602 quick fix to the failing graph', () => {
    // Acceptance criterion: fail a CF602 graph (invalid /command slug), then pass
    // it after applying the rule's own quick fix (derive name from graph.slug).
    const failing = fixtures.CF602.hit;
    const before = write('cf602.clauflow.json', serializeGraph(failing));
    expect(run(['validate', before])).toBe(1);

    const diag = validateGraph(failing).find((d) => d.ruleId === 'CF602' && d.quickFix);
    expect(diag?.quickFix).toBeDefined();
    const fixed = diag!.quickFix!.apply(failing);
    const after = write('cf602-fixed.clauflow.json', serializeGraph(fixed));
    expect(run(['validate', after])).toBe(0);
  });

  it('exits 0 when only warnings remain and they are acked', () => {
    const warnGraph = { ...fixtures.CF008.hit, meta: { ...fixtures.CF008.hit.meta, ackedWarnings: ['CF008' as const] } };
    const p = write('acked.clauflow.json', serializeGraph(warnGraph));
    expect(run(['validate', p])).toBe(0);
  });

  it('exits 1 when an unacked warning blocks', () => {
    const p = write('unacked.clauflow.json', serializeGraph(fixtures.CF008.hit));
    expect(run(['validate', p])).toBe(1);
  });

  it('--help exits 0', () => {
    expect(run(['--help'])).toBe(0);
  });
});
