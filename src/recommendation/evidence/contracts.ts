import type { RecommendedPaper } from "../domain/recommendation";
import type { ResearchProfile } from "../domain/profile";
import type { ResearchLibrarySnapshot } from "../profile/contracts";

export const EVIDENCE_CONFIG = Object.freeze({
  maxPerRecommendation: 4,
  maxSnippetChars: 480,
  maxReferenceChars: 800,
  maxIdChars: 1000,
  maxSummaryChars: 1000,
  maxExplanationChars: 6000,
  maxLibraryPapers: 3,
  maxSourceRecords: 4,
  maxScanChars: 12000,
  sourceTimeoutMs: 1500,
  totalSourceBudgetMs: 5000,
  freshnessHalfLifeMs: 365 * 86400000,
  weights: Object.freeze({
    topic: 0.4,
    quality: 0.3,
    freshness: 0.2,
    completeness: 0.1,
  }),
  quality: Object.freeze({
    library_metadata: 1,
    library_note: 0.8,
    abstract: 0.9,
    paper_content: 0.85,
  }),
});
export type EvidenceSourceType =
  | "library_metadata"
  | "library_note"
  | "abstract"
  | "paper_content";
export interface RecommendationEvidence {
  readonly evidenceId: string;
  readonly candidateId: string;
  readonly sourceType: EvidenceSourceType;
  readonly reference: string;
  readonly snippet: string;
  /** Deterministic support score, not a calibrated probability. */
  readonly confidence: number;
  /** Retrieval snapshot time, never treated as source publication time. */
  readonly createdAt: number;
}
export interface RecommendationReason {
  readonly summary: string;
  readonly matchedTopics: readonly string[];
  /** IDs resolving to entries in this recommendation's evidence array. */
  readonly evidenceRefs: readonly string[];
  readonly confidence: number;
}
export interface EvidenceResult {
  readonly evidence: readonly RecommendationEvidence[];
  readonly reason: RecommendationReason;
  readonly warnings: readonly string[];
}
export interface EvidenceRecord {
  reference: string;
  text: string;
}
/** Read existing data only; item IDs have already been restricted to the snapshot. */
export interface EvidenceContentSource {
  notes(itemId: string): Promise<readonly EvidenceRecord[]>;
  content(itemId: string): Promise<readonly EvidenceRecord[]>;
}
export interface EvidenceInput {
  candidate: RecommendedPaper;
  profile: ResearchProfile;
  snapshot: ResearchLibrarySnapshot;
  now: number;
  signal?: AbortSignal;
}
export function assertRecommendationEvidence(
  value: unknown,
): asserts value is RecommendationEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid evidence");
  const v = value as Record<string, unknown>;
  const fields = [
    "evidenceId",
    "candidateId",
    "sourceType",
    "reference",
    "snippet",
    "confidence",
    "createdAt",
  ];
  if (
    Object.keys(v).length !== fields.length ||
    Object.keys(v).some((k) => !fields.includes(k))
  )
    throw new TypeError("Invalid evidence fields");
  for (const [key, limit] of [
    ["evidenceId", EVIDENCE_CONFIG.maxIdChars],
    ["candidateId", EVIDENCE_CONFIG.maxIdChars],
    ["reference", EVIDENCE_CONFIG.maxReferenceChars],
    ["snippet", EVIDENCE_CONFIG.maxSnippetChars],
  ] as const) {
    if (
      typeof v[key] !== "string" ||
      !(v[key] as string).trim() ||
      (v[key] as string).length > limit
    )
      throw new TypeError(`Invalid evidence ${key}`);
  }
  if (
    typeof v.sourceType !== "string" ||
    !Object.hasOwn(EVIDENCE_CONFIG.quality, v.sourceType)
  )
    throw new TypeError("Invalid evidence source");
  if (
    typeof v.confidence !== "number" ||
    !Number.isFinite(v.confidence) ||
    v.confidence < 0 ||
    v.confidence > 1
  )
    throw new TypeError("Invalid evidence confidence");
  if (!Number.isSafeInteger(v.createdAt) || (v.createdAt as number) < 0)
    throw new TypeError("Invalid evidence time");
}
