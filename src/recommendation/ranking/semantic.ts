import type { RankingInput } from "./contracts";
import type { RankingConfig } from "./config";
import { positiveTopics } from "./features";
import {
  candidateText,
  clamp,
  compareText,
  normalizeText,
} from "./textSimilarity";

export class InvalidRankingVectors extends Error {}
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Ranking cancelled");
    error.name = "AbortError";
    throw error;
  }
}
export function validateVectors(
  vectors: unknown,
  count: number,
  dimension?: number,
): asserts vectors is number[][] {
  if (!Array.isArray(vectors) || vectors.length !== count || !count)
    throw new InvalidRankingVectors();
  const size = dimension ?? vectors[0]?.length;
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new InvalidRankingVectors();
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== size)
      throw new InvalidRankingVectors();
    for (let i = 0; i < size; i++)
      if (typeof vector[i] !== "number" || !Number.isFinite(vector[i]))
        throw new InvalidRankingVectors();
  }
}
/** Rescale first so even very large finite coordinates cannot overflow. */
export function cosine(a: number[], b: number[]): number {
  validateVectors([a, b], 2);
  const scaleA = a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const scaleB = b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (!scaleA || !scaleB) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] / scaleA,
      y = b[i] / scaleB;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return Math.max(-1, Math.min(1, dot / Math.sqrt(normA * normB)));
}
export const semanticRelevance = (a: number[], b: number[]): number =>
  clamp(cosine(a, b));
export function profileText(
  input: RankingInput,
  config: RankingConfig,
): string {
  const { profile, focus } = input;
  return [
    ...(focus ? [focus] : []),
    ...positiveTopics(profile)
      .slice(0, config.maxSemanticTopics)
      .map((t) => t.label),
    ...[...profile.explicitPreferences.positiveTopics]
      .filter(
        (p) =>
          p.strength > 0 &&
          !profile.explicitPreferences.negativeTopics.some(
            (n) => normalizeText(n.label) === normalizeText(p.label),
          ),
      )
      .sort((a, b) => b.strength - a.strength || compareText(a.id, b.id))
      .slice(0, config.maxSemanticPositivePrefs)
      .map((p) => p.label),
    ...[...profile.representativePapers]
      .filter((p) => p.weight > 0)
      .sort((a, b) => b.weight - a.weight || compareText(a.itemId, b.itemId))
      .slice(0, config.maxSemanticRepresentativePapers)
      .map((p) => p.title),
  ]
    .join("\n")
    .slice(0, config.maxSemanticProfileChars);
}
/** One request deadline; cancellation returns promptly even for a broken provider. */
export async function computeSemantic(
  input: RankingInput,
  config: RankingConfig,
): Promise<{ vectors?: number[][]; warning?: string }> {
  checkCancelled(input.signal);
  if (!input.semanticProvider)
    return { warning: "ranking_semantic_unavailable" };
  const profile = profileText(input, config);
  if (!profile.trim()) return { warning: "ranking_semantic_unavailable" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  try {
    const stopped = new Promise<never>((_, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error("cancelled"));
      };
      input.signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("timeout"));
      }, config.semanticTimeoutMs);
    });
    const work = async () => {
      const texts = [
        profile,
        ...input.candidates.map((c) =>
          candidateText(c, config.maxSemanticCandidateChars),
        ),
      ];
      const vectors: number[][] = [];
      let model: string | undefined;
      for (let i = 0; i < texts.length; i += config.semanticBatchSize) {
        checkCancelled(controller.signal);
        const batch = texts.slice(i, i + config.semanticBatchSize);
        const result = await input.semanticProvider!.embed(
          batch,
          controller.signal,
        );
        checkCancelled(controller.signal);
        if (
          !result ||
          typeof result.model !== "string" ||
          !result.model.trim() ||
          (model !== undefined && model !== result.model)
        )
          throw new InvalidRankingVectors();
        model = result.model;
        validateVectors(result.vectors, batch.length, vectors[0]?.length);
        vectors.push(...result.vectors.map((v) => [...v]));
      }
      return vectors;
    };
    const vectors = await Promise.race([stopped, work()]);
    checkCancelled(input.signal);
    return { vectors };
  } catch (error) {
    checkCancelled(input.signal);
    return {
      warning:
        error instanceof InvalidRankingVectors
          ? "ranking_semantic_invalid_vectors"
          : "ranking_semantic_failed_fallback",
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}
