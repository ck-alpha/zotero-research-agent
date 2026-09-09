export interface ResearchPaperSignal {
  itemId: string;
  title: string;
  abstract?: string;
  /** Optional lookup identity; never an interest signal. */
  doi?: string;
  authors: string[];
  manualTags: string[];
  automaticTags: string[];
  collectionPaths: string[];
  year?: string;
  addedAt: number;
  modifiedAt: number;
}

export interface ResearchLibrarySnapshot {
  libraryID: number;
  papers: ResearchPaperSignal[];
}

export interface ResearchLibrarySource {
  getLibrarySnapshot(libraryID: number): Promise<ResearchLibrarySnapshot>;
}

export interface ExtractedTopic {
  label: string;
  confidence: number;
  supportingPaperIds: string[];
}

export interface TopicExtractionResult {
  topics: ExtractedTopic[];
  warnings: string[];
}

export interface TopicExtractor {
  extract(
    papers: readonly ResearchPaperSignal[],
    signal?: AbortSignal,
  ): Promise<TopicExtractionResult>;
}
