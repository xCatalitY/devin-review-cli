---
name: devin-bugs
description: Extract unresolved bugs from a Devin AI code review for a GitHub PR. Use when the user mentions a PR number, wants to check Devin review status, asks about bugs flagged by Devin, or wants to see what Devin found in a code review. Also use when the user says "check devin", "devin review", "PR bugs", or references app.devin.ai.
argument-hint: "<owner/repo#number>"
allowed-tools: Bash Read Grep
---

# Extract Devin Review Bugs

Fetch and analyze unresolved bugs from Devin AI's code review for a GitHub pull request.

## Prerequisites

The `devin-bugs` CLI must be installed globally:

```bash
npm install -g devin-bugs
```

If not installed, tell the user to run the command above first.

## How to run

```bash
devin-bugs $ARGUMENTS
```

If `$ARGUMENTS` is empty, ask the user for the PR reference (e.g. `owner/repo#123`).

## Input formats

The tool accepts any of these:
- `owner/repo#123`
- `https://github.com/owner/repo/pull/123`
- `https://app.devin.ai/review/owner/repo/pull/123`

## Getting structured data

For analysis, always prefer JSON output:

```bash
devin-bugs $ARGUMENTS --json
```

Each bug in the JSON array has:
- `filePath` — file with the bug
- `startLine` / `endLine` — line range
- `title` — short description
- `description` — full explanation with code references
- `severity` — `severe`, `warning`, or `info`
- `recommendation` — suggested fix
- `type` — `lifeguard-bug` (actual bug) or `lifeguard-analysis` (suggestion)
- `htmlUrl` — link to the GitHub comment

## Flags

| Flag | Purpose |
|------|---------|
| `--json` | JSON output for parsing and analysis |
| `--all` | Include analysis suggestions, not just bugs |
| `--raw` | Dump full API response (debug) |
| `--no-cache` | Force re-authentication |
| `--login` | Just authenticate, don't fetch anything |
| `--logout` | Clear stored credentials |

## Authentication

The tool handles auth automatically:
1. **First run**: opens browser to a local instruction page. User logs in to app.devin.ai, then pastes a one-liner in the browser console.
2. **Subsequent runs**: uses cached token. When it expires (~30min), silently refreshes via Auth0 refresh token — no browser needed.
3. **CI/scripts**: set `DEVIN_TOKEN` env var to skip browser auth entirely.

Token cached at `~/.config/devin-bugs/token.json`.

If auth fails, suggest `devin-bugs --login` to re-authenticate.

## After fetching

Once you have the bugs:
- Summarize them for the user with file locations and severity
- Cross-reference with local code files using Read/Grep to verify the issues
- Suggest fixes based on the bug descriptions and recommendations
- Create tasks from the bug list if there are multiple bugs
- If the user's codebase is available, read the flagged files and propose concrete fixes
