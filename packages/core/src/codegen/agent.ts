// Subagent emitter → .claude/agents/<name>.md. SPEC-CODEGEN "Subagent mapping".
import type { GeneratedFile } from '../schema/types.js';
import { frontmatter } from './yaml.js';
import type { SubagentUnit } from './model.js';

export function emitAgent(unit: SubagentUnit): GeneratedFile {
  const { data } = unit;
  const fm = frontmatter([
    ['name', data.name],
    ['description', data.description],
    ['tools', data.tools ?? []], // omit → inherits all
    ['model', data.model],
    ...Object.entries(data.extra ?? {}).map(([k, v]) => [k, v as string] as [string, string]),
  ]);
  const content = `${fm}\n\n${data.systemPrompt.trimEnd()}\n`;
  return { path: `.claude/agents/${data.name}.md`, content };
}
