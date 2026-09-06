import type { ResearchProfile } from "./profile";
import type { RecommendationCandidate } from "./candidate";
import type { RecommendationFeedback } from "./feedback";
import type { RecommendationImpression } from "./recommendation";

// Follow the repository's lightweight runtime-validation style without importing
// Agent tools or the model registry into the independent recommendation domain.
type Check = (value: unknown, path: string) => void;

function invalid(path: string, expected: string): never {
  throw new TypeError(`${path}: expected ${expected}`);
}

export function assertNonEmptyId(
  value: unknown,
  path = "id",
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    invalid(path, "nonempty string");
  }
}

const text: Check = (value, path) => {
  if (typeof value !== "string") invalid(path, "string");
};
const finite: Check = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(path, "finite number");
  }
};
const unitInterval: Check = (value, path) => {
  finite(value, path);
  if ((value as number) < 0 || (value as number) > 1) {
    invalid(path, "number in [0, 1]");
  }
};
const integer =
  (minimum: number): Check =>
  (value, path) => {
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
      invalid(path, `safe integer >= ${minimum}`);
    }
  };
const timestamp = integer(0);
const version = integer(1);
const optional =
  (check: Check): Check =>
  (value, path) => {
    if (value !== undefined) check(value, path);
  };
const oneOf =
  (...values: string[]): Check =>
  (value, path) => {
    if (typeof value !== "string" || !values.includes(value)) {
      invalid(path, values.join(" | "));
    }
  };
const array =
  (check: Check, minimum = 0): Check =>
  (value, path) => {
    if (!Array.isArray(value) || value.length < minimum) invalid(path, "array");
    // forEach skips sparse slots; an indexed loop must reject those too.
    for (let i = 0; i < value.length; i++) check(value[i], `${path}[${i}]`);
  };
const object =
  (shape: Record<string, Check>): Check =>
  (value, path) => {
    if (
      !value ||
      typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    ) {
      invalid(path, "plain object");
    }
    const record = value as Record<string, unknown>;
    // Explicitly reject unknown fields, including accidental inline vectors.
    for (const key of Reflect.ownKeys(record)) {
      if (typeof key !== "string" || !Object.hasOwn(shape, key)) {
        invalid(`${path}.${String(key)}`, "known field");
      }
    }
    for (const [key, check] of Object.entries(shape)) {
      check(
        Object.hasOwn(record, key) ? record[key] : undefined,
        `${path}.${key}`,
      );
    }
  };
const ids = array(assertNonEmptyId);
const preference = object({
  id: assertNonEmptyId,
  label: assertNonEmptyId,
  strength: unitInterval,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const profile = object({
  profileId: assertNonEmptyId,
  version,
  topics: array(
    object({
      id: assertNonEmptyId,
      label: assertNonEmptyId,
      weight: unitInterval,
      confidence: unitInterval,
      sources: array(oneOf("library", "explicit", "feedback"), 1),
      lastEvidenceAt: timestamp,
      evidenceRefs: ids,
    }),
  ),
  representativePapers: array(
    object({
      itemId: assertNonEmptyId,
      title: assertNonEmptyId,
      weight: unitInterval,
      reason: oneOf(
        "recent",
        "high_topic_relevance",
        "explicit_positive",
        "saved_from_recommendation",
      ),
      addedAt: timestamp,
    }),
  ),
  explicitPreferences: object({
    positiveTopics: array(preference),
    negativeTopics: array(preference),
  }),
  embedding: optional(
    object({
      model: assertNonEmptyId,
      dimension: integer(1),
      storageKey: assertNonEmptyId,
      updatedAt: timestamp,
    }),
  ),
  signalSummary: object({
    libraryPaperCount: integer(0),
    positiveFeedbackCount: integer(0),
    negativeFeedbackCount: integer(0),
    explicitPreferenceCount: integer(0),
  }),
  generatedAt: timestamp,
  updatedAt: timestamp,
});
const scoreShape = {
  semantic: optional(finite),
  lexical: optional(finite),
  graph: optional(finite),
  recency: optional(finite),
  feedback: optional(finite),
  baseScore: optional(finite),
  finalScore: optional(finite),
};
const candidateShape = {
  candidateId: assertNonEmptyId,
  title: assertNonEmptyId,
  abstract: optional(text),
  authors: ids,
  publicationDate: optional(assertNonEmptyId),
  doi: optional(assertNonEmptyId),
  arxivId: optional(assertNonEmptyId),
  openAlexId: optional(assertNonEmptyId),
  sources: array(oneOf("profile_query", "seed_recommendation"), 1),
  seedPaperIds: optional(ids),
  scores: object(scoreShape),
  evidence: optional(object({ evidenceRefs: ids })),
};
const candidate = object(candidateShape);
const feedback = object({
  eventId: assertNonEmptyId,
  paperId: assertNonEmptyId,
  recommendationId: assertNonEmptyId,
  action: oneOf("positive", "negative", "save", "skip"),
  timestamp,
});
const impression = object({
  recommendationId: assertNonEmptyId,
  timestamp,
  profileVersion: version,
  candidates: array(
    object({
      ...candidateShape,
      rank: integer(1),
      scores: object({ ...scoreShape, finalScore: finite }),
      matchedTopicIds: ids,
    }),
  ),
});

export function assertResearchProfile(
  value: unknown,
): asserts value is ResearchProfile {
  profile(value, "profile");
}

export function assertRecommendationCandidate(
  value: unknown,
): asserts value is RecommendationCandidate {
  candidate(value, "candidate");
}

export function assertRecommendationFeedback(
  value: unknown,
): asserts value is RecommendationFeedback {
  feedback(value, "feedback");
}

export function assertRecommendationImpression(
  value: unknown,
): asserts value is RecommendationImpression {
  impression(value, "impression");
  const { candidates } = value as RecommendationImpression;
  if (
    new Set(candidates.map((paper) => paper.candidateId)).size !==
    candidates.length
  ) {
    invalid("impression.candidates", "unique candidate IDs");
  }
  if (
    new Set(candidates.map((paper) => paper.rank)).size !== candidates.length
  ) {
    invalid("impression.candidates", "unique ranks");
  }
}
