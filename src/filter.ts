import type { DigestResponse, ReviewThread, ReviewComment, LifeguardFlag } from "./types.js";

// ---------------------------------------------------------------------------
// Parse hidden_header: <!-- devin-review-comment {JSON} -->
// ---------------------------------------------------------------------------

interface HiddenHeaderData {
  id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  side: "LEFT" | "RIGHT";
}

function parseHiddenHeader(header: string | null | undefined): HiddenHeaderData | null {
  if (!header) return null;

  // Format: <!-- devin-review-comment {"id":"...","file_path":"...","start_line":N,...} -->
  const match = header.match(/<!--\s*devin-review-comment\s*(\{.+\})\s*-->/);
  if (!match?.[1]) return null;

  try {
    const data = JSON.parse(match[1]) as Record<string, unknown>;
    return {
      id: String(data.id ?? ""),
      file_path: String(data.file_path ?? ""),
      start_line: typeof data.start_line === "number" ? data.start_line : 0,
      end_line: typeof data.end_line === "number" ? data.end_line : 0,
      side: data.side === "LEFT" ? "LEFT" : "RIGHT",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parse bug body: emoji severity + bold title + description
// ---------------------------------------------------------------------------

function parseSeverity(body: string): string {
  if (body.startsWith("🔴")) return "severe";
  if (body.startsWith("🟡")) return "warning";
  if (body.startsWith("🟢")) return "info";
  return "info";
}

function parseTitle(body: string): string {
  const match = body.match(/\*\*(.+?)\*\*/);
  return match?.[1]?.trim() ?? body.split("\n")[0]?.slice(0, 120).trim() ?? "";
}

function parseDescription(body: string): string {
  // Everything after the first line (title line)
  const lines = body.split("\n");
  return lines
    .slice(1)
    .join("\n")
    .trim();
}

function parseRecommendation(body: string): string {
  // Look for "Recommendation:" or "Fix:" or "→" sections
  const match = body.match(/(?:recommendation|suggested fix|fix):\s*(.+?)(?:\n\n|\n#+|\n🔴|\n🟡|$)/is);
  return match?.[1]?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Determine flag type from the comment body/id
// ---------------------------------------------------------------------------

function determineType(id: string, body: string): LifeguardFlag["type"] {
  if (id.startsWith("BUG_")) return "lifeguard-bug";
  if (id.startsWith("ANALYSIS_") || id.startsWith("INFO_")) return "lifeguard-analysis";

  // Fallback: check body for bug indicators
  const lower = body.toLowerCase();
  if (
    lower.includes("potential bug") ||
    lower.includes("🔴") ||
    lower.includes("bug:") ||
    lower.includes("race condition") ||
    lower.includes("vulnerability") ||
    lower.includes("double-charge") ||
    lower.includes("sql injection")
  ) {
    return "lifeguard-bug";
  }
  return "lifeguard-analysis";
}

// ---------------------------------------------------------------------------
// Extract a LifeguardFlag from a Devin review thread
// ---------------------------------------------------------------------------

function extractFlag(
  thread: ReviewThread,
  comment: ReviewComment
): LifeguardFlag | null {
  const header = parseHiddenHeader(comment.hidden_header);
  const body = comment.body ?? "";
  if (!body && !header) return null;

  const id = header?.id ?? String(comment.devin_review_id ?? "");
  const type = determineType(id, body);

  return {
    filePath: header?.file_path ?? "",
    startLine: header?.start_line ?? null,
    endLine: header?.end_line ?? null,
    side: header?.side ?? "RIGHT",
    title: parseTitle(body),
    description: parseDescription(body),
    severity: parseSeverity(body),
    recommendation: parseRecommendation(body),
    needsInvestigation: body.toLowerCase().includes("needs investigation"),
    type,
    isResolved: thread.is_resolved,
    isOutdated: thread.is_outdated,
    htmlUrl: comment.html_url ?? null,
  };
}

// ---------------------------------------------------------------------------
// Identify Devin review comments
// ---------------------------------------------------------------------------

function isDevinComment(comment: ReviewComment): boolean {
  return (
    comment.devin_review_id != null ||
    comment.hidden_header?.includes("devin-review-comment") === true ||
    comment.author?.login === "devin-ai-integration" ||
    comment.author?.login === "devin-ai-integration[bot]" ||
    comment.author?.login === "devin-ai[bot]"
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FilterOptions {
  /** Include lifeguard-analysis items, not just bugs */
  includeAnalysis?: boolean;
  /** Include resolved items */
  includeResolved?: boolean;
  /** Include outdated items */
  includeOutdated?: boolean;
}

/**
 * Extract all LifeguardFlags from a digest response.
 * Default: only unresolved, non-outdated bugs.
 */
export function extractFlags(
  digest: DigestResponse,
  opts?: FilterOptions
): LifeguardFlag[] {
  const flags: LifeguardFlag[] = [];

  for (const thread of digest.review_threads) {
    // Apply thread-level filters
    if (!opts?.includeResolved && thread.is_resolved) continue;
    if (!opts?.includeOutdated && thread.is_outdated) continue;

    // Extract from first Devin comment in the thread
    for (const comment of thread.comments) {
      if (!isDevinComment(comment)) continue;

      const flag = extractFlag(thread, comment);
      if (flag) {
        flags.push(flag);
        break; // One flag per thread
      }
    }
  }

  // Filter by type
  if (!opts?.includeAnalysis) {
    return flags.filter((f) => f.type === "lifeguard-bug");
  }

  return flags;
}
