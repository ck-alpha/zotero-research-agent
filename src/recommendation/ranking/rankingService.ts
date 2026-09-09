import {
  assertResearchProfile,
  assertRecommendationCandidate,
} from "../domain/validation";
import type { RecommendedPaper } from "../domain/recommendation";
import { normalizeCandidateFocus } from "../candidate/queryRecall";
import { resolveRankingConfig, type RankingConfig } from "./config";
import type { RankingInput, RankingResult } from "./contracts";
import { computeFeatures } from "./features";
import { computeSemantic, checkCancelled, semanticRelevance } from "./semantic";
import { baseScore, compareBase } from "./scoring";
import { diversify } from "./diversity";
import { compareText } from "./textSimilarity";

export class RankingService {
  private readonly config: RankingConfig;
  constructor(overrides: Partial<RankingConfig> = {}) {
    this.config = resolveRankingConfig(overrides);
  }
  async rank(input: RankingInput): Promise<RankingResult> {
    checkCancelled(input.signal);
    assertResearchProfile(input.profile);
    if (
      !Number.isSafeInteger(input.now) ||
      input.now < 0 ||
      !Number.isFinite(new Date(input.now).getTime())
    )
      throw new TypeError("Invalid ranking time");
    if (!Array.isArray(input.candidates))
      throw new TypeError("Invalid ranking candidates");
    const ids = new Set<string>();
    for (const c of input.candidates) {
      assertRecommendationCandidate(c);
      if (ids.has(c.candidateId))
        throw new TypeError("Duplicate ranking candidate ID");
      ids.add(c.candidateId);
    }
    const topK = input.topK ?? this.config.toolDefaultTopK;
    if (
      !Number.isSafeInteger(topK) ||
      topK < 1 ||
      topK > this.config.toolMaxTopK
    )
      throw new TypeError("Invalid ranking topK");
    const focus = normalizeCandidateFocus(input.focus);
    // Snapshot inputs before await; batch order is independent of recall order.
    const profile = JSON.parse(
      JSON.stringify(input.profile),
    ) as typeof input.profile;
    const candidates = (
      JSON.parse(JSON.stringify(input.candidates)) as typeof input.candidates
    ).sort((a, b) => compareText(a.candidateId, b.candidateId));
    const semantic = candidates.length
      ? await computeSemantic(
          { ...input, focus, profile, candidates },
          this.config,
        )
      : {};
    checkCancelled(input.signal);
    const vectors = semantic.vectors;
    const papers: RecommendedPaper[] = candidates
      .map((candidate, i) => {
        const { matchedTopicIds, ...features } = computeFeatures(
          profile,
          candidate,
          focus,
          input.now,
          this.config,
        );
        const scores = {
          ...features,
          semantic: vectors
            ? semanticRelevance(vectors[0], vectors[i + 1])
            : undefined,
        };
        return {
          ...candidate,
          rank: 1,
          matchedTopicIds,
          scores: {
            ...scores,
            baseScore: baseScore(scores, this.config),
            finalScore: 0,
          },
        };
      })
      .sort(compareBase);
    checkCancelled(input.signal);
    const recommendations = diversify(
      papers,
      topK,
      this.config,
      vectors
        ? new Map(candidates.map((c, i) => [c.candidateId, vectors[i + 1]]))
        : undefined,
    );
    return {
      profileId: profile.profileId,
      profileVersion: profile.version,
      generatedAt: input.now,
      focus,
      recommendations,
      diagnostics: {
        inputCandidateCount: candidates.length,
        semanticRequested: Boolean(input.semanticProvider && candidates.length),
        semanticSucceeded: Boolean(vectors),
        ...(semantic.timedOut ? { semanticTimedOut: true } : {}),
        semanticCandidateCount: vectors ? candidates.length : 0,
        semanticFallback: Boolean(candidates.length && !vectors),
        topKRequested: topK,
        topKReturned: recommendations.length,
      },
      warnings: [
        ...(semantic.warning ? [semantic.warning] : []),
        ...(!candidates.length ? ["ranking_candidate_pool_empty"] : []),
      ],
    };
  }
}
