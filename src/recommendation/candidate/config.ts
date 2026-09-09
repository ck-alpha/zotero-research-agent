export const CANDIDATE_DISCOVERY_LIMITS = Object.freeze({
  maxQueries: 5,
  maxSeeds: 4,
  resultsPerQuery: 12,
  resultsPerSeed: 8,
  maxConcurrentRequests: 3,
  maxCandidatePool: 80,
  maxFocusChars: 300,
  toolDefaultLimit: 30,
  toolMaxLimit: 50,
  toolAbstractSnippetChars: 400,
  toolTitleChars: 300,
  toolMaxAuthors: 20,
  toolAuthorChars: 120,
});

export type CandidateDiscoveryLimits = {
  [K in keyof typeof CANDIDATE_DISCOVERY_LIMITS]: number;
};

/** Callers can reduce budgets, but cannot silently expand production limits. */
export function resolveCandidateLimits(
  overrides: Partial<CandidateDiscoveryLimits> = {},
): CandidateDiscoveryLimits {
  const limits = { ...CANDIDATE_DISCOVERY_LIMITS, ...overrides };
  for (const key of Object.keys(limits) as (keyof CandidateDiscoveryLimits)[]) {
    if (
      !(key in CANDIDATE_DISCOVERY_LIMITS) ||
      !Number.isSafeInteger(limits[key]) ||
      limits[key] <= 0 ||
      limits[key] > CANDIDATE_DISCOVERY_LIMITS[key]
    )
      throw new TypeError(`Invalid candidate discovery limit: ${key}`);
  }
  return limits;
}
