import type { ImpressionStore } from "../../../recommendation/domain/stores";
import { SqliteImpressionStore } from "../../../recommendation/feedback/stores";
import type { AgentToolContext, AgentToolDefinition } from "../../types";
import type { ProfileService } from "../../../recommendation/profile/profileService";
import type { ResearchLibrarySource } from "../../../recommendation/profile/contracts";
import type { LiteratureDiscoverySource } from "../../../recommendation/candidate/contracts";
import { CandidateDiscoveryService } from "../../../recommendation/candidate/candidateService";
import { normalizeCandidateFocus } from "../../../recommendation/candidate/queryRecall";
import { CANDIDATE_DISCOVERY_LIMITS } from "../../../recommendation/candidate/config";
import { RankingService } from "../../../recommendation/ranking/rankingService";
import { RANKING_CONFIG as config } from "../../../recommendation/ranking/config";
import type { RankingEmbeddingProvider } from "../../../recommendation/ranking/contracts";
import { checkCancelled } from "../../../recommendation/ranking/semantic";
import { createRecommendationEmbeddingProvider } from "../../services/recommendationEmbeddingProvider";
import { createProfileTopicExtractor, resolveProfileLibraryID } from "./shared";
import { fail, ok } from "../shared";

type RecommendInput = { focus?: string; topK: number };
export function createResearchRecommendTool(
  profileService: Pick<ProfileService, "get">,
  librarySource: ResearchLibrarySource,
  sourceFactory: (context: AgentToolContext) => LiteratureDiscoverySource,
  options: {
    embeddingFactory?: () => RankingEmbeddingProvider | undefined;
    now?: () => number;
    impressionStore?: ImpressionStore;
  } = {},
): AgentToolDefinition<RecommendInput, unknown> {
  return {
    spec: {
      name: "research_recommend",
      description:
        "Recommend novel papers personalized to the current library and optional temporary focus, with deterministic relevance scores and MMR diversity. Discovers the full candidate pool internally; use this tool directly for personalized reading recommendations. Does not import papers or change Zotero items.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          focus: {
            type: "string",
            minLength: 1,
            maxLength: CANDIDATE_DISCOVERY_LIMITS.maxFocusChars,
            description: "Optional research focus for this request only.",
          },
          topK: {
            type: "integer",
            minimum: 1,
            maximum: config.toolMaxTopK,
            description: `Number of recommendations; default ${config.toolDefaultTopK}.`,
          },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
      exposure: "model",
      localAgentOnly: true,
    },
    guidance: {
      matches: (request) =>
        /论文|文献|研究兴趣|\b(?:papers?|articles?|read)\b/iu.test(
          request.userText || "",
        ) &&
        /(?:根据|按).{0,20}(?:我的|文献库|研究兴趣).{0,20}推荐|最近有什么论文值得我读|\b(?:papers? I should read|recommend.{0,40}(?:my (?:library|research|interests)|for me)|based on my (?:library|research|interests))\b/iu.test(
          request.userText || "",
        ),
      instruction:
        "For personalized requests based on my library/interests or papers I should read next, call research_recommend directly. It loads the profile and discovers candidates internally; calling research_candidate_discover first repeats discovery. Retain recommendationId and candidateId for subsequent recommendation_feedback calls. Preserve returned rank order and explain matched topics, scores and provenance. Use research_candidate_discover for candidate inspection/debugging, research_profile_get({refresh:true}) only for explicit profile refresh, and literature_search for generic scholarly searches.",
    },
    isAvailable: (request) =>
      !["codex_app_server", "webchat"].includes(request.authMode || "") &&
      request.providerProtocol !== "web_sync",
    validate(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return fail("Expected an object");
      const record = raw as Record<string, unknown>;
      if (Object.keys(record).some((key) => key !== "focus" && key !== "topK"))
        return fail("Unknown recommendation argument");
      const topK =
        record.topK === undefined ? config.toolDefaultTopK : record.topK;
      if (
        !Number.isSafeInteger(topK) ||
        (topK as number) < 1 ||
        (topK as number) > config.toolMaxTopK
      )
        return fail("Invalid recommendation topK");
      try {
        return ok({
          focus: normalizeCandidateFocus(record.focus),
          topK: topK as number,
        });
      } catch {
        return fail("Invalid recommendation focus");
      }
    },
    async execute(input, context) {
      const validated = this.validate(input);
      if (!validated.ok)
        throw new TypeError("Invalid recommendation arguments");
      checkCancelled(context.signal);
      const libraryID = resolveProfileLibraryID(context);
      const profileResult = await profileService.get(libraryID, {
        signal: context.signal,
        extractor: createProfileTopicExtractor(context),
      });
      checkCancelled(context.signal);
      const snapshot = await librarySource.getLibrarySnapshot(libraryID);
      checkCancelled(context.signal);
      const now = options.now ?? Date.now;
      const discovery = await new CandidateDiscoveryService(
        sourceFactory(context),
        { now },
      ).discover({
        libraryID,
        profile: profileResult.profile,
        snapshot,
        focus: input.focus,
        signal: context.signal,
      });
      const ranked = await new RankingService().rank({
        profile: profileResult.profile,
        candidates: discovery.candidates,
        focus: discovery.focus,
        now: now(),
        topK: input.topK,
        signal: context.signal,
        semanticProvider: (
          options.embeddingFactory ?? createRecommendationEmbeddingProvider
        )(),
      });
      let truncated = false;
      const snippet = (value: string | undefined, max: number) => {
        if (value && value.length > max) truncated = true;
        return value?.slice(0, max);
      };
      const topics = new Map(
        profileResult.profile.topics.map((t) => [t.id, t.label]),
      );
      const recommendations = ranked.recommendations.map((paper) => {
        if (paper.authors.length > config.toolMaxAuthors) truncated = true;
        return {
          rank: paper.rank,
          candidateId: paper.candidateId,
          title: snippet(paper.title, config.toolTitleChars),
          abstract: snippet(paper.abstract, config.toolAbstractSnippetChars),
          authors: paper.authors
            .slice(0, config.toolMaxAuthors)
            .map((a) => snippet(a, config.toolAuthorChars)),
          publicationDate: paper.publicationDate,
          doi: paper.doi,
          arxivId: paper.arxivId,
          openAlexId: paper.openAlexId,
          sourceUrl: paper.sourceUrl,
          openAccessUrl: paper.openAccessUrl,
          matchedTopics: paper.matchedTopicIds.map((id) => ({
            id,
            label: topics.get(id)!,
          })),
          scores: Object.fromEntries(
            Object.entries(paper.scores)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, Number(v!.toFixed(4))]),
          ),
          sources: paper.sources,
          seedPaperIds: paper.seedPaperIds,
          provenance: paper.provenance,
        };
      });
      const recommendationId = globalThis.crypto.randomUUID();
      checkCancelled(context.signal);
      await (options.impressionStore ?? new SqliteImpressionStore()).save({
        recommendationId,
        profileId: ranked.profileId,
        profileVersion: ranked.profileVersion,
        timestamp: ranked.generatedAt,
        topicSnapshot: [
          ...new Set(ranked.recommendations.flatMap((p) => p.matchedTopicIds)),
        ].map((id) => ({ id, label: topics.get(id)! })),
        candidates: ranked.recommendations,
      });
      return {
        recommendationId,
        profileId: ranked.profileId,
        profileVersion: ranked.profileVersion,
        generatedAt: ranked.generatedAt,
        focus: ranked.focus,
        recommendationCount: recommendations.length,
        recommendations,
        discoveryDiagnostics: discovery.diagnostics,
        rankingDiagnostics: ranked.diagnostics,
        warnings: [
          ...new Set([
            ...profileResult.warnings,
            ...discovery.warnings,
            ...ranked.warnings,
            ...(truncated ? ["ranking_tool_output_truncated"] : []),
          ]),
        ],
      };
    },
  };
}
