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
