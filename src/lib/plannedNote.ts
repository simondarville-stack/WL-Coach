// The single per-planned-exercise note.
//
// Historically planned exercises carried two coach note fields with the same
// author and audience: `notes` (free text) and `variation_note` (short
// qualifier shown inline). They are folded into ONE note: `notes` is the
// written field; `variation_note` is legacy-read-only and surfaces only while
// no `notes` value exists. Editing the note writes `notes` and clears
// `variation_note`, so legacy content migrates lazily without a data
// migration. Use this helper everywhere a planned exercise note is displayed
// so no surface re-implements the fallback.

export function plannedNote(ex: {
  notes?: string | null;
  variation_note?: string | null;
}): string | null {
  const note = ex.notes?.trim() ? ex.notes.trim() : ex.variation_note?.trim() || null;
  return note;
}
