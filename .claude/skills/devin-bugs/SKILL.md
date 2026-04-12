---
name: devin-bugs
description: Extract unresolved bugs from a Devin AI code review for a GitHub PR. Use when the user mentions a PR number, wants to check Devin review status, or asks about bugs flagged by Devin.
argument-hint: "<owner/repo#number>"
allowed-tools: Bash Read
---

# Extract Devin Review Bugs

Fetch and analyze unresolved bugs from Devin AI's code review for a GitHub pull request.

## How to run

```bash
bun /home/hannah/Projects/devin-tool/src/cli.ts $ARGUMENTS
```

If `$ARGUMENTS` is empty, ask the user for the PR reference (e.g. `owner/repo#123`).

## Input formats

The tool accepts any of these:
- `owner/repo#123`
- `https://github.com/owner/repo/pull/123`
- `https://app.devin.ai/review/owner/repo/pull/123`

## Getting structured data

For analysis, use JSON output:

```bash
bun /home/hannah/Projects/devin-tool/src/cli.ts $ARGUMENTS --json
```

Each bug in the JSON array has:
- `filePath` — file with the bug
- `startLine` / `endLine` — line range
- `title` — short description
- `description` — full explanation
- `severity` — `severe`, `warning`, or `info`
- `recommendation` — suggested fix
- `htmlUrl` — link to the GitHub comment

## Useful flags

| Flag | Purpose |
|------|---------|
| `--json` | JSON output for parsing |
| `--all` | Include analysis suggestions, not just bugs |
| `--raw` | Dump full API response (debug) |
| `--no-cache` | Force re-authentication |

## Authentication

If not authenticated, the tool opens a browser. The user needs to:
1. Log in to app.devin.ai
2. Paste a one-liner from the instruction page into Devin's browser console

Token is cached at `~/.config/devin-bugs/token.json`. Set `DEVIN_TOKEN` env var to skip browser auth.

## After fetching

Once you have the bugs, you can:
- Summarize them for the user
- Cross-reference with local code files using Read/Grep
- Suggest fixes based on the bug descriptions
- Create tasks from the bug list
