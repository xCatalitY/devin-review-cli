import type { LifeguardFlag, ParsedPR } from "./types.js";

// ---------------------------------------------------------------------------
// ANSI color helpers (no dependency)
// ---------------------------------------------------------------------------

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
};

function severityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case "severe":
    case "critical":
      return c.red;
    case "warning":
      return c.yellow;
    default:
      return c.cyan;
  }
}

function severityBadge(severity: string): string {
  const upper = severity.toUpperCase();
  switch (severity.toLowerCase()) {
    case "severe":
    case "critical":
      return `${c.bgRed}${c.white}${c.bold} ${upper} ${c.reset}`;
    case "warning":
      return `${c.bgYellow}${c.bold} ${upper} ${c.reset}`;
    default:
      return `${c.bgBlue}${c.white} ${upper} ${c.reset}`;
  }
}

function typeBadge(type: LifeguardFlag["type"]): string {
  if (type === "lifeguard-bug") {
    return `${c.red}${c.bold}BUG${c.reset}`;
  }
  return `${c.cyan}${c.bold}INFO${c.reset}`;
}

// ---------------------------------------------------------------------------
// Terminal formatter
// ---------------------------------------------------------------------------

function formatLocation(flag: LifeguardFlag): string {
  if (!flag.filePath) return "";
  const file = `${c.cyan}${flag.filePath}${c.reset}`;
  if (flag.startLine == null) return file;
  const line =
    flag.endLine != null && flag.endLine !== flag.startLine
      ? `${c.dim}:${flag.startLine}-${flag.endLine}${c.reset}`
      : `${c.dim}:${flag.startLine}${c.reset}`;
  return `${file}${line}`;
}

function wrapText(text: string, indent: number, maxWidth: number): string {
  const pad = " ".repeat(indent);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth - indent) {
      lines.push(pad + current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(pad + current);
  return lines.join("\n");
}

export function formatTerminal(flags: LifeguardFlag[], pr: ParsedPR): string {
  const lines: string[] = [];

  // Header
  const bugCount = flags.filter((f) => f.type === "lifeguard-bug").length;
  const analysisCount = flags.filter((f) => f.type === "lifeguard-analysis").length;

  const parts: string[] = [];
  if (bugCount > 0) parts.push(`${c.red}${c.bold}${bugCount} bug${bugCount === 1 ? "" : "s"}${c.reset}`);
  if (analysisCount > 0) parts.push(`${c.cyan}${analysisCount} suggestion${analysisCount === 1 ? "" : "s"}${c.reset}`);

  if (parts.length === 0) {
    lines.push(`\n  ${c.green}${c.bold}No unresolved bugs${c.reset} in ${c.dim}${pr.owner}/${pr.repo}#${pr.number}${c.reset}\n`);
    return lines.join("\n");
  }

  lines.push(
    `\n  ${parts.join(", ")} in ${c.dim}${pr.owner}/${pr.repo}#${pr.number}${c.reset}\n`
  );

  // Each flag
  for (const flag of flags) {
    const badge = typeBadge(flag.type);
    const location = formatLocation(flag);
    const sev = severityBadge(flag.severity);

    lines.push(`  ${badge}  ${location}  ${sev}`);

    if (flag.title) {
      lines.push(`  ${c.bold}${c.white}${flag.title}${c.reset}`);
    }

    // Show description (first paragraph, stripped of markdown/HTML noise)
    if (flag.description && flag.description !== flag.title) {
      const desc = flag.description
        .replace(/<details>[\s\S]*?<\/details>/g, "") // remove <details> blocks
        .replace(/<!--[\s\S]*?-->/g, "") // remove HTML comments
        .replace(/^\[.*?\]\(.*?\)$/gm, "") // remove markdown links on own line
        .replace(/<a[\s\S]*?<\/a>/g, "") // remove <a> tags
        .replace(/<picture>[\s\S]*?<\/picture>/g, "") // remove <picture> tags
        .replace(/<img[^>]*>/g, "") // remove <img> tags
        .replace(/^---\s*$/gm, "") // remove horizontal rules
        .replace(/^\*Was this helpful\?.*$/gm, "") // remove feedback prompt
        .replace(/^#+\s*.+$/gm, "") // remove headings
        .replace(/\*\*(.+?)\*\*/g, "$1") // remove bold markers
        .replace(/`([^`]+)`/g, "$1") // remove inline code markers
        .trim()
        .split("\n\n")[0]! // first paragraph only
        .split("\n")
        .filter((l) => l.trim())
        .join(" ")
        .trim();

      if (desc) {
        lines.push(wrapText(`${c.dim}${desc}${c.reset}`, 2, 100));
      }
    }

    if (flag.recommendation) {
      lines.push(
        `  ${c.green}→ ${flag.recommendation}${c.reset}`
      );
    }

    lines.push(""); // blank line between flags
  }

  return lines.join("\n");
}

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
  const lines: string[] = [];
  const prRef = `${c.dim}${pr.owner}/${pr.repo}#${pr.number}${c.reset}`;

  const stageLabels: Record<string, string> = {
    lifeguard: "Bug detection",
    groups: "File grouping",
    copy_detection: "Copy detection",
    display_info: "Finalizing",
  };

  switch (status.status) {
    case "no_review":
      lines.push(`\n  ${c.yellow}No Devin review${c.reset} for ${prRef}`);
      lines.push(`  ${c.dim}Devin hasn't been triggered on this PR yet.${c.reset}\n`);
      break;

    case "running": {
      const stages = status.stages;
      lines.push(`\n  ${c.yellow}${c.bold}Devin review in progress${c.reset} for ${prRef}\n`);

      if (stages) {
        for (const stage of stages.total) {
          const done = stages.completed.includes(stage);
          const label = stageLabels[stage] ?? stage;
          const icon = done ? `${c.green}✓${c.reset}` : `${c.yellow}○${c.reset}`;
          lines.push(`  ${icon} ${done ? c.dim : c.white}${label}${c.reset}`);
        }
        lines.push("");
      }

      lines.push(`  ${c.dim}Bugs will appear once the review completes.${c.reset}\n`);
      break;
    }

    case "completed":
      lines.push(`\n  ${c.green}${c.bold}No unresolved bugs${c.reset} in ${prRef}`);
      lines.push(`  ${c.dim}Devin review complete — all clear.${c.reset}\n`);
      break;

    case "failed":
      lines.push(`\n  ${c.red}Devin review failed${c.reset} for ${prRef}`);
      lines.push(`  ${c.dim}The review job encountered an error.${c.reset}\n`);
      break;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON formatter
// ---------------------------------------------------------------------------

export function formatJSON(flags: LifeguardFlag[]): string {
  return JSON.stringify(flags, null, 2);
}
