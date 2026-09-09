import type { RecommendedPaper } from "../domain/recommendation";
import type { RankingConfig } from "./config";
import { compareBase } from "./scoring";
import { candidateText, jaccard, tokens } from "./textSimilarity";
import { semanticRelevance } from "./semantic";

/** Input is already base-sorted; strict improvement preserves the base tie-break. */
export function diversify(
  papers: RecommendedPaper[],
  topK: number,
  config: RankingConfig,
  vectors?: ReadonlyMap<string, number[]>,
): RecommendedPaper[] {
  const remaining = [...papers].sort(compareBase);
  const tokenSets = new Map(
    papers.map((p) => [
      p.candidateId,
      tokens(candidateText(p, config.maxLexicalCandidateChars)),
    ]),
  );
  const selected: RecommendedPaper[] = [];
  const similarities = new Map<string, number>();
  while (remaining.length && selected.length < topK) {
    let bestIndex = 0,
      bestUtility = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const paper = remaining[i];
      let similarity = similarities.get(paper.candidateId) ?? 0;
      const last = selected[selected.length - 1];
      if (last) {
        const a = vectors?.get(paper.candidateId),
          b = vectors?.get(last.candidateId);
        similarity = Math.max(
          similarity,
          a && b
            ? semanticRelevance(a, b)
            : jaccard(
                tokenSets.get(paper.candidateId)!,
                tokenSets.get(last.candidateId)!,
              ),
        );
      }
      similarities.set(paper.candidateId, similarity);
      const utility =
        config.mmrLambda * paper.scores.baseScore! -
        (1 - config.mmrLambda) * similarity;
      if (utility > bestUtility) {
        bestIndex = i;
        bestUtility = utility;
      }
    }
    const paper = remaining.splice(bestIndex, 1)[0];
    selected.push({
      ...paper,
      rank: selected.length + 1,
      scores: {
        ...paper.scores,
        diversity: similarities.get(paper.candidateId) ?? 0,
        finalScore: bestUtility,
      },
    });
  }
  return selected;
}
