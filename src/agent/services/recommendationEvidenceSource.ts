import type {
  EvidenceContentSource,
  EvidenceRecord,
} from "../../recommendation/evidence/contracts";
import { EVIDENCE_CONFIG as config } from "../../recommendation/evidence/contracts";
import type { ZoteroGateway } from "./zoteroGateway";
import type { PdfService } from "./pdfService";

/** Only explicitly linked library items; no search, parsing, network or writes. */
export class AgentRecommendationEvidenceSource implements EvidenceContentSource {
  constructor(
    private readonly gateway: ZoteroGateway,
    private readonly pdf: PdfService,
  ) {}
  private item(id: string): Zotero.Item | undefined {
    const match = /^library:(\d+):item:(\d+)$/u.exec(id);
    if (!match) return undefined;
    const item = this.gateway.getItem(Number(match[2]));
    return item &&
      !item.deleted &&
      item.libraryID === Number(match[1]) &&
      item.isRegularItem?.()
      ? item
      : undefined;
  }
  async notes(itemId: string): Promise<EvidenceRecord[]> {
    const item = this.item(itemId);
    if (!item) return [];
    return this.gateway
      .getPaperNotes({ item, maxNotes: config.maxSourceRecords })
      .map((n) => ({
        reference: `${itemId}#note:${n.noteId}`,
        text: n.noteText.slice(0, config.maxScanChars),
      }));
  }
  async content(itemId: string): Promise<EvidenceRecord[]> {
    const item = this.item(itemId);
    if (!item) return [];
    const cached = this.pdf.getCachedRecommendationContent(item);
    return (
      cached?.chunks.slice(0, config.maxSourceRecords).map((text, i) => ({
        reference: `${itemId}#attachment:${cached.attachmentId}:chunk:${i}`,
        text,
      })) ?? []
    );
  }
}
