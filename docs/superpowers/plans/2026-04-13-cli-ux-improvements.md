# CLI UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the devin-bugs CLI report auth requirements and review status clearly so Claude Code (and human users) always know what's happening.

**Architecture:** Three changes layered on the existing CLI: (1) auth.ts gains non-interactive detection that exits with code 10 instead of opening a browser, (2) cli.ts always fetches job status and passes it to formatters alongside bugs, (3) format.ts wraps output in a `{ status, bugs }` JSON envelope and adds a terminal status banner. The skill file is rewritten to handle these new signals.

**Tech Stack:** TypeScript/Bun, Node.js 18+ runtime, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-13-cli-ux-improvements-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/auth.ts` | Modify | Add `isNonInteractive()` check, `AuthRequiredError` class, periodic waiting messages, better browser-failure output |
| `src/cli.ts` | Modify | Catch `AuthRequiredError` → exit 10, always fetch jobs, pass status to formatters, bump version to 0.5.0 |
| `src/format.ts` | Modify | Add `formatStatusBanner()`, update `formatTerminal()` to include banner, change `formatJSON()` to emit `{ status, bugs }` |
| `src/types.ts` | Modify | Add `ReviewStatus` type alias |
| `.claude/skills/devin-bugs/SKILL.md` | Rewrite | Auth handling, review-in-progress handling, updated JSON schema, error recovery table |
| `package.json` | Modify | Version `0.4.0` → `0.5.0` |
| `README.md` | Modify | Updated JSON schema, exit codes, auth docs |

---

### Task 1: Add AuthRequiredError and non-interactive detection to auth.ts

**Files:**
- Modify: `src/auth.ts`

- [ ] **Step 1: Add AuthRequiredError class at the top of auth.ts (after imports)**

Add this right after the `import` statements and before the JWT helpers section:

```typescript
// ---------------------------------------------------------------------------
// Auth errors
// ---------------------------------------------------------------------------

/**
 * Thrown when authentication is required but we're in a non-interactive
 * context (CI, piped stdin, DEVIN_BUGS_NONINTERACTIVE). The CLI should
 * catch this and exit with code 10.
 */
export class AuthRequiredError extends Error {
  constructor() {
    super(
      "Authentication required\n" +
      "  devin-bugs needs you to log in via your browser.\n" +
      "  Run: devin-bugs --login\n" +
      "  Or set DEVIN_TOKEN environment variable for non-interactive use."
    );
    this.name = "AuthRequiredError";
  }
}
```

- [ ] **Step 2: Add isNonInteractive() helper (after the auth error class)**

```typescript
/** Detect non-interactive context where browser login can't work. */
function isNonInteractive(): boolean {
  return (
    !!process.env.CI ||
    !!process.env.DEVIN_BUGS_NONINTERACTIVE ||
    !process.stdin.isTTY
  );
}
```

- [ ] **Step 3: Update getToken() to throw AuthRequiredError in non-interactive mode**

In the `getToken` function, replace the section that calls `startCallbackServer()` (the "4. Interactive login" section, currently at lines ~486-489):

Replace:
```typescript
  // 4. Interactive login via browser
  const { token, auth0Cache } = await startCallbackServer();
  console.error("\x1b[32m✓ Authentication successful!\x1b[0m\n");
  writeCachedToken(token, auth0Cache);
  return token;
```

With:
```typescript
  // 4. Interactive login via browser (only if interactive)
  if (isNonInteractive()) {
    throw new AuthRequiredError();
  }

  const { token, auth0Cache } = await startCallbackServer();
  console.error("\x1b[32m✓ Authentication successful!\x1b[0m\n");
  writeCachedToken(token, auth0Cache);
  return token;
```

- [ ] **Step 4: Update forceReauth() with the same non-interactive guard**

Replace:
```typescript
export async function forceReauth(): Promise<string> {
  clearCachedToken();
  const { token, auth0Cache } = await startCallbackServer();
  console.error("\x1b[32m✓ Authentication successful!\x1b[0m\n");
  writeCachedToken(token, auth0Cache);
  return token;
}
```

With:
```typescript
export async function forceReauth(): Promise<string> {
  clearCachedToken();

  if (isNonInteractive()) {
    throw new AuthRequiredError();
  }

  const { token, auth0Cache } = await startCallbackServer();
  console.error("\x1b[32m✓ Authentication successful!\x1b[0m\n");
  writeCachedToken(token, auth0Cache);
  return token;
}
```

- [ ] **Step 5: Export AuthRequiredError from auth.ts**

Already exported by the class declaration. Verify the existing export line for `getToken` and `forceReauth` also exports the new class. The current export is inline (`export class`), so nothing extra needed.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts
git commit -m "feat: add AuthRequiredError and non-interactive detection

Non-interactive contexts (CI, piped stdin, DEVIN_BUGS_NONINTERACTIVE)
now throw AuthRequiredError instead of opening a browser. The CLI will
catch this and exit with code 10."
```

---

### Task 2: Improve interactive auth messaging in auth.ts

**Files:**
- Modify: `src/auth.ts`

- [ ] **Step 1: Improve the auth banner in startCallbackServer()**

Replace the current server startup message block (lines ~428-430 inside the `server.listen` callback):

Replace:
```typescript
      console.error(`\x1b[33m▸ Opening browser for Devin login...\x1b[0m`);
      console.error(`  Local server: http://localhost:${port}\n`);

      openBrowser(`http://localhost:${port}`);
```

With:
```typescript
      const loginUrl = `http://localhost:${port}`;

      console.error(`\n\x1b[33m⚠ Authentication required\x1b[0m`);
      console.error(`  Opening browser for Devin login...`);
      console.error(`  If the browser doesn't open, visit: \x1b[36m${loginUrl}\x1b[0m\n`);

      openBrowser(loginUrl);
```

- [ ] **Step 2: Improve browser-open failure message**

Replace the current `openBrowser` error handler (lines ~211-214):

Replace:
```typescript
  execFile(opener.cmd, opener.args, (err) => {
    if (err) {
      console.error(`\x1b[33m▸ Could not open browser automatically.\x1b[0m`);
      console.error(`  Open this URL manually: ${url}\n`);
    }
  });
```

With:
```typescript
  execFile(opener.cmd, opener.args, (err) => {
    if (err) {
      console.error(`\x1b[31m✗ Could not open browser automatically.\x1b[0m`);
      console.error(`\x1b[1m  Open this URL in your browser:\x1b[0m`);
      console.error(`  \x1b[36m${url}\x1b[0m\n`);
    }
  });
```

- [ ] **Step 3: Add periodic "still waiting" messages**

Inside `startCallbackServer()`, in the `server.listen` callback, right after the `openBrowser` call and before the existing 5-minute timeout, add a periodic message interval:

```typescript
      // Periodic "still waiting" messages
      const waitingInterval = setInterval(() => {
        if (!receivedToken) {
          console.error(`\x1b[33m  Still waiting for login...\x1b[0m`);
        }
      }, 30_000);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(waitingInterval);
        if (!receivedToken) {
```

Also clear the interval on success. In the `POST /callback` handler's success `setTimeout`, add `clearInterval(waitingInterval)`. This requires hoisting `waitingInterval` to the enclosing scope. Since the interval is created inside `server.listen` callback but the POST handler is in the `createServer` callback (outer scope), we need to declare it at the top of the `startCallbackServer` function:

At the top of `startCallbackServer()`, after `return new Promise((resolve, reject) => {`:

Replace:
```typescript
    let receivedToken: string | null = null;
```

With:
```typescript
    let receivedToken: string | null = null;
    let waitingInterval: ReturnType<typeof setInterval> | null = null;
```

Then in the POST /callback success branch, the `setTimeout` block becomes:

Replace:
```typescript
              setTimeout(() => {
                server.close();
                resolve({ token: receivedToken!, auth0Cache, server });
              }, 500);
```

With:
```typescript
              setTimeout(() => {
                if (waitingInterval) clearInterval(waitingInterval);
                server.close();
                resolve({ token: receivedToken!, auth0Cache, server });
              }, 500);
```

And in the `server.listen` callback, the timeout block becomes:

Replace:
```typescript
      // Timeout after 5 minutes
      setTimeout(() => {
        if (!receivedToken) {
          server.close();
          reject(new Error("Login timed out after 5 minutes."));
        }
      }, 5 * 60 * 1000);
```

With:
```typescript
      // Periodic "still waiting" messages
      waitingInterval = setInterval(() => {
        if (!receivedToken) {
          console.error(`\x1b[33m  Still waiting for login...\x1b[0m`);
        }
      }, 30_000);

      // Timeout after 5 minutes
      setTimeout(() => {
        if (waitingInterval) clearInterval(waitingInterval);
        if (!receivedToken) {
          server.close();
          reject(new Error("Login timed out after 5 minutes."));
        }
      }, 5 * 60 * 1000);
```

- [ ] **Step 4: Commit**

```bash
git add src/auth.ts
git commit -m "feat: improve interactive auth messaging

Clear auth-required banner, prominent URL on browser-open failure,
periodic 'still waiting' messages every 30s during login."
```

---

### Task 3: Add ReviewStatus type to types.ts

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add ReviewStatus type at the end of types.ts**

```typescript
// ---------------------------------------------------------------------------
// Review status (from jobs endpoint)
// ---------------------------------------------------------------------------

export interface ReviewStatus {
  status: "no_review" | "running" | "completed" | "failed";
  message: string;
  stages?: { completed: string[]; total: string[] };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add ReviewStatus type"
```

---

### Task 4: Update api.ts to use ReviewStatus type

**Files:**
- Modify: `src/api.ts`

- [ ] **Step 1: Import and use ReviewStatus type**

Add to the import at the top of `api.ts`:

Replace:
```typescript
import type { DigestResponse } from "./types.js";
```

With:
```typescript
import type { DigestResponse, ReviewStatus } from "./types.js";
```

- [ ] **Step 2: Update getReviewStatus return type**

Replace the function signature:

Replace:
```typescript
export function getReviewStatus(jobs: JobsResponse): {
  status: "no_review" | "running" | "completed" | "failed";
  message: string;
  stages?: { completed: string[]; total: string[] };
} {
```

With:
```typescript
export function getReviewStatus(jobs: JobsResponse): ReviewStatus {
```

- [ ] **Step 3: Commit**

```bash
git add src/api.ts src/types.ts
git commit -m "refactor: use ReviewStatus type in api.ts"
```

---

### Task 5: Update format.ts — status banner and new JSON structure

**Files:**
- Modify: `src/format.ts`

- [ ] **Step 1: Import ReviewStatus type**

Replace:
```typescript
import type { LifeguardFlag, ParsedPR } from "./types.js";
```

With:
```typescript
import type { LifeguardFlag, ParsedPR, ReviewStatus } from "./types.js";
```

- [ ] **Step 2: Add formatStatusBanner() function**

Add this after the existing `typeBadge` function (before the "Terminal formatter" section comment):

```typescript
// ---------------------------------------------------------------------------
// Status banner (shown at top of terminal output)
// ---------------------------------------------------------------------------

function formatStatusBanner(status: ReviewStatus, pr: ParsedPR): string {
  const prRef = `${c.dim}${pr.owner}/${pr.repo}#${pr.number}${c.reset}`;

  switch (status.status) {
    case "completed":
      return `\n  ${c.green}✓ Devin review complete${c.reset} for ${prRef}\n`;

    case "running": {
      const stageLabels: Record<string, string> = {
        lifeguard: "Bug detection",
        groups: "File grouping",
        copy_detection: "Copy detection",
        display_info: "Finalizing",
      };
      const stages = status.stages;
      const lines: string[] = [];
      lines.push(`\n  ${c.yellow}${c.bold}⟳ Devin review in progress${c.reset} for ${prRef}`);

      if (stages) {
        const done = stages.completed.length;
        const total = stages.total.length;
        const currentStage = stages.total.find((s) => !stages.completed.includes(s));
        const currentLabel = currentStage ? stageLabels[currentStage] ?? currentStage : "Processing";
        lines.push(`  ${c.yellow}${currentLabel} (${done}/${total} stages)${c.reset}`);
      }

      lines.push(`  ${c.dim}Results below may be from a previous review.${c.reset}\n`);
      return lines.join("\n");
    }

    case "no_review":
      return `\n  ${c.yellow}○ No Devin review triggered${c.reset} for ${prRef}\n`;

    case "failed":
      return `\n  ${c.red}✗ Devin review failed${c.reset} for ${prRef}\n`;
  }
}
```

- [ ] **Step 3: Update formatTerminal() to accept and display status**

Change the function signature and add banner at top:

Replace:
```typescript
export function formatTerminal(flags: LifeguardFlag[], pr: ParsedPR): string {
  const lines: string[] = [];

  // Header
  const bugCount = flags.filter((f) => f.type === "lifeguard-bug").length;
```

With:
```typescript
export function formatTerminal(flags: LifeguardFlag[], pr: ParsedPR, status?: ReviewStatus): string {
  const lines: string[] = [];

  // Status banner (always shown when status available)
  if (status) {
    // For completed reviews with bugs, skip the banner (the bug count header is enough)
    // For all other states, show the banner
    if (status.status !== "completed" || flags.length === 0) {
      lines.push(formatStatusBanner(status, pr));
    }
  }

  // Header
  const bugCount = flags.filter((f) => f.type === "lifeguard-bug").length;
```

- [ ] **Step 4: Update formatJSON() to emit { status, bugs }**

Replace:
```typescript
export function formatJSON(flags: LifeguardFlag[]): string {
  return JSON.stringify(flags, null, 2);
}
```

With:
```typescript
export function formatJSON(flags: LifeguardFlag[], status?: ReviewStatus): string {
  return JSON.stringify({
    status: status ?? { status: "completed", message: "Devin review complete." },
    bugs: flags,
  }, null, 2);
}
```

- [ ] **Step 5: Remove the old formatStatus() function**

Delete the entire "Status formatter" section (the `formatStatus` function and its comment header). This was the old "when no bugs found" formatter that is now replaced by `formatStatusBanner` integrated into `formatTerminal`.

Remove:
```typescript
// ---------------------------------------------------------------------------
// Status formatter (when no bugs found)
// ---------------------------------------------------------------------------

export function formatStatus(
  status: {
    status: "no_review" | "running" | "completed" | "failed";
    message: string;
    stages?: { completed: string[]; total: string[] };
  },
  pr: ParsedPR
): string {
  // ... entire function body ...
}
```

- [ ] **Step 6: Commit**

```bash
git add src/format.ts
git commit -m "feat: status banner in terminal, { status, bugs } JSON envelope

Breaking: JSON output changes from bare array to { status, bugs } object.
Terminal output now shows review status banner at top."
```

---

### Task 6: Rewire cli.ts — always fetch jobs, handle AuthRequiredError, bump version

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Update imports**

Replace:
```typescript
import { getToken, forceReauth } from "./auth.js";
import { fetchDigest, fetchJobs, getReviewStatus, AuthExpiredError, ApiError } from "./api.js";
import { extractFlags } from "./filter.js";
import { formatTerminal, formatJSON, formatStatus } from "./format.js";
```

With:
```typescript
import { getToken, forceReauth, AuthRequiredError } from "./auth.js";
import { fetchDigest, fetchJobs, getReviewStatus, AuthExpiredError, ApiError } from "./api.js";
import { extractFlags } from "./filter.js";
import { formatTerminal, formatJSON } from "./format.js";
import type { ReviewStatus } from "./types.js";
```

- [ ] **Step 2: Bump version string**

Replace:
```typescript
function printVersion(): void {
  console.log("devin-bugs 0.4.0");
}
```

With:
```typescript
function printVersion(): void {
  console.log("devin-bugs 0.5.0");
}
```

- [ ] **Step 3: Add AuthRequiredError handling in the auth section**

Replace the auth token section:

Replace:
```typescript
  // Get auth token
  let token: string;
  try {
    token = await getToken({ noCache: values["no-cache"] });
  } catch (err: any) {
    console.error(`\x1b[31mAuth error:\x1b[0m ${err.message}`);
    process.exit(1);
  }
```

With:
```typescript
  // Get auth token
  let token: string;
  try {
    token = await getToken({ noCache: values["no-cache"] });
  } catch (err: any) {
    if (err instanceof AuthRequiredError) {
      console.error(`\x1b[33m⚠ ${err.message}\x1b[0m`);
      process.exit(10);
    }
    console.error(`\x1b[31mAuth error:\x1b[0m ${err.message}`);
    process.exit(1);
  }
```

- [ ] **Step 4: Also handle AuthRequiredError in the re-auth retry block**

In the digest fetch section, the re-auth catch block:

Replace:
```typescript
      // Re-authenticate and retry
      console.error("\x1b[33m▸ Token expired, re-authenticating...\x1b[0m");
      try {
        token = await forceReauth();
        digest = await fetchDigest(pr.prPath, token);
      } catch (retryErr: any) {
        console.error(`\x1b[31mError:\x1b[0m ${retryErr.message}`);
        process.exit(1);
      }
```

With:
```typescript
      // Re-authenticate and retry
      console.error("\x1b[33m▸ Token expired, re-authenticating...\x1b[0m");
      try {
        token = await forceReauth();
        digest = await fetchDigest(pr.prPath, token);
      } catch (retryErr: any) {
        if (retryErr instanceof AuthRequiredError) {
          console.error(`\x1b[33m⚠ ${retryErr.message}\x1b[0m`);
          process.exit(10);
        }
        console.error(`\x1b[31mError:\x1b[0m ${retryErr.message}`);
        process.exit(1);
      }
```

- [ ] **Step 5: Replace the post-digest section (always fetch jobs, new output logic)**

Replace everything after `// --raw: dump full response` through the end of `main()` (lines ~170-204):

Replace:
```typescript
  // --raw: dump full response
  if (values.raw) {
    console.log(JSON.stringify(digest, null, 2));
    return;
  }

  // Extract and filter flags
  const flags = extractFlags(digest!, {
    includeAnalysis: values.all,
  });

  // When no bugs found, check job status to explain why
  if (flags.length === 0) {
    try {
      const jobsData = await fetchJobs(pr.prPath, token);
      const reviewStatus = getReviewStatus(jobsData);

      if (values.json) {
        console.log(JSON.stringify({ bugs: [], status: reviewStatus }, null, 2));
      } else {
        console.log(formatStatus(reviewStatus, pr));
      }
      return;
    } catch {
      // Jobs endpoint failed — fall through to normal output
    }
  }

  // Output
  if (values.json) {
    console.log(formatJSON(flags));
  } else {
    console.log(formatTerminal(flags, pr));
  }
```

With:
```typescript
  // --raw: dump full response
  if (values.raw) {
    console.log(JSON.stringify(digest, null, 2));
    return;
  }

  // Always fetch job status for review state
  let reviewStatus: ReviewStatus | undefined;
  try {
    const jobsData = await fetchJobs(pr.prPath, token);
    reviewStatus = getReviewStatus(jobsData);
  } catch {
    // Jobs endpoint failed — continue without status
  }

  // Extract and filter flags
  const flags = extractFlags(digest!, {
    includeAnalysis: values.all,
  });

  // Output
  if (values.json) {
    console.log(formatJSON(flags, reviewStatus));
  } else {
    console.log(formatTerminal(flags, pr, reviewStatus));
  }
```

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat: always fetch review status, exit code 10 for auth, v0.5.0

- AuthRequiredError → exit code 10 (non-interactive auth signal)
- Always fetch jobs to show review status in all output
- Pass status to formatters for banner + JSON envelope
- Bump version to 0.5.0"
```

---

### Task 7: Bump package.json version

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update version**

Replace:
```json
  "version": "0.4.0",
```

With:
```json
  "version": "0.5.0",
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.5.0"
```

---

### Task 8: Rewrite SKILL.md

**Files:**
- Rewrite: `.claude/skills/devin-bugs/SKILL.md`

- [ ] **Step 1: Replace the entire SKILL.md contents**

```markdown
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

After parsing the JSON, check `status.status`:

- **`completed`**: Review is done. Report bugs normally.
- **`running`**: Devin is still reviewing (or re-reviewing after a PR update). Tell the user:
  - "Devin is still reviewing this PR ({stages.completed.length}/{stages.total.length} stages complete)."
  - If bugs are present: "These bugs are from a previous review and may change once the current review finishes."
  - Suggest re-running later for fresh results.
- **`no_review`**: Devin hasn't been triggered on this PR. Tell the user.
- **`failed`**: The review job failed. Tell the user.

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
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/devin-bugs/SKILL.md
git commit -m "feat: rewrite skill for v0.5.0 auth handling and status signals

- Set DEVIN_BUGS_NONINTERACTIVE=1 on all invocations
- Handle exit code 10 (auth required) with user guidance
- Document new { status, bugs } JSON schema
- Add review-in-progress interpretation instructions"
```

---

### Task 9: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the JSON example in the examples section**

Replace:
```bash
# Get bugs as JSON for scripting
devin-bugs owner/repo#46 --json | jq '.[].title'
```

With:
```bash
# Get bugs as JSON for scripting
devin-bugs owner/repo#46 --json | jq '.bugs[].title'
```

- [ ] **Step 2: Update the severe filter example**

Replace:
```bash
# Pipe to another tool
devin-bugs owner/repo#46 --json | jq '.[] | select(.severity == "severe")'
```

With:
```bash
# Pipe to another tool
devin-bugs owner/repo#46 --json | jq '.bugs[] | select(.severity == "severe")'
```

- [ ] **Step 3: Add exit codes section after the Authentication section**

After the "For CI or headless environments, set `DEVIN_TOKEN`..." paragraph, add:

```markdown
### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (API failure, network error, etc.) |
| `10` | Authentication required (non-interactive context) |
```

- [ ] **Step 4: Replace the JSON output schema section**

Replace:
```typescript
interface Bug {
  filePath: string;       // "lib/apply/assist.ts"
  startLine: number;      // 124
  endLine: number;        // 136
  side: "LEFT" | "RIGHT";
  title: string;          // Short description
  description: string;    // Full explanation
  severity: string;       // "severe" | "warning" | "info"
  recommendation: string; // Suggested fix
  type: "lifeguard-bug" | "lifeguard-analysis";
  isResolved: boolean;
  isOutdated: boolean;
  htmlUrl: string | null;  // Link to GitHub comment
}
```

With:
```typescript
interface Output {
  status: {
    status: "completed" | "running" | "no_review" | "failed";
    message: string;
    stages?: { completed: string[]; total: string[] };
  };
  bugs: Bug[];
}

interface Bug {
  filePath: string;       // "lib/apply/assist.ts"
  startLine: number;      // 124
  endLine: number;        // 136
  side: "LEFT" | "RIGHT";
  title: string;          // Short description
  description: string;    // Full explanation
  severity: string;       // "severe" | "warning" | "info"
  recommendation: string; // Suggested fix
  type: "lifeguard-bug" | "lifeguard-analysis";
  isResolved: boolean;
  isOutdated: boolean;
  htmlUrl: string | null;  // Link to GitHub comment
}
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README for v0.5.0 JSON schema and exit codes"
```

---

### Task 10: Build, typecheck, and manually test

**Files:**
- No new files

- [ ] **Step 1: Run typecheck**

Run: `cd /home/hannah/Projects/devin-tool && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `dist/cli.js` generated with no errors

- [ ] **Step 3: Test non-interactive auth detection**

Run: `DEVIN_BUGS_NONINTERACTIVE=1 bun src/cli.ts owner/repo#123; echo "Exit code: $?"`
Expected: stderr shows "Authentication required" message, exit code is `10` (or token is cached and it proceeds — if cached, test with `--no-cache`)

- [ ] **Step 4: Test JSON output structure**

Run: `bun src/cli.ts <known-PR-with-devin-review> --json | head -20`
Expected: Output starts with `{ "status": { "status": ...`, not a bare array

- [ ] **Step 5: Test terminal output with status banner**

Run: `bun src/cli.ts <known-PR-with-devin-review>`
Expected: Shows status banner ("✓ Devin review complete" or similar) followed by bugs

- [ ] **Step 6: Test --help still works**

Run: `bun src/cli.ts --help`
Expected: Help text displayed

- [ ] **Step 7: Test --version shows 0.5.0**

Run: `bun src/cli.ts --version`
Expected: `devin-bugs 0.5.0`

- [ ] **Step 8: Commit build output if needed, or verify .gitignore covers dist/**

Run: `git status`
Expected: `dist/` is gitignored (verify with `grep dist .gitignore`)
