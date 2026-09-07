import type { AgentToolContext, AgentToolDefinition } from "../../types";
import type { ProfileService } from "../../../recommendation/profile/profileService";
import { assertLibraryID } from "../../../recommendation/profile/identity";
import { UtilityTopicExtractor } from "../../../recommendation/profile/utilityTopicExtractor";
import { fail, ok } from "../shared";

export const PROFILE_TOOL_LIMITS = Object.freeze({
  topics: 20,
  evidenceRefs: 6,
  representativePapers: 10,
  preferencesPerPolarity: 20,
  labelChars: 160,
  titleChars: 300,
});
type ProfileGetInput = { refresh: boolean };

/** Request scope wins. Invalid supplied scope must never fall back to another library. */
export function resolveProfileLibraryID(context: AgentToolContext): number {
  const libraryID =
    context.request.libraryID !== undefined
      ? context.request.libraryID
      : context.item?.libraryID !== undefined
        ? context.item.libraryID
        : context.request.item?.libraryID !== undefined
          ? context.request.item.libraryID
          : context.request.turnPaperScope?.libraryID;
  assertLibraryID(libraryID);
  return libraryID;
}

export function createResearchProfileGetTool(
  service: Pick<ProfileService, "get">,
): AgentToolDefinition<ProfileGetInput, unknown> {
  return {
    spec: {
      name: "research_profile_get",
      description:
        "Get persistent research interests for the current Zotero library, including topic evidence and explicit preferences. Builds memory if absent; refresh:true rebuilds from current library metadata. Explicit preferences take priority over inferred interests. Does not change Zotero items.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          refresh: {
            type: "boolean",
            description:
              "Rebuild the saved profile from current library metadata.",
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
        return fail("Expected an object with optional refresh");
      const record = args as Record<string, unknown>;
      if (
        Object.keys(record).some((key) => key !== "refresh") ||
        (record.refresh !== undefined && typeof record.refresh !== "boolean")
      )
        return fail(
          "Only refresh:boolean is supported; library scope comes from the current request",
        );
      return ok({ refresh: record.refresh === true });
    },
    async execute(input, context) {
      let libraryID;
      try {
        libraryID = resolveProfileLibraryID(context);
      } catch {
        throw new Error(
          "research_profile_get requires a valid current libraryID in Agent context",
        );
      }
      const request = context.request;
      const result = await service.get(libraryID, {
        refresh: input.refresh,
        signal: context.signal,
        extractor: new UtilityTopicExtractor({
          model: request.model || context.modelName,
          apiBase: request.apiBase,
          apiKey: request.apiKey,
          authMode: request.authMode,
          providerProtocol: request.providerProtocol,
          profileOverride: request.advanced?.profileOverride,
        }),
      });
      const p = result.profile;
      const limits = PROFILE_TOOL_LIMITS;
      const truncated =
        p.topics.length > limits.topics ||
        p.topics.some(
          (topic) =>
            topic.evidenceRefs.length > limits.evidenceRefs ||
            topic.label.length > limits.labelChars,
        ) ||
        p.representativePapers.length > limits.representativePapers ||
        p.representativePapers.some(
          (paper) => paper.title.length > limits.titleChars,
        ) ||
        p.explicitPreferences.positiveTopics.length >
          limits.preferencesPerPolarity ||
        p.explicitPreferences.negativeTopics.length >
          limits.preferencesPerPolarity ||
        [
          ...p.explicitPreferences.positiveTopics,
          ...p.explicitPreferences.negativeTopics,
        ].some((pref) => pref.label.length > limits.labelChars);
      const preferences = (
        values: typeof p.explicitPreferences.positiveTopics,
      ) =>
        values.slice(0, limits.preferencesPerPolarity).map((value) => ({
          ...value,
          label: value.label.slice(0, limits.labelChars),
        }));
      return {
        profileId: p.profileId,
        version: p.version,
        status: result.status,
        topics: p.topics.slice(0, limits.topics).map((topic) => ({
          ...topic,
          label: topic.label.slice(0, limits.labelChars),
          sources: [...topic.sources],
          evidenceRefs: topic.evidenceRefs.slice(0, limits.evidenceRefs),
        })),
        representativePapers: p.representativePapers
          .slice(0, limits.representativePapers)
          .map((paper) => ({
            ...paper,
            title: paper.title.slice(0, limits.titleChars),
          })),
        explicitPreferences: {
          positiveTopics: preferences(p.explicitPreferences.positiveTopics),
          negativeTopics: preferences(p.explicitPreferences.negativeTopics),
        },
        signalSummary: { ...p.signalSummary },
        generatedAt: p.generatedAt,
        updatedAt: p.updatedAt,
        warnings: [
          ...result.warnings,
          ...(truncated ? ["profile_tool_output_truncated"] : []),
        ],
      };
    },
  };
}
