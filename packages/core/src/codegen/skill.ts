// SKILL.md emitter. One SKILL.md per trigger.slashCommand, sections in edge order.
// SPEC-CODEGEN "Slash command / skill mapping".
import type { GeneratedFile } from '../schema/types.js';
import { frontmatter } from './yaml.js';
import { firstToken } from '../rules/helpers.js';
import type { CommandUnit, StepNode } from './model.js';

/** Tools required by a step, contributing to the union `allowed-tools`. */
function toolsForStep(step: StepNode): string[] {
  switch (step.kind) {
    case 'step.shell':
      if (step.data.embedOutput) {
        const cmd = firstToken(step.data.command);
        return cmd ? [`Bash(${cmd} *)`] : ['Bash'];
      }
      return [];
    case 'step.fileRef':
      return ['Read'];
    case 'step.mcpTool':
      return [`mcp__${step.data.server}__${step.data.tool}`];
    default:
      return [];
  }
}

function bodySection(step: StepNode): string | null {
  switch (step.kind) {
    case 'step.prompt':
      return step.data.body.trimEnd();
    case 'step.shell':
      if (step.data.embedOutput) {
        return `## Context\n- !\`${step.data.command}\``;
      }
      return null; // standalone script handled elsewhere (not part of SKILL body)
    case 'step.fileRef':
      return step.data.paths.map((p) => `@${p}`).join('\n');
    case 'step.subagent':
      return `Use the ${step.data.name} subagent to ${step.data.description ?? 'handle this step'}.`;
    case 'step.mcpTool':
      return null;
  }
}

export function emitSkill(unit: CommandUnit): GeneratedFile {
  const { data, steps } = unit;

  const toolSet = new Set<string>();
  for (const s of steps) for (const t of toolsForStep(s)) toolSet.add(t);
  const allowedTools = [...toolSet].sort();

  const argHint =
    data.argumentHint ?? (data.args?.length ? data.args.map((a) => `[${a.name}]`).join(' ') : undefined);

  const fm = frontmatter([
    ['description', data.description],
    ['allowed-tools', allowedTools],
    ['argument-hint', argHint],
    ['model', data.model],
    ['context', data.contextFork ? 'fork' : undefined],
    ['agent', data.agent],
    ['disable-model-invocation', data.disableModelInvocation ? true : undefined],
    // Unknown keys preserved on import, re-emitted verbatim (each as its own row).
    ...Object.entries(data.extra ?? {}).map(
      ([k, v]) => [k, v as string] as [string, string],
    ),
  ]);

  const sections: string[] = [];
  for (const s of steps) {
    const sec = bodySection(s);
    if (sec && sec.trim()) sections.push(sec.trim());
  }

  const content = `${fm}\n\n${sections.join('\n\n')}\n`.replace(/\n{3,}/g, '\n\n');
  return { path: `.claude/skills/${data.name}/SKILL.md`, content };
}
