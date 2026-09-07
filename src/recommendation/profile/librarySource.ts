import type { LibraryIndexSnapshot } from "../../services/libraryIndex/contracts";
import type {
  ResearchLibrarySource,
  ResearchLibrarySnapshot,
} from "./contracts";
import { assertLibraryID, paperIdForLibraryItem } from "./identity";
import { compareText } from "./topicNormalization";

type LibraryIndexReader = {
  getSnapshot(libraryID: number): Promise<LibraryIndexSnapshot>;
};

const strings = (values: readonly string[]) =>
  [
    ...new Set(
      values
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim()),
    ),
  ].sort(compareText);
const timestamp = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** The index is the only Zotero metadata projection; no UI or item traversal here. */
export class IndexedResearchLibrarySource implements ResearchLibrarySource {
  constructor(private readonly index: LibraryIndexReader) {}

  async getLibrarySnapshot(
    libraryID: number,
  ): Promise<ResearchLibrarySnapshot> {
    assertLibraryID(libraryID);
    const snapshot = await this.index.getSnapshot(libraryID);
    if (snapshot.libraryID !== libraryID)
      throw new Error("Library snapshot scope mismatch");
    const papers = [...snapshot.itemById.values()]
      .filter(
        (item) =>
          item.libraryID === libraryID &&
          item.kind === "regular" &&
          item.deleted === false &&
          typeof item.title === "string" &&
          item.title.trim(),
      )
      .map((item) => ({
        itemId: paperIdForLibraryItem(libraryID, item.itemId),
        title: item.title.trim(),
        abstract: item.abstractNote || undefined,
        authors: strings(item.creators),
        manualTags: strings(item.tags),
        automaticTags: strings(item.automaticTags),
        collectionPaths: strings(
          item.collectionIds.flatMap((id) => {
            const collection = snapshot.collectionById.get(id);
            if (
              !collection ||
              collection.deleted ||
              collection.libraryID !== libraryID
            )
              return [];
            return [snapshot.collectionPathById.get(id) || collection.name];
          }),
        ),
        year: item.year || undefined,
        addedAt: timestamp(item.addedAt),
        modifiedAt: timestamp(item.modifiedAt),
      }))
      .sort((a, b) => compareText(a.itemId, b.itemId));
    return { libraryID, papers };
  }
}
