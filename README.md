# devin-review-cli

CLI to extract unresolved bugs from [Devin AI](https://devin.ai) code reviews. Pulls flagged bugs from any PR that Devin has reviewed and outputs them in your terminal or as JSON.

```
$ devin-bugs owner/repo#46

  1 bug in owner/repo#46

  BUG  lib/apply/assist.ts:124-136   WARNING
  Reverting packet to 'ready' after credits charged creates an unrecoverable retry loop
  In prepareApplyAssist, when createApplication fails with a non-P2002 error,
  the packet is reverted to 'ready' but credits have already been charged...
```

## Install

```bash
npm install -g devin-bugs
```

Requires Node.js 18+. No other dependencies.

### Development

```bash
git clone https://github.com/xCatalitY/devin-review-cli.git
cd devin-review-cli
bun install
```

## Usage

```bash
# GitHub PR URL
devin-bugs https://github.com/owner/repo/pull/123

# Shorthand
devin-bugs owner/repo#123

# Devin review URL
devin-bugs https://app.devin.ai/review/owner/repo/pull/123
```

### Options

```
--json          Output as JSON (for piping)
--all           Include analysis/suggestions, not just bugs
--watch         Poll until Devin review completes, show progress
--raw           Dump raw API response (debug)
--no-cache      Force re-authentication
--login         Just authenticate, don't fetch anything
--logout        Clear stored credentials
--help, -h      Show help
```

### Examples

```bash
# Get bugs as JSON for scripting
devin-bugs owner/repo#46 --json | jq '.bugs[].title'

# Include all flags (bugs + analysis suggestions)
devin-bugs owner/repo#46 --all

# Pipe to another tool
devin-bugs owner/repo#46 --json | jq '.bugs[] | select(.severity == "severe")'

# Skip browser, use token directly
DEVIN_TOKEN=eyJ... devin-bugs owner/repo#46
```

## Authentication

On first run, the CLI opens your browser to a local page with instructions:

1. Log in to [app.devin.ai](https://app.devin.ai) with GitHub
2. Paste a one-liner in the browser console (auto-copied from the instruction page)
3. The token is sent back to the CLI and cached

Subsequent runs use the cached token automatically. Tokens are stored at `~/.config/devin-bugs/token.json`.

For CI or headless environments, set `DEVIN_TOKEN` as an environment variable.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (API failure, network error, etc.) |
| `10` | Authentication required (non-interactive context) |

## How it works

The CLI reverse-engineers Devin's internal PR review API:

1. Authenticates via Devin's Auth0-based auth system
2. Fetches the review digest from `GET /api/pr-review/digest`
3. Parses review threads for Devin's "lifeguard" bug flags
4. Filters to unresolved, non-outdated items
5. Outputs formatted results

### API endpoints used

| Endpoint | Purpose |
|----------|---------|
| `GET pr-review/digest?pr_path=...` | Full review data with flags, threads, checks |
| `GET pr-review/info?pr_path=...` | PR metadata |
| `GET pr-review/jobs?pr_path=...` | Review job status |

## JSON output schema

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

## Project structure

```
src/
  cli.ts          Entry point, arg parsing, orchestration
  auth.ts         Browser-based auth + token caching
  api.ts          Devin API client with retry on 401
  watch.ts        --watch poll loop with stage progress
  filter.ts       Bug extraction from digest response
  format.ts       Terminal (ANSI) and JSON formatters
  parse-pr.ts     PR URL/shorthand parser
  types.ts        TypeScript interfaces
  config.ts       Paths and constants
```

## Agent setup

To set up `devin-bugs` as a tool for Claude Code (or similar AI coding agents):

**1. Install the CLI globally:**

```bash
npm install -g devin-bugs
```

**2. Install the Claude Code skill:**

```bash
mkdir -p ~/.claude/skills/devin-bugs
curl -fsSL https://raw.githubusercontent.com/xCatalitY/devin-review-cli/main/.claude/skills/devin-bugs/SKILL.md \
  -o ~/.claude/skills/devin-bugs/SKILL.md
```

After installation, the `/devin-bugs` slash command is available in Claude Code. The skill teaches the agent to:
- Set `DEVIN_BUGS_NONINTERACTIVE=1` on every invocation (prevents browser hang)
- Handle exit code 10 (auth required) by prompting the user to run `! devin-bugs --login`
- Parse the `{ status, bugs }` JSON envelope
- Interpret review status (running, completed, no_review, failed)
- Cross-reference bugs with local code files

## Disclaimer

This tool uses Devin's internal API, which is not officially documented or supported. It may break if Devin changes their API. Use at your own risk.

## License

MIT
