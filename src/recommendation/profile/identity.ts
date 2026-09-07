export function assertLibraryID(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError("libraryID must be a positive safe integer");
  }
}

export function profileIdForLibrary(libraryID: number): string {
  assertLibraryID(libraryID);
  return `library:${libraryID}`;
}

/** Local numeric identity only. Cross-device Zotero key migration is deferred. */
export function paperIdForLibraryItem(
  libraryID: number,
  itemID: number,
): string {
  assertLibraryID(libraryID);
  if (!Number.isSafeInteger(itemID) || itemID <= 0) {
    throw new TypeError("itemID must be a positive safe integer");
  }
  return `library:${libraryID}:item:${itemID}`;
}
