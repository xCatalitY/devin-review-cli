# CLAUDE.md

CLI tool to extract unresolved bugs from Devin AI code reviews.

## Quick start

```bash
bun install
bun src/cli.ts owner/repo#123
```

## Files

| File | What | When to read |
| --- | --- | --- |
| `README.md` | Install instructions, usage examples, JSON schema, auth flow, API docs | Updating user-facing documentation or onboarding |
| `package.json` | Package config: `devin-bugs` on npm, bin entry at `bin/devin-bugs.js` | Changing version, deps, or npm publish settings |
| `tsconfig.json` | TypeScript config: ES2022, Bundler resolution, strict mode | Changing compile targets or type checking behavior |
| `LICENSE` | MIT license | N/A |

## Subdirectories

| Directory | What | When to read |
| --- | --- | --- |
| `src/` | All source: CLI entry, auth, API client, bug filter, output formatter | Any code changes |
| `bin/` | npm bin wrapper (`devin-bugs.js` → `src/cli.ts`) | Changing how the CLI is invoked via npm/bunx |
| `.claude/skills/devin-bugs/` | Claude Code `/devin-bugs` slash command skill | Changing the skill's behavior or arguments |
