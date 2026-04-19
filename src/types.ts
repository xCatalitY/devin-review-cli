// ---------------------------------------------------------------------------
// PR reference
// ---------------------------------------------------------------------------

export interface ParsedPR {
  owner: string;
  repo: string;
  number: number;
  /** e.g. "github.com/owner/repo/pull/123" */
  prPath: string;
}

// ---------------------------------------------------------------------------
// Cached auth token
// ---------------------------------------------------------------------------

export interface CachedToken {
  accessToken: string;
  /** epoch ms when token was obtained */
  obtainedAt: number;
  /** epoch ms when token expires (from JWT `exp` claim) */
  expiresAt: number;
  /** Auth0 localStorage cache entries (may contain refresh tokens) */
  auth0Cache?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Extracted bug/flag
// ---------------------------------------------------------------------------

export interface LifeguardFlag {
  id: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  side: "LEFT" | "RIGHT";
  title: string;
  description: string;
  /** "severe" | "non-severe" for bugs; "investigate" | "info" for analyses */
  severity: string;
  recommendation: string;
  /** Only meaningful for analyses (type === "lifeguard-analysis") */
  needsInvestigation: boolean;
  type: "lifeguard-bug" | "lifeguard-analysis";
  /** True if Devin self-resolved the bug in a later commit. Always false for analyses. */
  isResolved: boolean;
  /** URL to the comment on GitHub (only for bugs that were posted as review comments). */
  htmlUrl: string | null;
}

// ---------------------------------------------------------------------------
// Job-result API response (pr-review/job-result/{jobId}/{versionId})
// ---------------------------------------------------------------------------

export interface LifeguardBug {
  id: string;
  title: string;
  description: string;
  file_path: string;
  start_line: number;
  end_line: number;
  side: "LEFT" | "RIGHT";
  severity: "severe" | "non-severe";
  resolved_by_devin: boolean;
  resolution_reason?: string | null;
  /** Observed shape: `{ type: "prompt", prompt: string }` or null. Kept as unknown for safety. */
  suggested_edit?: { type?: string; prompt?: string } | string | null;
  head_sha?: string;
  [key: string]: unknown;
}

export interface LifeguardAnalysis {
  id: string;
  title: string;
  analysis: string;
  file_path: string;
  start_line: number;
  end_line: number;
  side: "LEFT" | "RIGHT";
  needs_investigation: boolean;
  [key: string]: unknown;
}

export interface JobResultResponse {
  pr_metadata?: Record<string, unknown>;
  sections?: Array<{ title: string; text: string }>;
  lifeguard_result?: {
    bugs?: LifeguardBug[];
    analyses?: LifeguardAnalysis[];
    [key: string]: unknown;
  };
  lifeguard_status?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Review status (from jobs endpoint)
// ---------------------------------------------------------------------------

export interface ReviewStatus {
  status: "no_review" | "running" | "completed" | "failed";
  message: string;
  stages?: { completed: string[]; total: string[] };
}
