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

Always set `DEVIN_BUGS_NONINTERACTIVE=1` so the CLI exits cleanly if auth is needed instead of trying to open a browser:

```bash
DEVIN_BUGS_NONINTERACTIVE=1 devin-bugs $ARGUMENTS --json
```

If `$ARGUMENTS` is empty, infer the PR from git remote and ask the user for the PR number.

## Input formats

The tool accepts any of these:
- `owner/repo#123`
- `123` (infers repo from git remote)
- `https://github.com/owner/repo/pull/123`
- `https://app.devin.ai/review/owner/repo/pull/123`

## Handling exit codes

| Exit code | Meaning | What to do |
|-----------|---------|------------|
| `0` | Success | Parse JSON output normally |
| `1` | Error | Read stderr, surface the error message to the user |
| `10` | Auth required | Tell the user: "Devin authentication is needed. Run `! devin-bugs --login` to log in, then I'll retry." After user completes login, re-run the original command. |
| `127` | Not installed | Tell the user: "devin-bugs is not installed. Run `npm install -g devin-bugs` to install it." |

**Important:** When exit code is 10, do NOT silently retry or ignore the error. The user must complete browser-based login interactively.

## JSON output schema (v0.5.0+)

The `--json` flag outputs:

```json
{
  "status": {
    "status": "completed | running | no_review | failed",
    "message": "Human-readable status message",
    "stages": {
      "completed": ["lifeguard", "groups"],
      "total": ["lifeguard", "groups", "copy_detection", "display_info"]
    }
  },
  "bugs": [
    {
      "filePath": "src/example.ts",
      "startLine": 42,
      "endLine": 50,
      "side": "RIGHT",
      "title": "Short description",
      "description": "Full explanation",
      "severity": "severe | warning | info",
      "recommendation": "Suggested fix",
      "type": "lifeguard-bug | lifeguard-analysis",
      "isResolved": false,
      "isOutdated": false,
      "htmlUrl": "https://github.com/..."
    }
  ]
}
```

## Interpreting review status

After parsing the JSON, check `status`:

- **`null`**: Review status could not be retrieved (jobs endpoint failed). Report bugs normally without status context.
- **`status.status === "completed"`**: Review is done. Report bugs normally.
- **`status.status === "running"`**: Devin is still reviewing (or re-reviewing after a PR update). Tell the user:
  - "Devin is still reviewing this PR ({stages.completed.length}/{stages.total.length} stages complete)."
  - If bugs are present: "These bugs are from a previous review and may change once the current review finishes."
  - Suggest re-running later for fresh results.
- **`status.status === "no_review"`**: Devin hasn't been triggered on this PR. Tell the user.
- **`status.status === "failed"`**: The review job failed. Tell the user.

## Flags

| Flag | Purpose |
|------|---------|
| `--json` | JSON output (always use this in the skill) |
| `--all` | Include analysis suggestions, not just bugs |
| `--raw` | Dump full API response (debug) |
| `--no-cache` | Force re-authentication |
| `--login` | Just authenticate, don't fetch anything |
| `--logout` | Clear stored credentials |

## After fetching

Once you have the bugs:
- Summarize them for the user with file locations and severity
- Cross-reference with local code files using Read/Grep to verify the issues
- Suggest fixes based on the bug descriptions and recommendations
- Create tasks from the bug list if there are multiple bugs
- If the user's codebase is available, read the flagged files and propose concrete fixes
