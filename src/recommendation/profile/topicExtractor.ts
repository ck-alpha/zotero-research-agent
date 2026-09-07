import type { ExtractedTopic, ResearchPaperSignal } from "./contracts";
import { normalizeTopic, compareText } from "./topicNormalization";

export const TOPIC_EXTRACTION_LIMITS = Object.freeze({
  maxPapers: 48,
  batchSize: 12,
  maxTopicsPerBatch: 8,
  maxTopics: 24,
  timeoutMs: 8_000,
  totalTimeoutMs: 35_000,
  jsonBudget: 1_200,
  titleChars: 300,
  abstractChars: 900,
  maxResponseChars: 24_000,
});

/** Reject the entire payload on unknown IDs/fields; never silently repair model evidence. */
export function validateExtractedTopics(
  value: unknown,
  papers: readonly ResearchPaperSignal[],
  maxTopics: number = TOPIC_EXTRACTION_LIMITS.maxTopics,
): ExtractedTopic[] {
  if (!Array.isArray(value) || value.length > maxTopics)
    throw new TypeError("Invalid extracted topics");
  const ids = new Set(papers.map((paper) => paper.itemId));
  return Array.from(value, (raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new TypeError("Invalid extracted topic");
    const record = raw as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) => !["label", "confidence", "supportingPaperIds"].includes(key),
      )
    )
      throw new TypeError("Unknown extracted topic field");
    const topic = normalizeTopic(record.label);
    if (
      typeof record.confidence !== "number" ||
      !Number.isFinite(record.confidence) ||
      record.confidence < 0 ||
      record.confidence > 1
    )
      throw new TypeError("Invalid topic confidence");
    const support = record.supportingPaperIds;
    if (
      !Array.isArray(support) ||
      !support.length ||
      support.length > papers.length ||
      Array.from(support).some((id) => typeof id !== "string" || !ids.has(id))
    )
      throw new TypeError("Invalid supporting paper ID");
    return {
      label: topic.label,
      confidence: record.confidence,
      supportingPaperIds: [...new Set(support as string[])].sort(compareText),
    };
  });
}

export function parseTopicExtraction(
  text: string,
  papers: readonly ResearchPaperSignal[],
): ExtractedTopic[] {
  if (!text.trim() || text.length > TOPIC_EXTRACTION_LIMITS.maxResponseChars)
    throw new TypeError("Invalid topic response size");
  const value: unknown = JSON.parse(text.trim());
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "topics")
  )
    throw new TypeError("Expected a topics object");
  return validateExtractedTopics(
    (value as { topics: unknown }).topics,
    papers,
    TOPIC_EXTRACTION_LIMITS.maxTopicsPerBatch,
  );
}
