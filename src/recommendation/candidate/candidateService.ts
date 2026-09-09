import type {
  CandidateDiscoveryProvider,
  CandidateProvenance,
  RecommendationCandidate,
} from "../domain/candidate";
import {
  assertResearchProfile,
  assertRecommendationCandidate,
} from "../domain/validation";
import { profileIdForLibrary } from "../profile/identity";
import {
  resolveCandidateLimits,
  type CandidateDiscoveryLimits,
} from "./config";
import type {
  CandidateDiscoveryInput,
  CandidateDiscoveryResult,
  LiteratureDiscoveryBatch,
  LiteratureDiscoverySource,
} from "./contracts";
import { buildQueryPlan } from "./queryRecall";
import { buildSeedPlan } from "./seedRecall";
import { normalizeExternalPaper } from "./normalize";
import { buildNovelCandidatePool } from "./deduplicate";

function cancelled(): Error {
  const error = new Error("Candidate discovery cancelled");
  error.name = "AbortError";
  return error;
}

/** Prompt cancellation even when an injected dependency does not honor abort. */
function abortable<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal?.removeEventListener("abort", abort);
      reject(cancelled());
    };
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal?.aborted) throw cancelled();
        return operation();
      })
      .then(resolve, reject)
      .finally(() => signal?.removeEventListener("abort", abort));
  });
}

export class CandidateDiscoveryService {
  private readonly limits: CandidateDiscoveryLimits;
  private readonly now: () => number;

  constructor(
    private readonly source: LiteratureDiscoverySource,
    options: {
      limits?: Partial<CandidateDiscoveryLimits>;
      now?: () => number;
    } = {},
  ) {
    this.limits = resolveCandidateLimits(options.limits);
    this.now = options.now ?? Date.now;
  }

  async discover(
    input: CandidateDiscoveryInput,
  ): Promise<CandidateDiscoveryResult> {
    const { libraryID, profile, snapshot, signal } = input;
    if (signal?.aborted) throw cancelled();
    const profileId = profileIdForLibrary(libraryID);
    assertResearchProfile(profile);
    if (profile.profileId !== profileId || snapshot.libraryID !== libraryID)
      throw new Error("Candidate profile/library scope mismatch");
    const ids = new Set<string>();
    for (const paper of snapshot.papers) {
      const suffix = paper.itemId?.slice(`${profileId}:item:`.length);
      if (
        !paper.itemId?.startsWith(`${profileId}:item:`) ||
        !/^[1-9]\d*$/.test(suffix) ||
        !Number.isSafeInteger(Number(suffix)) ||
        ids.has(paper.itemId)
      )
        throw new Error("Candidate library paper scope or identity invalid");
      ids.add(paper.itemId);
      if (
        typeof paper.title !== "string" ||
        !paper.title.trim() ||
        !Array.isArray(paper.authors) ||
        paper.authors.some((author) => typeof author !== "string")
      )
        throw new Error("Candidate library metadata invalid");
    }
    const queryPlan = buildQueryPlan(profile, input.focus, this.limits);
    const seedPlan = buildSeedPlan(profile, snapshot, this.limits);
    const routes = [
      ...queryPlan.queries.map((query) => ({
        kind: "query" as const,
        limit: this.limits.resultsPerQuery,
        run: () =>
          this.source.search({
            query: query.query,
            limit: this.limits.resultsPerQuery,
            signal,
          }),
        provenance: (
          provider: CandidateDiscoveryProvider,
          providerRank: number,
        ): CandidateProvenance => ({
          route: "profile_query",
          provider,
          providerRank,
          ...query,
        }),
      })),
      ...seedPlan.seeds.map((seed) => ({
        kind: "seed" as const,
        limit: this.limits.resultsPerSeed,
        run: () =>
          this.source.related({
            doi: seed.doi,
            limit: this.limits.resultsPerSeed,
            signal,
          }),
        provenance: (
          provider: CandidateDiscoveryProvider,
          providerRank: number,
        ): CandidateProvenance => ({
          route: "seed_recommendation",
          provider,
          providerRank,
          seedPaperId: seed.seedPaperId,
        }),
      })),
    ];
    const batches: Array<LiteratureDiscoveryBatch | undefined> = new Array(
      routes.length,
    );
    let next = 0;
    const worker = async () => {
      while (next < routes.length) {
        if (signal?.aborted) throw cancelled();
        const index = next++;
        try {
          const batch = await abortable(routes[index].run, signal);
          if (
            !batch ||
            !Array.isArray(batch.papers) ||
            !Array.isArray(batch.warnings)
          )
            throw new Error("Invalid literature batch");
          batches[index] = batch;
        } catch {
          if (signal?.aborted) throw cancelled();
          // Per-route failure is recorded below in stable plan order.
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(routes.length, this.limits.maxConcurrentRequests) },
        worker,
      ),
    );
    if (signal?.aborted) throw cancelled();
    if (routes.length && !batches.some(Boolean))
      throw new Error(
        "Candidate discovery failed: all recall dependencies unavailable",
      );
    const warnings = [...queryPlan.warnings, ...seedPlan.warnings];
    const diagnostics = {
      queriesPlanned: queryPlan.queries.length,
      queriesSucceeded: 0,
      queriesFailed: 0,
      seedsPlanned: seedPlan.seeds.length,
      seedsSucceeded: 0,
      seedsFailed: 0,
      seedsSkippedWithoutDoi: seedPlan.seedsSkippedWithoutDoi,
      seedsSkippedMissingPaper: seedPlan.seedsSkippedMissingPaper,
      rawCandidateCount: 0,
      invalidCandidateCount: 0,
      existingLibraryExcluded: 0,
      duplicateCandidatesMerged: 0,
      finalCandidateCount: 0,
      poolTruncated: false,
    };
    const candidates: RecommendationCandidate[] = [];
    routes.forEach((route, index) => {
      const batch = batches[index];
      if (!batch) {
        diagnostics[route.kind === "query" ? "queriesFailed" : "seedsFailed"]++;
        warnings.push(`candidate_${route.kind}_route_failed`);
        return;
      }
      diagnostics[
        route.kind === "query" ? "queriesSucceeded" : "seedsSucceeded"
      ]++;
      warnings.push(
        ...batch.warnings
          .filter(
            (warning) =>
              typeof warning === "string" &&
              /^candidate_[a-z_]{1,80}$/.test(warning),
          )
          .slice(0, 16),
      );
      diagnostics.rawCandidateCount += batch.papers.length;
      if (batch.papers.length > route.limit)
        warnings.push("candidate_provider_results_truncated");
      batch.papers.slice(0, route.limit).forEach((paper, rank) => {
        const provider = paper?.provider;
        if (!["openalex", "arxiv", "europepmc"].includes(provider)) {
          diagnostics.invalidCandidateCount++;
          return;
        }
        const candidate = normalizeExternalPaper(
          paper,
          route.provenance(provider, rank + 1),
        );
        if (!candidate) diagnostics.invalidCandidateCount++;
        else candidates.push(candidate);
      });
    });
    const pool = buildNovelCandidatePool(
      candidates,
      snapshot,
      this.limits.maxCandidatePool,
    );
    Object.assign(diagnostics, {
      existingLibraryExcluded: pool.existingLibraryExcluded,
      duplicateCandidatesMerged: pool.duplicateCandidatesMerged,
      poolTruncated: pool.poolTruncated,
      finalCandidateCount: pool.candidates.length,
    });
    if (diagnostics.invalidCandidateCount)
      warnings.push("candidate_invalid_paper_skipped");
    if (pool.poolTruncated) warnings.push("candidate_pool_truncated");
    if (!routes.length) warnings.push("candidate_no_recall_inputs");
    pool.candidates.forEach((candidate) =>
      assertRecommendationCandidate(candidate),
    );
    const generatedAt = this.now();
    if (!Number.isSafeInteger(generatedAt) || generatedAt < 0)
      throw new Error("Invalid candidate generation time");
    return {
      profileId,
      profileVersion: profile.version,
      generatedAt,
      focus: queryPlan.focus,
      candidates: pool.candidates,
      diagnostics,
      warnings: [...new Set(warnings)],
    };
  }
}
