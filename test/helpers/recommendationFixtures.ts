import type { ResearchProfile } from "../../src/recommendation/domain/profile";
import type { RecommendationCandidate } from "../../src/recommendation/domain/candidate";
import type { RecommendationFeedback } from "../../src/recommendation/domain/feedback";
import type { RecommendationImpression } from "../../src/recommendation/domain/recommendation";

export function makeProfile(): ResearchProfile {
  return {
    profileId: "profile-1",
    version: 1,
    topics: [
      {
        id: "topic-1",
        label: "Recommendation",
        weight: 0.8,
        confidence: 0.4,
        sources: ["library", "explicit", "feedback"],
        lastEvidenceAt: 100,
        evidenceRefs: ["paper:ABC123"],
      },
    ],
    representativePapers: [
      {
        itemId: "paper:ABC123",
        title: "Seed paper",
        weight: 1,
        reason: "recent",
        addedAt: 100,
      },
    ],
    explicitPreferences: {
      positiveTopics: [
        {
          id: "pref-1",
          label: "Agents",
          strength: 1,
          createdAt: 100,
          updatedAt: 100,
        },
      ],
      negativeTopics: [
        {
          id: "pref-2",
          label: "Prompting",
          strength: 0.9,
          createdAt: 100,
          updatedAt: 100,
        },
      ],
    },
    embedding: {
      model: "test-embedding",
      dimension: 3,
      storageKey: "embedding:1",
      updatedAt: 100,
    },
    signalSummary: {
      libraryPaperCount: 1,
      positiveFeedbackCount: 0,
      negativeFeedbackCount: 0,
      explicitPreferenceCount: 2,
    },
    generatedAt: 100,
    updatedAt: 100,
  };
}

export function makeCandidate(): RecommendationCandidate {
  return {
    candidateId: "candidate-1",
    title: "Candidate paper",
    abstract: "Abstract",
    authors: ["A. Researcher"],
    publicationDate: "2026-09",
    doi: "10.1234/example",
    arxivId: "2609.00001",
    openAlexId: "W123",
    sources: ["profile_query", "seed_recommendation"],
    seedPaperIds: ["paper:ABC123"],
    scores: {
      semantic: 0.8,
      lexical: 2.4,
      graph: 0,
      recency: 1,
      feedback: -0.3,
      baseScore: 0.7,
      finalScore: 0.6,
    },
    evidence: { evidenceRefs: ["paper:ABC123#abstract"] },
  };
}

export function makeFeedback(): RecommendationFeedback {
  return {
    eventId: "event-1",
    paperId: "candidate-1",
    recommendationId: "rec-1",
    action: "positive",
    timestamp: 100,
  };
}

export function makeImpression(): RecommendationImpression {
  const candidate = makeCandidate();
  return {
    recommendationId: "rec-1",
    timestamp: 100,
    profileVersion: 1,
    candidates: [
      {
        ...candidate,
        rank: 1,
        scores: { ...candidate.scores, finalScore: 0.6 },
        matchedTopicIds: ["topic-1"],
      },
    ],
  };
}
