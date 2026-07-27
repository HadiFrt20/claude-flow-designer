import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { serializeGraph } from '../src/schema/graph.js';
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

  it('exits 1 on a graph with a blocking error (CF101)', () => {
    const p = write('cf101.clauflow.json', serializeGraph(fixtures.CF101.hit));
    expect(run(['validate', p])).toBe(1);
  });

  it('exits 0 after the CF101 quick fix is applied', () => {
    // The miss fixture is the CF101 hit with a blockable event — the fixed state.
    const p = write('cf101-fixed.clauflow.json', serializeGraph(fixtures.CF101.miss));
    expect(run(['validate', p])).toBe(0);
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
