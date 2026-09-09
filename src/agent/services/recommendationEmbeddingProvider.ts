import {
  callEmbeddings,
  checkEmbeddingAvailability,
  getResolvedEmbeddingConfig,
} from "../../utils/llmClient";
import type { RankingEmbeddingProvider } from "../../recommendation/ranking/contracts";
import {
  checkCancelled,
  validateVectors,
} from "../../recommendation/ranking/semantic";

/** Batching/deadline belong to RankingService. This adapter uses only existing embedding settings. */
export function createRecommendationEmbeddingProvider():
  | RankingEmbeddingProvider
  | undefined {
  try {
    if (!checkEmbeddingAvailability()) return undefined;
    const config = getResolvedEmbeddingConfig();
    return {
      async embed(texts, signal) {
        checkCancelled(signal);
        if (getResolvedEmbeddingConfig().attemptKey !== config.attemptKey)
          throw new Error("ranking_embedding_configuration_changed");
        const vectors = await callEmbeddings([...texts], signal);
        checkCancelled(signal);
        if (getResolvedEmbeddingConfig().attemptKey !== config.attemptKey)
          throw new Error("ranking_embedding_configuration_changed");
        validateVectors(vectors, texts.length);
        return { model: config.model, vectors };
      },
    };
  } catch {
    return undefined;
  }
}
