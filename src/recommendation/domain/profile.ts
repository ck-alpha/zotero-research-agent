export type InterestSource = "library" | "explicit" | "feedback";

export interface TopicInterest {
  id: string;
  label: string;
  /** Interest intensity in [0, 1], independent of confidence. */
  weight: number;
  /** Certainty of the inferred interest in [0, 1]. */
  confidence: number;
  sources: InterestSource[];
  /** Nonnegative Unix milliseconds, like all domain timestamps. */
  lastEvidenceAt: number;
  /** Opaque references; resolving evidence belongs to a future adapter. */
  evidenceRefs: string[];
}

export interface PreferenceConstraint {
  id: string;
  label: string;
  /** Magnitude in [0, 1]; polarity is determined by the containing list. */
  strength: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExplicitPreferences {
  positiveTopics: PreferenceConstraint[];
  negativeTopics: PreferenceConstraint[];
}

export interface RepresentativePaper {
  /** Opaque library paper identity; no Zotero object is stored. */
  itemId: string;
  title: string;
  /** Normalized representative weight in [0, 1]. */
  weight: number;
  reason:
    | "recent"
    | "high_topic_relevance"
    | "explicit_positive"
    | "saved_from_recommendation";
  addedAt: number;
}

export interface ProfileEmbeddingRef {
  model: string;
  dimension: number;
  storageKey: string;
  updatedAt: number;
}

export interface ProfileSignalSummary {
  libraryPaperCount: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  explicitPreferenceCount: number;
}

export interface ResearchProfile {
  profileId: string;
  /** Positive safe integer snapshot revision, not a schema version. */
  version: number;
  topics: TopicInterest[];
  /** Durable non-feedback baseline prevents compounding during full replay. */
  feedbackBaseTopics?: TopicInterest[];
  representativePapers: RepresentativePaper[];
  explicitPreferences: ExplicitPreferences;
  embedding?: ProfileEmbeddingRef;
  signalSummary: ProfileSignalSummary;
  generatedAt: number;
  updatedAt: number;
}
