import type {
  JobResultResponse,
  LifeguardAnalysis,
  LifeguardBug,
  LifeguardFlag,
} from "./types.js";

export interface FilterOptions {
  /** Include bugs Devin has self-resolved in a later commit (default: false). */
  includeResolved?: boolean;
  /** Skip analyses ("Flags") — only surface bugs (default: false). */
  bugsOnly?: boolean;
  /** Skip bugs — only surface analyses ("Flags") (default: false). */
  flagsOnly?: boolean;
}

function extractSuggestedEdit(edit: LifeguardBug["suggested_edit"]): string {
  if (!edit) return "";
  if (typeof edit === "string") return edit;
  if (typeof edit === "object" && typeof edit.prompt === "string") return edit.prompt;
  return "";
}

function bugToFlag(b: LifeguardBug): LifeguardFlag {
  return {
    id: b.id,
    filePath: b.file_path,
    startLine: typeof b.start_line === "number" ? b.start_line : null,
    endLine: typeof b.end_line === "number" ? b.end_line : null,
    side: b.side === "LEFT" ? "LEFT" : "RIGHT",
    title: b.title ?? "",
    description: b.description ?? "",
    severity: b.severity ?? "non-severe",
    recommendation: extractSuggestedEdit(b.suggested_edit),
    needsInvestigation: false,
    type: "lifeguard-bug",
    isResolved: b.resolved_by_devin === true,
    htmlUrl: null,
  };
}

function analysisToFlag(a: LifeguardAnalysis): LifeguardFlag {
  return {
    id: a.id,
    filePath: a.file_path,
    startLine: typeof a.start_line === "number" ? a.start_line : null,
    endLine: typeof a.end_line === "number" ? a.end_line : null,
    side: a.side === "LEFT" ? "LEFT" : "RIGHT",
    title: a.title ?? "",
    description: a.analysis ?? "",
    severity: a.needs_investigation ? "investigate" : "info",
    recommendation: "",
    needsInvestigation: a.needs_investigation === true,
    type: "lifeguard-analysis",
    isResolved: false,
    htmlUrl: null,
  };
}

/**
 * Extract the display-ready set of Lifeguard findings from a job-result.
 * By default: all unresolved bugs + all analyses (the UI's "Flags").
 */
export function extractFlags(
  jobResult: JobResultResponse,
  opts?: FilterOptions
): LifeguardFlag[] {
  const bugs = jobResult.lifeguard_result?.bugs ?? [];
  const analyses = jobResult.lifeguard_result?.analyses ?? [];
  const out: LifeguardFlag[] = [];

  if (!opts?.flagsOnly) {
    for (const b of bugs) {
      if (!opts?.includeResolved && b.resolved_by_devin) continue;
      out.push(bugToFlag(b));
    }
  }

  if (!opts?.bugsOnly) {
    for (const a of analyses) {
      out.push(analysisToFlag(a));
    }
  }

  return out;
}
