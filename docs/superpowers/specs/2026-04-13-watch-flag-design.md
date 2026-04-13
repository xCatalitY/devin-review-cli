# Design Spec: `--watch` Flag for devin-bugs

**Date:** 2026-04-13
**Version:** 0.6.0

## Purpose

Add a `--watch` flag that polls the Devin review jobs endpoint until the review completes, showing stage progress in real time, then printing the bug output. Analogous to `gh run watch` for GitHub Actions.

## Behavior

### Entry conditions

When `--watch` is passed alongside a PR reference:

| Current review status | Action |
|----------------------|--------|
| `completed` | Skip polling, print bugs immediately (same as without `--watch`) |
| `running` | Enter poll loop |
| `no_review` | Print "No Devin review triggered for {pr}" and exit 0 |
| `failed` | Print "Devin review failed for {pr}" and exit 0 |
| Jobs endpoint fails | Print warning, fall through to normal output (no polling) |

### Poll loop

1. Fetch jobs via `fetchJobs()` every **10 seconds**
2. Compare `getReviewStatus()` result to previous state
3. When a new stage appears in `stages.completed`, print a progress line to **stderr**
4. When `status` transitions to `completed`, exit the loop
5. Timeout after **10 minutes** (600 seconds) with message: "Timed out waiting for Devin review after 10 minutes."
6. Timeout exits with code **1** (distinct from success)

### Stage progress output (stderr)

```
  ⟳ Watching Devin review for owner/repo#123...
  ✓ Bug detection (1/4)
  ✓ File grouping (2/4)
  ✓ Copy detection (3/4)
  ✓ Finalizing (4/4)
```

Uses the same `stageLabels` map already in `format.ts`:
- `lifeguard` → "Bug detection"
- `groups` → "File grouping"
- `copy_detection` → "Copy detection"
- `display_info` → "Finalizing"

### After poll loop completes

Normal output flow: fetch digest, extract flags, print via `formatTerminal()` or `formatJSON()`. The `reviewStatus` is already known (completed), so it's passed to the formatters as usual.

### Compatibility with other flags

| Flag combo | Behavior |
|------------|----------|
| `--watch --json` | Progress to stderr, JSON envelope to stdout at end |
| `--watch --all` | Works normally (includes analysis flags) |
| `--watch --raw` | Works normally (dumps raw digest at end) |
| `--watch --login` | `--login` takes precedence (just authenticate) |
| `--watch --logout` | `--logout` takes precedence (just clear creds) |

### Exit codes

| Condition | Exit code |
|-----------|-----------|
| Review completed, bugs printed | 0 |
| Review completed, no bugs | 0 |
| Timed out | 1 |
| Auth required | 10 |
| Other error | 1 |

## Implementation

### Files to modify

| File | Change |
|------|--------|
| `src/cli.ts` | Add `--watch` flag to parseArgs, add poll loop before digest fetch |
| `src/watch.ts` | New file: `watchReview()` function with poll loop, progress output, timeout |
| `src/types.ts` | No changes needed (ReviewStatus already has what we need) |
| `src/format.ts` | No changes needed |
| `.claude/skills/devin-bugs/SKILL.md` | Document `--watch` flag |
| `README.md` | Add `--watch` to options and examples |
| `package.json` | Bump to 0.6.0 |

### `src/watch.ts` — new file

Single exported function:

```typescript
export async function watchReview(
  prPath: string,
  token: string,
  pr: ParsedPR,
): Promise<ReviewStatus>
```

- Fetches initial status. If already `completed`/`no_review`/`failed`, returns immediately.
- If `running`, enters poll loop:
  - Tracks `previousCompleted: string[]` to detect new stage completions
  - Prints header: `⟳ Watching Devin review for {owner}/{repo}#{number}...`
  - Every 10s: fetch jobs, compare stages, print new completions
  - On transition to `completed`: return the status
  - On timeout (10 min): throw a `WatchTimeoutError`
- All progress output goes to `stderr` via `console.error()`
- Uses the same ANSI colors from a shared constant or inline

### `src/cli.ts` — changes

1. Add `watch: { type: "boolean", default: false }` to parseArgs options
2. Add `--watch` to HELP text
3. After auth but before digest fetch: if `--watch`, call `watchReview()`. If it returns `no_review` or `failed`, print status and exit. If it returns `completed`, continue to digest fetch.
4. Wrap `watchReview()` call in try/catch for `WatchTimeoutError` → exit 1 with timeout message.

### Flow with `--watch`

```
auth → watchReview() → [poll until completed] → fetchDigest → extractFlags → formatOutput
```

Without `--watch` (unchanged):
```
auth → fetchDigest → fetchJobs → extractFlags → formatOutput
```
