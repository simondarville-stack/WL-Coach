// Exercise parent–child (tree) hierarchy — the single source of truth for
// child→parent rollup. Every surface that folds a child's work into its parent
// (the analysis engine's fact builder, the planner week/print summaries, macro
// views, and the catalogue tree UI) resolves relationships through THIS module
// so no two surfaces can disagree (CLAUDE.md non-negotiable #3: single source of
// truth per concept).
//
// Pure and dependency-free. It works on any object exposing
// `{ id, parent_exercise_id }` (satisfied by both the UI `Exercise` and the
// analysis `RawExercise`), so it is trivially unit-testable and reusable by the
// Supabase-fed engine and the Zustand-fed UI alike.
//
// Trees are ARBITRARY DEPTH. Every walk carries a visited-set cycle guard, so a
// corrupted row (A→B→A, or a self-loop that slipped past the DB CHECK / bulk
// import) can NEVER infinite-loop a render or an aggregation pass — the walk
// stops at the first repeat and returns a safe, deterministic result. The real
// cycle *prevention* lives in `wouldCreateCycle` (the picker/drag guard); these
// walks are the defensive backstop.

/** Minimal shape the resolver needs. Satisfied by `Exercise`, `ExerciseStub`
 *  (when `parent_exercise_id` is present), and the analysis `RawExercise`. */
export interface HierNode {
  id: string;
  parent_exercise_id: string | null;
}

/** id → immediate parent id (or null for a root / unknown parent). */
export type ParentIndex = Map<string, string | null>;

/** parent id → ordered child ids. Roots are not keyed. */
export type ChildrenIndex = Map<string, string[]>;

/** Build the id → parent-id lookup once, then reuse it across every walk. */
export function buildParentIndex(nodes: Iterable<HierNode>): ParentIndex {
  const index: ParentIndex = new Map();
  for (const n of nodes) index.set(n.id, n.parent_exercise_id ?? null);
  return index;
}

/** Build the parent id → child ids lookup. Insertion order is preserved. */
export function buildChildrenIndex(nodes: Iterable<HierNode>): ChildrenIndex {
  const index: ChildrenIndex = new Map();
  for (const n of nodes) {
    const parent = n.parent_exercise_id;
    if (parent == null) continue;
    const arr = index.get(parent);
    if (arr) arr.push(n.id);
    else index.set(parent, [n.id]);
  }
  return index;
}

/**
 * Walk from `id` up to its ROOT ancestor — the bucket a child rolls up into.
 *
 * - A root (no parent) resolves to itself.
 * - A dangling parent (not present in the index, e.g. archived/other-owner)
 *   is treated as the top: the current node is the root.
 * - An unknown `id` resolves to itself (defensive).
 * - A cycle is broken safely: the walk stops at the first repeated node, so
 *   each node in a loop deterministically becomes its own root (never hangs).
 */
export function resolveRootId(id: string, index: ParentIndex): string {
  const visited = new Set<string>();
  let current = id;
  for (;;) {
    if (visited.has(current)) return current; // cycle — stop at the repeat
    visited.add(current);
    const parent = index.get(current);
    if (parent == null || parent === current || !index.has(parent)) return current;
    current = parent;
  }
}

/**
 * The chain `[self, parent, …, root]` for `id`, nearest-first. Cycle-safe (a
 * repeat ends the walk). Useful for breadcrumbs and depth. Always contains at
 * least `[id]`.
 */
export function resolveAncestorPath(id: string, index: ParentIndex): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let current: string | null = id;
  while (current != null && !visited.has(current)) {
    visited.add(current);
    path.push(current);
    const parent = index.get(current);
    if (parent == null || !index.has(parent)) break;
    current = parent;
  }
  return path;
}

/** Depth from the root: a root is 0, its direct children are 1, etc. */
export function depthOf(id: string, index: ParentIndex): number {
  return resolveAncestorPath(id, index).length - 1;
}

/**
 * Would linking `childId`'s parent to `candidateParentId` create a cycle?
 * True when they are the same node, or when `childId` is already an ancestor of
 * `candidateParentId` (i.e. the candidate is a descendant of the child). This
 * is the guard the exercise-form parent picker and the drag-to-reparent drop
 * target use to reject invalid links BEFORE they reach the database.
 */
export function wouldCreateCycle(
  childId: string,
  candidateParentId: string,
  index: ParentIndex,
): boolean {
  if (childId === candidateParentId) return true;
  const visited = new Set<string>();
  let current: string | null | undefined = candidateParentId;
  while (current != null && !visited.has(current)) {
    if (current === childId) return true; // child is an ancestor of the candidate
    visited.add(current);
    current = index.get(current) ?? null;
  }
  return false;
}

/**
 * All transitive descendant ids of `id` (children, grandchildren, …), excluding
 * `id` itself. Cycle-safe. Drives "can't drop onto your own descendant" and
 * "what detaches when this parent is removed".
 */
export function getDescendantIds(id: string, childrenIndex: ChildrenIndex): Set<string> {
  const out = new Set<string>();
  const stack = [...(childrenIndex.get(id) ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (out.has(cur) || cur === id) continue; // visited / self-loop guard
    out.add(cur);
    const kids = childrenIndex.get(cur);
    if (kids) for (const k of kids) if (!out.has(k)) stack.push(k);
  }
  return out;
}

/**
 * Convenience for grouping: resolve `id` to its family label (the root
 * ancestor's display name). `nameById` looks up a node's label; `fallback` is
 * used when the root has no known name (e.g. a deleted exercise). This is the
 * exact key the analysis `family` dimension and the planner "by family" summary
 * group on.
 */
export function resolveFamilyName(
  id: string,
  index: ParentIndex,
  nameById: (id: string) => string | undefined,
  fallback: string,
): string {
  return nameById(resolveRootId(id, index)) ?? fallback;
}
