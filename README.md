# Claude Flow Designer

Design Claude Code workflows visually — triggers, prompt steps, subagents, hooks, gates —
then export a ready-to-use `.claude/` folder (SKILL.md skills, agents, hook scripts,
settings.json) and a headless `run.sh`. Available as a local web app and a VS Code
extension sharing the same canvas and codegen core.

- Start here: `CLAUDE.md` (build/test/conventions)
- Node schema: `docs/SPEC-NODES.md`
- Graph → files mapping: `docs/SPEC-CODEGEN.md`
- Claude Code parameter digest: `docs/REFERENCE-CLAUDE-CODE.md`
- Milestones: `docs/ROADMAP.md`
- Execution briefs (one per milestone): `docs/briefs/`
- UI design brief: `docs/DESIGN-BRIEF.md`

Suggested first prompt for Claude Code in this repo:
> Read CLAUDE.md and docs/, then execute docs/briefs/M0-foundation.md.
