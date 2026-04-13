# devin-bugs CLI UX Improvements

**Date:** 2026-04-13
**Version target:** 0.5.0 (breaking JSON output change)

## Problem

Two UX gaps make the CLI unreliable when invoked by Claude Code:

1. **Auth is invisible.** When the CLI needs interactive login, it opens a browser and prints minimal stderr. Claude Code doesn't know to tell the user to complete the login. In headless/SSH scenarios, the tool hangs silently for 5 minutes.

2. **Stale bugs shown without warning.** When a PR is updated and Devin regenerates its review, the CLI shows bugs from the prior review pass with no indication they may be outdated. Review status is only checked when zero bugs are found.

## Design

### 1. Auth UX overhaul

**Exit code 10** signals "authentication required." This is distinct from exit code 1 (error) and 0 (success).

#### Non-interactive detection

Before launching the browser-based login flow, check for non-interactive context. Detection heuristics (any one triggers non-interactive mode):
- `process.env.CI` is set (CI environment)
- `process.env.DEVIN_BUGS_NONINTERACTIVE` is set (explicit opt-in)
- `process.stdin.isTTY` is falsy (piped/redirected stdin)

Note: Claude Code's Bash tool may allocate a PTY, so `isTTY` alone is not reliable. The `CI` env var and explicit flag cover those gaps. The skill can set `DEVIN_BUGS_NONINTERACTIVE=1` before invoking.

When non-interactive and no `DEVIN_TOKEN` env var is set:

- Print to stderr:
  ```
  ⚠ Authentication required
    devin-bugs needs you to log in via your browser.
    Run: devin-bugs --login
    Or set DEVIN_TOKEN environment variable for non-interactive use.
  ```
- Exit with code 10.

This gives the calling skill a clear, parseable signal.

#### Interactive improvements

When stdin IS a TTY (user running directly in terminal):

- Print a clear "auth required" block before opening the browser:
  ```
  ⚠ Authentication required
    Opening browser for Devin login...
    If the browser doesn't open, visit: http://localhost:PORT
  ```
- If `xdg-open`/`open` fails: prominently show the localhost URL (not buried in a dim warning).
- While waiting for login: print "Still waiting for login..." to stderr every 30 seconds so the user (and any watching process) knows the tool is alive.

#### Files changed

- `src/auth.ts`: Add TTY detection, exit code 10 path, periodic waiting messages, better browser-failure messaging.
- `src/cli.ts`: Catch exit code 10 from auth path, propagate it.

### 2. Review status always present

**Always fetch job status** after the digest call. Include review state in all output.

#### Always-fetch pattern

Current flow:
```
fetch digest → extract bugs → if 0 bugs → fetch jobs → show status
```

New flow:
```
fetch digest → fetch jobs (parallel or sequential) → extract bugs → combine status + bugs → output
```

The `fetchJobs` call adds ~100-200ms but gives us the complete picture every time.

#### Terminal output

Add a status banner at the top of all output:

| State | Banner |
|-------|--------|
| Completed | `✓ Devin review complete` (in green, only if bugs follow) |
| In progress | `⟳ Devin review in progress: {current_stage} ({n}/{total} stages)` (yellow) + "Results below may be from a previous review" |
| No review | `○ No Devin review triggered` |
| Failed | `✗ Devin review failed` |

When review is in-progress AND bugs exist from a prior review, show both: the in-progress banner, then the stale bugs.

#### JSON output (breaking change)

Current JSON output (bare array):
```json
[{ "filePath": "...", ... }]
```

New JSON output (object with status):
```json
{
  "status": {
    "status": "running" | "completed" | "no_review" | "failed",
    "message": "Bug detection (2/4 stages)",
    "stages": {
      "completed": ["lifeguard"],
      "total": ["lifeguard", "groups", "copy_detection", "display_info"]
    }
  },
  "bugs": [{ "filePath": "...", ... }]
}
```

This is a **breaking change**. Consumers parsing a bare array will break. Version bump to 0.5.0.

The `status` object uses the same structure already returned by `getReviewStatus()` in `api.ts`, so no new types needed.

#### Files changed

- `src/cli.ts`: Reorder to always fetch jobs. Pass status to formatters. Update JSON output structure.
- `src/format.ts`: Add status banner to terminal output. Update `formatJSON` to emit `{ status, bugs }`.
- `src/api.ts`: No changes needed (already has `fetchJobs` and `getReviewStatus`).

### 3. Skill update

Update `.claude/skills/devin-bugs/SKILL.md` to handle the new CLI signals.

#### Auth handling

Add a section teaching the skill to detect and react to auth-needed:

- The skill should set `DEVIN_BUGS_NONINTERACTIVE=1` when invoking the CLI so the tool exits cleanly with code 10 instead of trying to open a browser.
- **Exit code 10** or stderr containing "Authentication required": Tell the user to run `! devin-bugs --login` in the Claude Code prompt (the `!` prefix runs the command in-session). After login completes, retry the original `devin-bugs` command.
- **DEVIN_TOKEN alternative**: Mention that setting the env var skips browser auth entirely.

#### Review-in-progress handling

- When JSON `status.status === "running"`: Report to the user that Devin is still reviewing, show the stage progress, and note that any bugs listed are from a previous review.
- Suggest re-running later for fresh results.

#### Updated JSON schema

Document the new `{ status, bugs }` structure in the skill so Claude knows how to parse it.

#### Error recovery table

| Exit code | Meaning | Skill action |
|-----------|---------|-------------|
| 0 | Success | Parse JSON, report status + bugs |
| 1 | Error | Read stderr, surface error message |
| 10 | Auth needed | Tell user to run `! devin-bugs --login`, then retry |
| 127 | Not installed | Tell user to run `npm install -g devin-bugs` |

#### Files changed

- `.claude/skills/devin-bugs/SKILL.md`: Full rewrite of the auth and output sections.

## Summary of all changes

| File | Change |
|------|--------|
| `src/auth.ts` | TTY detection, exit code 10, periodic waiting messages, better browser-failure UX |
| `src/cli.ts` | Always fetch jobs, combine status+bugs, propagate exit code 10, bump version string |
| `src/format.ts` | Status banner in terminal, `{ status, bugs }` JSON structure |
| `.claude/skills/devin-bugs/SKILL.md` | Auth handling, in-progress handling, updated JSON schema, error recovery |
| `package.json` | Version bump to 0.5.0 |
| `README.md` | Document new JSON format, exit codes, auth UX |

## Out of scope

- Polling/`--wait` mode (can be added later if needed)
- Separate `status` subcommand
- Automated test suite (tool is integration-tested manually against real PRs)
- Changes to the Auth0 flow itself (one-liner in DevTools is inherent to the reverse-engineered auth)
