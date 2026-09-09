import type { CandidateProvenance } from "../domain/candidate";

function identifierText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && !/[\p{Cc}\p{Cs}]/u.test(text) ? text : undefined;
}

function identifierUrl(value: string): URL | undefined {
  if (!/^https?:\/\//i.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.username || url.password ? undefined : url;
  } catch {
    return undefined;
  }
}

/** DOI comparison is case insensitive; URL query/fragment are not DOI text. */
export function normalizeDoi(value: unknown): string | undefined {
  let text = identifierText(value);
  if (!text) return undefined;
  text = text.replace(/^doi\s*:\s*/i, "");
  const url = identifierUrl(text);
  if (url) {
    if (!["doi.org", "dx.doi.org"].includes(url.hostname.toLowerCase()))
      return undefined;
    try {
      text = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return undefined;
    }
  }
  text = text.trim().toLowerCase();
  return /^10\.\d{4,9}\/[^\s\p{Cc}\p{Cs}]+$/u.test(text) ? text : undefined;
}

export function normalizeArxivId(value: unknown): string | undefined {
  let text = identifierText(value);
  if (!text) return undefined;
  text = text.replace(/^arxiv\s*:\s*/i, "");
  const url = identifierUrl(text);
  if (url) {
    if (
      !["arxiv.org", "www.arxiv.org", "export.arxiv.org"].includes(
        url.hostname.toLowerCase(),
      )
    )
      return undefined;
    text = url.pathname.replace(/^\/(?:abs|pdf)\//i, "");
  }
  text = text
    .replace(/\.pdf$/i, "")
    .replace(/v\d+$/i, "")
    .toLowerCase();
  return /^(?:\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z][a-z.-]*(?:\.[a-z]{2})?\/\d{7})$/.test(
    text,
  )
    ? text
    : undefined;
}

export function normalizeOpenAlexId(value: unknown): string | undefined {
  let text = identifierText(value);
  if (!text) return undefined;
  const url = identifierUrl(text);
  if (url) {
    if (url.hostname.toLowerCase() === "openalex.org")
      text = url.pathname.slice(1);
    else if (url.hostname.toLowerCase() === "api.openalex.org")
      text = url.pathname.replace(/^\/works\//i, "");
    else return undefined;
  }
  text = text.replace(/^openalex\s*:\s*/i, "").toUpperCase();
  return /^W\d+$/.test(text) ? text : undefined;
}

export function normalizeBibliographicText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  return text && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(text) ? text : undefined;
}

export function normalizePublicationYear(value: unknown): string | undefined {
  if (typeof value === "number")
    return Number.isInteger(value) && value >= 1000 && value <= 9999
      ? String(value)
      : undefined;
  if (typeof value !== "string") return undefined;
  return /^([1-9]\d{3})(?:-\d{2}(?:-\d{2})?)?$/.exec(value.trim())?.[1];
}

export interface PaperIdentityInput {
  title: string;
  authors: readonly string[];
  doi?: string;
  arxivId?: string;
  openAlexId?: string;
  publicationDate?: string;
  year?: string;
}

export interface PaperIdentity {
  doi?: string;
  arxivId?: string;
  openAlexId?: string;
  year?: string;
  bibliographicKeys: string[];
}

/** Exact title with year or first author. Short/generic titles do not qualify. */
export function paperIdentity(paper: PaperIdentityInput): PaperIdentity {
  const title = normalizeBibliographicText(paper.title)?.toLowerCase();
  const year = normalizePublicationYear(paper.publicationDate ?? paper.year);
  const author = normalizeBibliographicText(paper.authors[0])?.toLowerCase();
  const substantialTitle =
    title &&
    (title.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 20 &&
    ((title.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 3 ||
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{12}/u.test(
        title,
      ));
  const bibliographicKeys = substantialTitle
    ? [
        ...(year
          ? [
              `bibliographic:${encodeURIComponent(JSON.stringify([title, "year", year]))}`,
            ]
          : []),
        ...(author
          ? [
              `bibliographic:${encodeURIComponent(JSON.stringify([title, "author", author]))}`,
            ]
          : []),
      ]
    : [];
  return {
    doi: normalizeDoi(paper.doi),
    arxivId: normalizeArxivId(paper.arxivId),
    openAlexId: normalizeOpenAlexId(paper.openAlexId),
    year,
    bibliographicKeys,
  };
}

export function provenanceKey(entry: CandidateProvenance): string {
  return JSON.stringify(
    entry.route === "profile_query"
      ? [
          entry.route,
          entry.provider,
          entry.providerRank,
          entry.query,
          entry.topicId ?? null,
          entry.focus ?? false,
        ]
      : [entry.route, entry.provider, entry.providerRank, entry.seedPaperId],
  );
}

export function candidateIdentity(
  paper: PaperIdentityInput,
  provenance: CandidateProvenance,
): string {
  const identity = paperIdentity(paper);
  if (identity.doi) return `doi:${identity.doi}`;
  if (identity.arxivId) return `arxiv:${identity.arxivId}`;
  if (identity.openAlexId) return `openalex:${identity.openAlexId}`;
  if (identity.bibliographicKeys.length) return identity.bibliographicKeys[0];
  // An occurrence ID preserves an otherwise useful result without claiming
  // that two ambiguous titles identify the same paper across recall routes.
  return `unresolved:${encodeURIComponent(provenanceKey(provenance))}`;
}

/** Conflicting stronger identifiers block a weaker-ID or title merge. */
export function identitiesCompatible(
  a: PaperIdentity,
  b: PaperIdentity,
): boolean {
  if (a.doi && b.doi) return a.doi === b.doi;
  if (a.arxivId && b.arxivId) return a.arxivId === b.arxivId;
  if (a.openAlexId && b.openAlexId) return a.openAlexId === b.openAlexId;
  return true;
}

export function samePaper(a: PaperIdentity, b: PaperIdentity): boolean {
  if (!identitiesCompatible(a, b)) return false;
  if (
    (a.doi && a.doi === b.doi) ||
    (a.arxivId && a.arxivId === b.arxivId) ||
    (a.openAlexId && a.openAlexId === b.openAlexId)
  )
    return true;
  if (a.year && b.year && a.year !== b.year) return false;
  return a.bibliographicKeys.some((key) => b.bibliographicKeys.includes(key));
}
