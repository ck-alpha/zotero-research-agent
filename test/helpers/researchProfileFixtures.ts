import type {
  LibraryIndexItem,
  LibraryIndexSnapshot,
} from "../../src/services/libraryIndex/contracts";
import type { ResearchPaperSignal } from "../../src/recommendation/profile/contracts";
import { paperIdForLibraryItem } from "../../src/recommendation/profile/identity";
import type { ExplicitPreferences } from "../../src/recommendation/domain/profile";

export const PROFILE_NOW = Date.UTC(2026, 8, 7);
export function paperSignal(
  id = 1,
  patch: Partial<ResearchPaperSignal> = {},
): ResearchPaperSignal {
  return {
    itemId: paperIdForLibraryItem(1, id),
    title: `Paper ${id}`,
    abstract: "A research abstract",
    authors: ["A. Author"],
    manualTags: ["Agents"],
    automaticTags: ["Unreliable automatic tag"],
    collectionPaths: [],
    addedAt: PROFILE_NOW,
    modifiedAt: PROFILE_NOW,
    ...patch,
  };
}
export function preferences(): ExplicitPreferences {
  return {
    positiveTopics: [
      {
        id: "positive-1",
        label: "Agents",
        strength: 1,
        createdAt: PROFILE_NOW - 100,
        updatedAt: PROFILE_NOW - 50,
      },
    ],
    negativeTopics: [
      {
        id: "negative-1",
        label: "Prompting",
        strength: 0.9,
        createdAt: PROFILE_NOW - 100,
        updatedAt: PROFILE_NOW - 50,
      },
    ],
  };
}
export function indexedItem(
  id = 1,
  patch: Partial<LibraryIndexItem> = {},
): LibraryIndexItem {
  return {
    itemId: id,
    libraryID: 1,
    itemType: "journalArticle",
    kind: "regular",
    title: `Paper ${id}`,
    shortTitle: "",
    citationKey: "",
    doi: "",
    creators: ["A. Author"],
    firstCreator: "A. Author",
    publicationTitle: "",
    venue: "",
    date: "2026",
    year: "2026",
    abstractNote: "An abstract",
    extra: "",
    tags: ["Agents"],
    automaticTags: ["Automatic"],
    collectionIds: [10],
    attachmentIds: [],
    childNoteIds: [],
    dateAdded: "2026-09-07",
    dateModified: "2026-09-07",
    addedAt: PROFILE_NOW,
    modifiedAt: PROFILE_NOW,
    deleted: false,
    ...patch,
  };
}
export function indexSnapshot(
  items: LibraryIndexItem[] = [indexedItem()],
  libraryID = 1,
): LibraryIndexSnapshot {
  return {
    libraryID,
    libraryName: "Research",
    epoch: 1,
    builtAt: PROFILE_NOW,
    itemById: new Map(items.map((item) => [item.itemId, item])),
    topLevelItemOrder: items.map((item) => item.itemId),
    attachmentById: new Map(),
    childAttachmentIdsByItemId: new Map(),
    pdfAttachmentIdsByItemId: new Map(),
    childNoteIdsByItemId: new Map(),
    childNoteById: new Map(),
    parentItemIdByChildId: new Map(),
    collectionById: new Map([
      [
        10,
        {
          collectionId: 10,
          libraryID,
          name: "Agents",
          parentCollectionId: 9,
          deleted: false,
        },
      ],
    ]),
    directItemIdsByCollectionId: new Map(),
    childCollectionIdsByCollectionId: new Map(),
    collectionPathById: new Map([[10, "Research / Agents"]]),
    tagByNormalizedName: new Map(),
    normalizedTagNameByTagId: new Map(),
    tagIdsByNormalizedName: new Map(),
    unfiledItemIds: new Set(),
    untaggedItemIds: new Set(),
    pdfCapableItemIds: new Set(),
    searchableFieldsByItemId: new Map(),
  };
}
