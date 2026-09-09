import type { AgentToolDefinition } from "../../types";
import type { RecommendationFeedbackService } from "../../../recommendation/feedback/service";
import type { FeedbackAction } from "../../../recommendation/domain/feedback";
import { feedbackEventId } from "../../../recommendation/feedback/policy";
import { resolveProfileLibraryID } from "./shared";
import { fail, ok } from "../shared";

type Input = {
  recommendationId: string;
  candidateId: string;
  action: FeedbackAction;
};
export function createRecommendationFeedbackTool(
  service: Pick<RecommendationFeedbackService, "submit">,
  now: () => number = Date.now,
): AgentToolDefinition<Input, unknown> {
  return {
    spec: {
      name: "recommendation_feedback",
      description:
        "Record explicit user feedback on a previously displayed recommendation. Reuse recommendationId and candidateId from research_recommend in conversation context. positive=interested, negative=not interested, save=strong positive preference only (no Zotero import), skip=weak negative. Never infer feedback from unrelated sentiment or invent IDs.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["recommendationId", "candidateId", "action"],
        properties: {
          recommendationId: { type: "string", minLength: 1 },
          candidateId: { type: "string", minLength: 1 },
          action: {
            type: "string",
            enum: ["positive", "negative", "save", "skip"],
          },
        },
      },
      mutability: "write",
      mutationScope: "recommendation_memory",
      requiresConfirmation: true,
      exposure: "model",
      localAgentOnly: true,
    },
    isAvailable: (request) =>
      !["codex_app_server", "webchat"].includes(request.authMode || "") &&
      request.providerProtocol !== "web_sync",
    guidance: {
      matches: (request) =>
        /(?:第\s*[\d一二三四五六七八九十]+\s*篇|这篇|这个).*(?:感兴趣|兴趣|保存|跳过)|(?:like|interested in|save|skip).*(?:second|fourth|#\d+|paper|one)/iu.test(
          request.userText || "",
        ),
      instruction:
        "For explicit reactions to displayed papers (第2篇感兴趣，第4篇不感兴趣，这篇我想保存，这个跳过; I like the second one; I'm not interested in #4), call recommendation_feedback once per paper using IDs from the prior research_recommend output. Do not ask users to repeat IDs already in context. If there is no unambiguous prior recommendation, clarify the paper. save records preference only; importing requires the separate library import flow.",
    },
    validate(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return fail("Expected recommendationId, candidateId, action");
      const r = raw as Input;
      if (
        Object.keys(r).some(
          (k) => !["recommendationId", "candidateId", "action"].includes(k),
        )
      )
        return fail("Unsupported feedback field");
      try {
        feedbackEventId(r.recommendationId, r.candidateId, r.action);
        return ok({
          recommendationId: r.recommendationId,
          candidateId: r.candidateId,
          action: r.action,
        });
      } catch {
        return fail("Invalid feedback identity or action");
      }
    },
    planMutation: () => ({
      effect: "write",
      reversibility: "none",
      requiresConfirmation: true,
      reason:
        "Append-only recommendation memory feedback has no undo operation.",
    }),
    createPendingAction: (input) => ({
      toolName: "recommendation_feedback",
      title: "Record recommendation feedback",
      description: `${input.action}: ${input.candidateId}. Updates research interests; save is a preference signal only.`,
      confirmLabel: "Record feedback",
      cancelLabel: "Cancel",
      fields: [],
    }),
    async execute(input, context) {
      const validated = this.validate(input);
      if (!validated.ok) throw new Error("Invalid feedback arguments");
      if (context.signal?.aborted) throw new Error("Feedback cancelled");
      const content = await service.submit({
        ...validated.value,
        libraryID: resolveProfileLibraryID(context),
        timestamp: now(),
      });
      return {
        content,
        effect:
          content.status === "recorded" || content.profileUpdated
            ? "applied"
            : "none",
      };
    },
  };
}
