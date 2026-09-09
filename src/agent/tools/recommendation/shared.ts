import type { AgentToolContext } from "../../types";
import { assertLibraryID } from "../../../recommendation/profile/identity";
import { UtilityTopicExtractor } from "../../../recommendation/profile/utilityTopicExtractor";

/** Request scope wins; invalid supplied scope never falls back to another library. */
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

export function createProfileTopicExtractor(
  context: AgentToolContext,
): UtilityTopicExtractor {
  const request = context.request;
  return new UtilityTopicExtractor({
    model: request.model || context.modelName,
    apiBase: request.apiBase,
    apiKey: request.apiKey,
    authMode: request.authMode,
    providerProtocol: request.providerProtocol,
    profileOverride: request.advanced?.profileOverride,
  });
}
