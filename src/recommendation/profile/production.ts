import { libraryIndexService } from "../../services/libraryIndexService";
import { IndexedResearchLibrarySource } from "./librarySource";
import { SqliteProfileStore } from "./profileStore";
import { ProfileService } from "./profileService";

/** Lazy DB initialization; registration never requires Zotero.DB or a model. */
export function createProductionProfileService(): ProfileService {
  return new ProfileService(
    new SqliteProfileStore(),
    new IndexedResearchLibrarySource(libraryIndexService),
  );
}
