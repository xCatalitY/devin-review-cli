import { fetchJobs, getReviewStatus } from "./api.js";
import type { ParsedPR, ReviewStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class WatchTimeoutError extends Error {
  constructor(minutes: number) {
    super(`Timed out waiting for Devin review after ${minutes} minutes.`);
    this.name = "WatchTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// Stage labels (matches format.ts)
// ---------------------------------------------------------------------------

const stageLabels: Record<string, string> = {
  lifeguard: "Bug detection",
  groups: "File grouping",
  copy_detection: "Copy detection",
  display_info: "Finalizing",
};

// ---------------------------------------------------------------------------
// Watch loop
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;
const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Poll the jobs endpoint until the review completes (or times out).
 * Prints stage progress to stderr as stages complete.
 * Returns the final ReviewStatus.
 *
 * If the review is already completed/no_review/failed, returns immediately.
 */
export async function watchReview(
  prPath: string,
  token: string,
  pr: ParsedPR,
): Promise<ReviewStatus> {
  // Initial check
  const initialJobs = await fetchJobs(prPath, token);
  const initialStatus = getReviewStatus(initialJobs);

  if (initialStatus.status !== "running") {
    return initialStatus;
  }

  // Show header
  const prRef = `${pr.owner}/${pr.repo}#${pr.number}`;
  console.error(`\n  \x1b[33m\x1b[1m⟳ Watching Devin review for ${prRef}...\x1b[0m\n`);

  // Track which stages we've already printed
  const printedStages = new Set<string>(
    initialStatus.stages?.completed ?? []
  );

  // Print any stages already completed
  for (const stage of printedStages) {
    const label = stageLabels[stage] ?? stage;
    const total = initialStatus.stages?.total.length ?? 4;
    console.error(`  \x1b[32m✓\x1b[0m ${label} (${printedStages.size}/${total})`);
  }

  const startTime = Date.now();

  // Poll loop
  while (Date.now() - startTime < TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    let status: ReviewStatus;
    try {
      const jobs = await fetchJobs(prPath, token);
      status = getReviewStatus(jobs);
    } catch {
      // Transient failure — skip this tick
      continue;
    }

    if (status.status === "completed" || status.status === "failed") {
      // Print any remaining stages
      if (status.stages) {
        for (const stage of status.stages.total) {
          if (!printedStages.has(stage)) {
            printedStages.add(stage);
            const label = stageLabels[stage] ?? stage;
            const total = status.stages.total.length;
            console.error(`  \x1b[32m✓\x1b[0m ${label} (${printedStages.size}/${total})`);
          }
        }
      }
      console.error("");
      return status;
    }

    // Print new stage completions
    if (status.stages) {
      for (const stage of status.stages.completed) {
        if (!printedStages.has(stage)) {
          printedStages.add(stage);
          const label = stageLabels[stage] ?? stage;
          const total = status.stages.total.length;
          console.error(`  \x1b[32m✓\x1b[0m ${label} (${printedStages.size}/${total})`);
        }
      }
    }
  }

  throw new WatchTimeoutError(10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
