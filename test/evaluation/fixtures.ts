import type { RecommendationCandidate } from "../../src/recommendation/domain/candidate";
import type { RecommendationEvaluationCase } from "../../src/recommendation/evaluation/contracts";
import { makeProfile, makeCandidate } from "../helpers/recommendationFixtures";

export function benchmarkCases(): RecommendationEvaluationCase[] {
  const profile = makeProfile();
  profile.topics[0].label = "Agentic Recommendation";
  profile.explicitPreferences = { positiveTopics: [], negativeTopics: [] };
  const candidate = (id: string, text: string): RecommendationCandidate => ({
    ...makeCandidate(),
    candidateId: id,
    title: text,
    abstract: text,
    scores: {},
  });
  const base = {
    profile,
    now: Date.UTC(2026, 8, 9),
    topK: 1,
    knownCandidateIds: [],
  };
  const strong = candidate("A", "Agentic Recommendation methods");
  const weak = candidate("B", "Marine ecology");
  const negativeProfile = JSON.parse(JSON.stringify(profile));
  negativeProfile.explicitPreferences.negativeTopics = [
    {
      id: "negative",
      label: "Prompting",
      strength: 1,
      createdAt: 100,
      updatedAt: 100,
    },
  ];
  const missing = candidate("C", "Agentic Recommendation methods");
  delete missing.abstract;
  return [
    {
      ...base,
      id: "A-strong-match",
      candidates: [weak, strong],
      expectedSignals: {
        preferredCandidateIds: ["A"],
        rejectedCandidateIds: ["B"],
      },
    },
    {
      ...base,
      id: "B-negative-preference",
      profile: negativeProfile,
      candidates: [strong, candidate("Y", "Agentic Recommendation Prompting")],
      expectedSignals: {
        preferredCandidateIds: ["A"],
        rejectedCandidateIds: ["Y"],
      },
    },
    {
      ...base,
      id: "C-evidence-unavailable",
      candidates: [missing],
      expectedSignals: { preferredCandidateIds: ["C"] },
    },
  ];
}
