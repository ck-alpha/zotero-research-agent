/** Engineering defaults, not calibrated scientific relevance estimates. */
export const RANKING_CONFIG = Object.freeze({
  semanticWeight: 0.45,
  lexicalWeight: 0.3,
  graphWeight: 0.15,
  recencyWeight: 0.1,
  mmrLambda: 0.8,
  recencyHalfLifeYears: 3,
  focusLexicalWeight: 0.6,
  matchedTopicThreshold: 0.5,
  maxLexicalCandidateChars: 1200,
  maxSemanticTopics: 12,
  maxSemanticPositivePrefs: 10,
  maxSemanticRepresentativePapers: 6,
  maxSemanticProfileChars: 4000,
  maxSemanticCandidateChars: 1200,
  semanticBatchSize: 32,
  semanticTimeoutMs: 30000,
  maxMatchedTopics: 8,
  toolDefaultTopK: 10,
  toolMaxTopK: 20,
  toolAbstractSnippetChars: 500,
  toolTitleChars: 300,
  toolMaxAuthors: 20,
  toolAuthorChars: 120,
});
export type RankingConfig = { [K in keyof typeof RANKING_CONFIG]: number };
export function resolveRankingConfig(
  overrides: Partial<RankingConfig> = {},
): RankingConfig {
  const config = { ...RANKING_CONFIG, ...overrides };
  const fractions = new Set([
    "semanticWeight",
    "lexicalWeight",
    "graphWeight",
    "recencyWeight",
    "mmrLambda",
    "focusLexicalWeight",
    "matchedTopicThreshold",
  ]);
  for (const key of Object.keys(config) as (keyof RankingConfig)[]) {
    const value = config[key];
    if (
      !(key in RANKING_CONFIG) ||
      !Number.isFinite(value) ||
      (fractions.has(key)
        ? value < 0 || value > 1
        : key === "recencyHalfLifeYears"
          ? value <= 0
          : !Number.isSafeInteger(value) || value <= 0)
    )
      throw new TypeError(`Invalid ranking config: ${key}`);
  }
  // Lexical and graph are the features always available, even for undated papers.
  if (
    config.lexicalWeight + config.graphWeight <= 0 ||
    config.toolDefaultTopK > config.toolMaxTopK
  )
    throw new TypeError("Invalid ranking weight/topK configuration");
  return Object.freeze(config);
}
