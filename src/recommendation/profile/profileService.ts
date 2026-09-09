import type { ProfileFeedbackSource } from "../feedback/replay";
import type { ExplicitPreferences, ResearchProfile } from "../domain/profile";
import type { ProfileStore } from "../domain/stores";
import type {
  ResearchLibrarySource,
  ResearchPaperSignal,
  TopicExtractor,
  TopicExtractionResult,
} from "./contracts";
import { profileIdForLibrary } from "./identity";
import { ProfileBuilder } from "./profileBuilder";
import { validatePreferenceUpdate } from "./profileUpdater";
import {
  TOPIC_EXTRACTION_LIMITS,
  validateExtractedTopics,
} from "./topicExtractor";

export type ProfileResult = {
  profile: ResearchProfile;
  status: "loaded" | "built" | "rebuilt";
  warnings: string[];
};
export type ProfileGetOptions = {
  refresh?: boolean;
  extractor?: TopicExtractor;
  signal?: AbortSignal;
};

export class ProfileService {
  constructor(
    private readonly store: ProfileStore,
    private readonly source: ResearchLibrarySource,
    private readonly builder = new ProfileBuilder(),
    private readonly now: () => number = Date.now,
    private readonly extractionTimeoutMs: number = TOPIC_EXTRACTION_LIMITS.totalTimeoutMs,
    private readonly feedback?: ProfileFeedbackSource,
  ) {
    if (!Number.isFinite(extractionTimeoutMs) || extractionTimeoutMs <= 0)
      throw new TypeError("Invalid extraction timeout");
  }

  async get(
    libraryID: number,
    options: ProfileGetOptions = {},
  ): Promise<ProfileResult> {
    const previous = await this.store.load(profileIdForLibrary(libraryID));
    this.checkCancelled(options.signal);
    if (previous && !options.refresh)
      return { profile: previous, status: "loaded", warnings: [] };
    return this.buildAndSave(libraryID, previous, options);
  }

  async rebuild(
    libraryID: number,
    options: Omit<ProfileGetOptions, "refresh"> = {},
  ): Promise<ProfileResult> {
    return this.get(libraryID, { ...options, refresh: true });
  }

  /** Preferences affect topic scores: update via a full rebuild, so both timestamps advance. */
  async updateExplicitPreferences(
    libraryID: number,
    value: ExplicitPreferences,
    options: Omit<ProfileGetOptions, "refresh"> = {},
  ): Promise<ProfileResult> {
    const preferences = validatePreferenceUpdate(value, this.now());
    const previous = await this.store.load(profileIdForLibrary(libraryID));
    return this.buildAndSave(libraryID, previous, options, preferences);
  }

  private checkCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("Profile build cancelled");
  }

  private async extract(
    papers: readonly ResearchPaperSignal[],
    options: ProfileGetOptions,
  ): Promise<TopicExtractionResult> {
    if (!options.extractor)
      return { topics: [], warnings: ["topic_extractor_not_configured"] };
    const controller = new AbortController();
    let cancel: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new Error("Profile build cancelled"));
    });
    const forwardAbort = () => {
      controller.abort();
      cancel?.();
    };
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      this.checkCancelled(options.signal);
      const extracted = await Promise.race([
        cancelled,
        // Clone across the optional plugin/model boundary to protect source signals.
        Promise.resolve().then(() =>
          options.extractor!.extract(
            JSON.parse(JSON.stringify(papers)),
            controller.signal,
          ),
        ),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("timeout"));
          }, this.extractionTimeoutMs);
        }),
      ]);
      const topics = validateExtractedTopics(extracted.topics, papers);
      const warnings = extracted.warnings;
      if (
        !Array.isArray(warnings) ||
        warnings.length > 16 ||
        warnings.some(
          (warning) =>
            typeof warning !== "string" ||
            !/^topic_extractor_[a-z_]+$/.test(warning),
        )
      )
        throw new TypeError("Invalid extractor warnings");
      return {
        topics,
        warnings: [
          ...new Set([
            ...warnings,
            ...(!topics.length && !warnings.length
              ? ["topic_extractor_empty"]
              : []),
          ]),
        ],
      };
    } catch {
      return { topics: [], warnings: ["topic_extractor_failed_fallback"] };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", forwardAbort);
      controller.abort();
    }
  }

  private async buildAndSave(
    libraryID: number,
    previous: ResearchProfile | null,
    options: ProfileGetOptions,
    explicitPreferences?: ExplicitPreferences,
  ): Promise<ProfileResult> {
    this.checkCancelled(options.signal);
    const snapshot = await this.source.getLibrarySnapshot(libraryID);
    if (snapshot.libraryID !== libraryID)
      throw new Error("Library snapshot scope mismatch");
    this.checkCancelled(options.signal);
    const extraction = await this.extract(snapshot.papers, options);
    this.checkCancelled(options.signal);
    const now = this.now();
    const feedback = await this.feedback?.loadForProfile(
      profileIdForLibrary(libraryID),
      now,
    );
    this.checkCancelled(options.signal);
    const profile = this.builder.build({
      libraryID,
      papers: snapshot.papers,
      previous,
      explicitPreferences,
      extractedTopics: extraction.topics,
      now,
      feedback,
    });
    const warnings = [...extraction.warnings];
    if (
      !this.feedback &&
      previous &&
      (previous.signalSummary.positiveFeedbackCount ||
        previous.signalSummary.negativeFeedbackCount ||
        previous.topics.some((topic) => topic.sources.includes("feedback")))
    )
      warnings.push("feedback_state_discarded_on_rebuild");
    if (previous?.embedding)
      warnings.push("profile_embedding_invalidated_on_rebuild");
    // Conflicts propagate; callers must explicitly reload/retry. No hidden model reruns.
    await this.store.save(profile, previous?.version ?? null);
    return { profile, status: previous ? "rebuilt" : "built", warnings };
  }
}
