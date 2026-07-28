import { describe, it, expect } from 'vitest';
import { parseProject } from '../src/importer.js';
import { generate } from '../src/codegen/index.js';
import { TEMPLATES } from '../src/templates.js';
import type { GeneratedFile } from '../src/schema/types.js';

// The fast path (flow.clauflow.json present) is the exact round-trip and is
// covered by codegen.test.ts. Here we exercise reconstruct(): parsing a .claude
// asset set that has NO flow.clauflow.json (importing a hand-authored project).
const file = (path: string, content: string): GeneratedFile => ({ path, content });

describe('parseProject fast path', () => {
  it('uses flow.clauflow.json verbatim when present', () => {
    const t = TEMPLATES[0]!;
    const graph = parseProject(generate(t.graph));
    expect(graph).toEqual(t.graph);
  });
});

describe('parseProject reconstruct (no flow.clauflow.json)', () => {
  it('returns null for an empty/asset-less project', () => {
    expect(parseProject([])).toBeNull();
    expect(parseProject([file('README.md', '# hi\n')])).toBeNull();
  });

  it('reconstructs a slash command from a modern SKILL.md', () => {
    const g = parseProject([
      file('.claude/skills/deploy/SKILL.md', '---\ndescription: Deploy it\nmodel: opus\n---\n\nDo the deploy.\n'),
    ])!;
    expect(g).not.toBeNull();
    const cmd = g.nodes.find((n) => n.kind === 'trigger.slashCommand')!;
    expect(cmd.kind).toBe('trigger.slashCommand');
    if (cmd.kind === 'trigger.slashCommand') {
      expect(cmd.data.name).toBe('deploy');
      expect(cmd.data.description).toBe('Deploy it');
      expect(cmd.data.model).toBe('opus');
    }
    // Body becomes a step.prompt wired from the command.
    const step = g.nodes.find((n) => n.kind === 'step.prompt');
    expect(step).toBeDefined();
    expect(g.edges).toHaveLength(1);
  });

  it('imports a legacy .claude/commands/*.md file', () => {
    const g = parseProject([file('.claude/commands/lint.md', '---\ndescription: Lint\n---\n\nRun the linter.\n')])!;
    const cmd = g.nodes.find((n) => n.kind === 'trigger.slashCommand');
    expect(cmd).toBeDefined();
    if (cmd?.kind === 'trigger.slashCommand') expect(cmd.data.name).toBe('lint');
  });

  it('preserves unknown frontmatter keys in data.extra', () => {
    const g = parseProject([
      file('.claude/skills/x/SKILL.md', '---\ndescription: d\nx-custom: kept\nweird: 42\n---\n\nbody\n'),
    ])!;
    const cmd = g.nodes.find((n) => n.kind === 'trigger.slashCommand')!;
    if (cmd.kind === 'trigger.slashCommand') {
      expect(cmd.data.extra).toEqual({ 'x-custom': 'kept', weird: 42 });
    }
  });

  it('reconstructs a subagent from an agents/*.md file (tools split, systemPrompt body)', () => {
    const g = parseProject([
      file('.claude/agents/rev.md', '---\nname: rev\ndescription: reviews\ntools: Read, Grep\nmodel: opus\n---\n\nReview carefully.\n'),
    ])!;
    const agent = g.nodes.find((n) => n.kind === 'step.subagent')!;
    expect(agent.kind).toBe('step.subagent');
    if (agent.kind === 'step.subagent') {
      expect(agent.data.name).toBe('rev');
      expect(agent.data.description).toBe('reviews');
      expect(agent.data.tools).toEqual(['Read', 'Grep']);
      expect(agent.data.model).toBe('opus');
      expect(agent.data.systemPrompt).toBe('Review carefully.');
    }
  });

  it('maps every optional skill frontmatter field when present', () => {
    const g = parseProject([
      file(
        '.claude/skills/full/SKILL.md',
        '---\ndescription: d\nargument-hint: "[x]"\nmodel: opus\ncontext: fork\nagent: helper\ndisable-model-invocation: true\n---\n\nbody\n',
      ),
    ])!;
    const cmd = g.nodes.find((n) => n.kind === 'trigger.slashCommand')!;
    if (cmd.kind !== 'trigger.slashCommand') throw new Error('kind');
    expect(cmd.data).toMatchObject({
      name: 'full',
      description: 'd',
      argumentHint: '[x]',
      model: 'opus',
      contextFork: true,
      agent: 'helper',
      disableModelInvocation: true,
    });
  });

  it('omits every optional skill field when absent (present-vs-absent kill)', () => {
    const g = parseProject([file('.claude/skills/bare/SKILL.md', '---\ndescription: d\n---\n\nbody\n')])!;
    const cmd = g.nodes.find((n) => n.kind === 'trigger.slashCommand')!;
    if (cmd.kind !== 'trigger.slashCommand') throw new Error('kind');
    expect(cmd.data.argumentHint).toBeUndefined();
    expect(cmd.data.model).toBeUndefined();
    expect(cmd.data.contextFork).toBeUndefined();
    expect(cmd.data.agent).toBeUndefined();
    expect(cmd.data.disableModelInvocation).toBeUndefined();
    expect(cmd.data.extra).toBeUndefined();
  });

  it('context other than "fork" does not set contextFork', () => {
    const g = parseProject([file('.claude/skills/x/SKILL.md', '---\ndescription: d\ncontext: something\n---\n\nb\n')])!;
    const cmd = g.nodes.find((n) => n.kind === 'trigger.slashCommand')!;
    if (cmd.kind === 'trigger.slashCommand') expect(cmd.data.contextFork).toBeUndefined();
  });

  it('a description-less skill imports as empty string, not undefined', () => {
    const g = parseProject([file('.claude/skills/x/SKILL.md', '---\nmodel: opus\n---\n\nb\n')])!;
    const cmd = g.nodes.find((n) => n.kind === 'trigger.slashCommand')!;
    if (cmd.kind === 'trigger.slashCommand') expect(cmd.data.description).toBe('');
  });

  it('subagent without tools/model/description omits them (systemPrompt required)', () => {
    const g = parseProject([file('.claude/agents/a.md', '---\nname: a\n---\n\nJust a body.\n')])!;
    const agent = g.nodes.find((n) => n.kind === 'step.subagent')!;
    if (agent.kind !== 'step.subagent') throw new Error('kind');
    expect(agent.data.tools).toBeUndefined();
    expect(agent.data.model).toBeUndefined();
    expect(agent.data.description).toBeUndefined();
    expect(agent.data.systemPrompt).toBe('Just a body.');
  });

  it('assigns distinct sequential node ids and a body edge', () => {
    const g = parseProject([
      file('.claude/skills/one/SKILL.md', '---\ndescription: a\n---\n\nbody one\n'),
      file('.claude/agents/two.md', '---\nname: two\n---\n\nagent body\n'),
    ])!;
    const ids = g.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    // command + its body step + agent = 3 nodes; one edge (command→body).
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(1);
  });

  it('re-emitting a reconstructed skill preserves description + extra (verbatim round-trip)', () => {
    const original = '---\ndescription: d\nx-custom: kept\n---\n\nBody text.\n';
    const g = parseProject([file('.claude/skills/x/SKILL.md', original)])!;
    // Regenerate and confirm the extra key survives to output.
    const out = generate(g).find((f) => f.path.endsWith('SKILL.md'))!;
    expect(out.content).toContain('description: d');
    expect(out.content).toContain('x-custom: kept');
    expect(out.content).toContain('Body text.');
  });
});
