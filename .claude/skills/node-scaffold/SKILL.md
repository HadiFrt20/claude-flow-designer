---
description: Scaffold a new workflow node type end-to-end (schema, codegen, validation, panel, importer, tests). Use when adding or modifying a node kind.
argument-hint: [node-kind e.g. hook.http]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(npm test*), Bash(npx vitest*)
---

Add or update the node kind: $ARGUMENTS

Follow the "Definition of done for a node type" in CLAUDE.md, in order:
1. Read docs/SPEC-NODES.md and docs/SPEC-CODEGEN.md sections for this kind.
2. Zod schema in packages/core/src/schema/ + union registration.
3. Codegen mapping in packages/core/src/codegen/ + snapshot test.
4. Validation rules + tests (check BLOCKABLE_EVENTS where relevant).
5. Property panel in packages/canvas (Basic/Advanced groups, inline validation).
6. Importer round-trip support + property test.
Run `npm run test` and fix failures before finishing. If official Claude Code behavior
is unclear, check docs/REFERENCE-CLAUDE-CODE.md first, then the official docs URLs it lists.
