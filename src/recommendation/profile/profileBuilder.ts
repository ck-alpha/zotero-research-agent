import { applyProfileFeedback } from "../feedback/profileUpdater";
import type { FeedbackProfileState } from "../feedback/replay";
import type {
  ExplicitPreferences,
  ResearchProfile,
  TopicInterest,
  RepresentativePaper,
} from "../domain/profile";
import { assertNonEmptyId, assertResearchProfile } from "../domain/validation";
import type { ExtractedTopic, ResearchPaperSignal } from "./contracts";
import { profileIdForLibrary } from "./identity";
import {
  compareText,
  evidenceRef,
  normalizeTopic,
  selectEvidenceRefs,
  topicId,
} from "./topicNormalization";
import { validateExtractedTopics } from "./topicExtractor";
import { validatePreferenceUpdate } from "./profileUpdater";
import {
  PROFILE_SCORING,
  type ProfileScoringConfig,
  scoreTopic,
  scoreRepresentative,
  timeDecay,
  validateScoringConfig,
} from "./profileScoring";

type TopicSignals = {
  key: string;
  label: string;
  papers: Map<string, { quality: number; addedAt: number }>;
  refs: Set<string>;
  positive: number;
  negative: number;
  explicit: boolean;
  lastEvidenceAt: number;
};

export type ProfileBuildInput = {
  libraryID: number;
  papers: readonly ResearchPaperSignal[];
  previous?: ResearchProfile | null;
  explicitPreferences?: ExplicitPreferences;
  extractedTopics?: readonly ExtractedTopic[];
  now: number;
  feedback?: FeedbackProfileState;
};

/** Pure synchronous build: all I/O and optional model failure handling belong to the service. */
export class ProfileBuilder {
  private readonly config: ProfileScoringConfig;
  constructor(config: ProfileScoringConfig = PROFILE_SCORING) {
    validateScoringConfig(config);
    this.config = { ...config };
  }

  build(input: ProfileBuildInput): ResearchProfile {
    const { papers, previous, now } = input;
    const profileId = profileIdForLibrary(input.libraryID);
    timeDecay(now, now, this.config.halfLifeDays);
    if (previous) {
      assertResearchProfile(previous);
      if (previous.profileId !== profileId)
        throw new Error("Previous profile scope mismatch");
      if (now < previous.updatedAt)
        throw new Error("Profile time cannot move backwards");
    }
    const preferences = validatePreferenceUpdate(
      input.explicitPreferences ??
        previous?.explicitPreferences ?? {
          positiveTopics: [],
          negativeTopics: [],
        },
      now,
    );
    const ordered = [...papers].sort((a, b) => compareText(a.itemId, b.itemId));
    const ids = new Set<string>();
    for (const paper of ordered) {
      assertNonEmptyId(paper.itemId, "paper.itemId");
      assertNonEmptyId(paper.title, "paper.title");
      if (ids.has(paper.itemId)) throw new TypeError("Duplicate paper signal");
      ids.add(paper.itemId);
      timeDecay(paper.addedAt, now, this.config.halfLifeDays);
      timeDecay(paper.modifiedAt, now, this.config.halfLifeDays);
    }
    const paperById = new Map(ordered.map((paper) => [paper.itemId, paper]));
    const signals = new Map<string, TopicSignals>();
    const ensure = (label: string): TopicSignals => {
      const normalized = normalizeTopic(label);
      let topic = signals.get(normalized.key);
      if (!topic) {
        topic = {
          ...normalized,
          papers: new Map(),
          refs: new Set(),
          positive: 0,
          negative: 0,
          explicit: false,
          lastEvidenceAt: 0,
        };
        signals.set(normalized.key, topic);
      } else if (compareText(normalized.label, topic.label) < 0)
        topic.label = normalized.label;
      return topic;
    };
    const support = (
      topic: TopicSignals,
      paper: ResearchPaperSignal,
      quality: number,
      ref: string,
    ) => {
      if (quality <= 0) return;
      const existing = topic.papers.get(paper.itemId);
      // A paper gets at most one vote per topic, regardless of duplicate signal sources.
      topic.papers.set(paper.itemId, {
        quality: Math.max(existing?.quality ?? 0, quality),
        addedAt: paper.addedAt,
      });
      topic.refs.add(evidenceRef("paper", paper.itemId));
      topic.refs.add(ref);
      topic.lastEvidenceAt = Math.max(
        topic.lastEvidenceAt,
        Math.min(now, paper.addedAt),
      );
    };
    for (const paper of ordered) {
      for (const [kind, labels, quality] of [
        ["tag", paper.manualTags, this.config.manualTagQuality],
        ["collection", paper.collectionPaths, this.config.collectionQuality],
      ] as const) {
        for (const label of [...labels].sort(compareText)) {
          let normalized;
          try {
            normalized = normalizeTopic(label);
          } catch {
            continue;
          }
          support(
            ensure(normalized.label),
            paper,
            quality,
            evidenceRef(kind, normalized.key),
          );
        }
      }
    }
    const extracted = validateExtractedTopics(
      input.extractedTopics ?? [],
      ordered,
    );
    for (const topic of extracted.sort((a, b) =>
      compareText(a.label, b.label),
    )) {
      if (topic.confidence === 0) continue;
      const aggregate = ensure(topic.label);
      for (const id of topic.supportingPaperIds)
        support(
          aggregate,
          paperById.get(id)!,
          this.config.llmQuality * topic.confidence,
          evidenceRef("llm", aggregate.key),
        );
    }
    for (const polarity of ["positiveTopics", "negativeTopics"] as const) {
      for (const preference of preferences[polarity]) {
        const topic = ensure(preference.label);
        topic.explicit = true;
        topic[polarity === "positiveTopics" ? "positive" : "negative"] =
          preference.strength;
        topic.refs.add(evidenceRef("preference", preference.id));
        topic.lastEvidenceAt = Math.max(
          topic.lastEvidenceAt,
          preference.updatedAt,
        );
      }
    }
    const topics: TopicInterest[] = [...signals.values()]
      .map((topic) => ({
        id: topicId(topic.key),
        label: topic.label,
        ...scoreTopic(
          [...topic.papers.entries()]
            .sort(([a], [b]) => compareText(a, b))
            .map(([, value]) => value),
          now,
          topic.positive,
          topic.negative,
          this.config,
        ),
        sources: [
          ...(topic.papers.size ? ["library" as const] : []),
          ...(topic.explicit ? ["explicit" as const] : []),
        ],
        lastEvidenceAt: topic.lastEvidenceAt,
        evidenceRefs: selectEvidenceRefs(
          topic.refs,
          this.config.maxEvidenceRefs,
        ),
      }))
      .sort(
        (a, b) =>
          b.weight - a.weight ||
          b.confidence - a.confidence ||
          compareText(a.id, b.id),
      )
      .slice(0, this.config.maxTopics);
    const representatives: RepresentativePaper[] = ordered.map((paper) => {
      const evidence = topics.flatMap((topic) => {
        const aggregate = signals.get(normalizeTopic(topic.label).key)!;
        const support = aggregate.papers.get(paper.itemId);
        return support
          ? [
              {
                topicWeight: topic.weight,
                quality: support.quality,
                positive: aggregate.positive,
                negative: aggregate.negative,
              },
            ]
          : [];
      });
      return {
        itemId: paper.itemId,
        title: paper.title,
        addedAt: paper.addedAt,
        ...scoreRepresentative(evidence, paper.addedAt, now, this.config),
      };
    });
    representatives.sort(
      (a, b) =>
        b.weight - a.weight ||
        b.addedAt - a.addedAt ||
        compareText(a.itemId, b.itemId),
    );
    const profile: ResearchProfile = {
      profileId,
      version: (previous?.version ?? 0) + 1,
      topics,
      representativePapers: representatives.slice(
        0,
        this.config.maxRepresentativePapers,
      ),
      explicitPreferences: preferences,
      signalSummary: {
        libraryPaperCount: ordered.length,
        positiveFeedbackCount: 0,
        negativeFeedbackCount: 0,
        explicitPreferenceCount:
          preferences.positiveTopics.length + preferences.negativeTopics.length,
      },
      generatedAt: now,
      updatedAt: now,
    };
    assertResearchProfile(profile);
    return input.feedback
      ? applyProfileFeedback(profile, input.feedback, now, true)
      : profile;
  }
}
