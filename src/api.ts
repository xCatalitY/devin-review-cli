import { DEVIN_API_BASE } from "./config.js";
import type { DigestResponse, ReviewStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class AuthExpiredError extends Error {
  constructor() {
    super("Authentication expired. Re-authenticating...");
    this.name = "AuthExpiredError";
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Devin API error ${status}: ${body}`);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// Generic request helper
// ---------------------------------------------------------------------------

async function apiRequest<T>(path: string, token: string): Promise<T> {
  const url = `${DEVIN_API_BASE}/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new AuthExpiredError();
    }
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function fetchDigest(
  prPath: string,
  token: string
): Promise<DigestResponse> {
  return apiRequest<DigestResponse>(
    `pr-review/digest?pr_path=${encodeURIComponent(prPath)}`,
    token
  );
}

export async function fetchPRInfo(
  prPath: string,
  token: string
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(
    `pr-review/info?pr_path=${encodeURIComponent(prPath)}`,
    token
  );
}

// ---------------------------------------------------------------------------
// Job status types
// ---------------------------------------------------------------------------

export interface JobVersion {
  id: string;
  created_at: string;
  metadata: {
    completed: string[];
    is_finished: boolean;
  };
}

export interface ReviewJob {
  job_id: string;
  status: string; // "completed" | "running" | "pending" | "failed"
  pr_number: number;
  commit_sha: string;
  job_type: string;
  created_at: string;
  updated_at: string;
  versions: JobVersion[];
}

export interface JobsResponse {
  jobs: ReviewJob[];
}

export async function fetchJobs(
  prPath: string,
  token: string
): Promise<JobsResponse> {
  return apiRequest<JobsResponse>(
    `pr-review/jobs?pr_path=${encodeURIComponent(prPath)}`,
    token
  );
}

/**
 * Get the review status for display purposes.
 * Returns a human-readable status based on the latest job.
 */
export function getReviewStatus(jobs: JobsResponse): ReviewStatus {
  if (jobs.jobs.length === 0) {
    return { status: "no_review", message: "No Devin review has been triggered for this PR." };
  }

  // Latest job is first (sorted by created_at desc from API, but let's sort to be safe)
  const latest = jobs.jobs.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0]!;

  const allStages = ["lifeguard", "groups", "copy_detection", "display_info"];

  if (latest.status === "completed") {
    const lastVersion = latest.versions[latest.versions.length - 1];
    if (lastVersion?.metadata.is_finished) {
      return {
        status: "completed",
        message: "Devin review complete.",
        stages: { completed: allStages, total: allStages },
      };
    }
  }

  if (latest.status === "running" || (latest.status === "completed" && latest.versions.length > 0)) {
    const lastVersion = latest.versions[latest.versions.length - 1];
    const completed = lastVersion?.metadata.completed ?? [];
    const stageLabels: Record<string, string> = {
      lifeguard: "Bug detection",
      groups: "File grouping",
      copy_detection: "Copy detection",
      display_info: "Finalizing",
    };

    if (!lastVersion?.metadata.is_finished) {
      const currentStage = allStages.find((s) => !completed.includes(s));
      const currentLabel = currentStage ? stageLabels[currentStage] ?? currentStage : "Processing";
      return {
        status: "running",
        message: `Devin review in progress: ${currentLabel} (${completed.length}/${allStages.length} stages)`,
        stages: { completed, total: allStages },
      };
    }

    return {
      status: "completed",
      message: "Devin review complete.",
      stages: { completed, total: allStages },
    };
  }

  if (latest.status === "failed") {
    return { status: "failed", message: "Devin review failed." };
  }

  return {
    status: "running",
    message: "Devin review pending...",
    stages: { completed: [], total: allStages },
  };
}
