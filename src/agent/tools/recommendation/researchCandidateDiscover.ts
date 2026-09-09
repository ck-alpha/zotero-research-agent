import type { AgentToolContext, AgentToolDefinition } from "../../types";
import type { ProfileService } from "../../../recommendation/profile/profileService";
import type { ResearchLibrarySource } from "../../../recommendation/profile/contracts";
import type { LiteratureDiscoverySource } from "../../../recommendation/candidate/contracts";
import { CandidateDiscoveryService } from "../../../recommendation/candidate/candidateService";
import { CANDIDATE_DISCOVERY_LIMITS as limits } from "../../../recommendation/candidate/config";
import { normalizeCandidateFocus } from "../../../recommendation/candidate/queryRecall";
import { createProfileTopicExtractor, resolveProfileLibraryID } from "./shared";
import { fail, ok } from "../shared";

type CandidateInput = { focus?: string; limit: number };

export function createResearchCandidateDiscoverTool(
  profileService: Pick<ProfileService, "get">,
  librarySource: ResearchLibrarySource,
  sourceFactory: (context: AgentToolContext) => LiteratureDiscoverySource,
): AgentToolDefinition<CandidateInput, unknown> {
  return {
    spec: {
      name: "research_candidate_discover",
      description:
        "Inspect/debug novel literature candidates from the current library's persistent research interests and representative papers. Optional focus applies only to this request. Results are in discovery order, without personalized ranking. For personalized reading recommendations, call research_recommend directly; it already performs discovery. Does not import papers or change Zotero items.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          focus: {
            type: "string",
            minLength: 1,
            maxLength: limits.maxFocusChars,
            description: "Optional research question for this turn only.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: limits.toolMaxLimit,
            description: "Maximum candidates to display; default 30.",
          },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
      exposure: "model",
      localAgentOnly: true,
    },
    isAvailable: (request) =>
      !["codex_app_server", "webchat"].includes(request.authMode || "") &&
      request.providerProtocol !== "web_sync",
    validate(args) {
      if (!args || typeof args !== "object" || Array.isArray(args))
        return fail("Expected optional focus and limit");
      const record = args as Record<string, unknown>;
      if (Object.keys(record).some((key) => !["focus", "limit"].includes(key)))
        return fail(
          "Only focus and limit are supported; library scope comes from Agent context",
        );
      const limit = record.limit ?? limits.toolDefaultLimit;
      if (
        record.limit === null ||
        !Number.isSafeInteger(limit) ||
        (limit as number) < 1 ||
        (limit as number) > limits.toolMaxLimit
      )
        return fail("Invalid candidate limit");
      try {
        return ok({
          focus: normalizeCandidateFocus(record.focus, limits.maxFocusChars),
          limit: limit as number,
        });
      } catch {
        return fail("Invalid candidate focus");
      }
    },
    async execute(input, context) {
      const libraryID = resolveProfileLibraryID(context);
      const profile = await profileService.get(libraryID, {
        signal: context.signal,
        extractor: createProfileTopicExtractor(context),
      });
      if (context.signal?.aborted)
        throw new Error("Candidate discovery cancelled");
      const snapshot = await librarySource.getLibrarySnapshot(libraryID);
      const result = await new CandidateDiscoveryService(
        sourceFactory(context),
      ).discover({
        libraryID,
        profile: profile.profile,
        snapshot,
        focus: input.focus,
        signal: context.signal,
      });
      let truncated = result.candidates.length > input.limit;
      const snippet = (value: string | undefined, max: number) => {
        if (value && value.length > max) truncated = true;
        return value?.slice(0, max);
      };
      const candidates = result.candidates
        .slice(0, input.limit)
        .map((candidate) => {
          if (candidate.authors.length > limits.toolMaxAuthors)
            truncated = true;
          return {
            candidateId: candidate.candidateId,
            title: snippet(candidate.title, limits.toolTitleChars),
            authors: candidate.authors
              .slice(0, limits.toolMaxAuthors)
              .map((author) => snippet(author, limits.toolAuthorChars)),
            abstract: snippet(
              candidate.abstract,
              limits.toolAbstractSnippetChars,
            ),
            publicationDate: candidate.publicationDate,
            doi: candidate.doi,
            arxivId: candidate.arxivId,
            openAlexId: candidate.openAlexId,
            sourceUrl: candidate.sourceUrl,
            openAccessUrl: candidate.openAccessUrl,
            sources: candidate.sources,
            seedPaperIds: candidate.seedPaperIds,
            provenance: candidate.provenance,
          };
        });
      return {
        profileId: result.profileId,
        profileVersion: result.profileVersion,
        generatedAt: result.generatedAt,
        focus: result.focus,
        candidateCount: candidates.length,
        candidates,
        diagnostics: result.diagnostics,
        warnings: [
          ...new Set([
            ...profile.warnings,
            ...result.warnings,
            ...(truncated ? ["candidate_tool_output_truncated"] : []),
          ]),
        ],
      };
    },
  };
}
