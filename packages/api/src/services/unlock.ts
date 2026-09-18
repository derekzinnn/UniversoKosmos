/**
 * Sequential unlock.
 *
 * A trilha is walked in order: modules by position, lessons by position inside
 * each module. A lesson opens once every *required* lesson before it has been
 * completed. Optional lessons never block anybody.
 *
 * Everything here is pure — no database, no scope, no clock. That is
 * deliberate: this is the rule that decides what a client is allowed to open,
 * and a rule of that weight should be checkable without standing up
 * PostgreSQL. The service layer supplies the facts; this file supplies the
 * verdict.
 */

export interface UnlockLesson {
  readonly id: string;
  readonly order: number;
  readonly isRequired: boolean;
}

export interface UnlockModule<L extends UnlockLesson = UnlockLesson> {
  readonly id: string;
  readonly order: number;
  readonly lessons: readonly L[];
}

/** Where a lesson sits once the trilha is laid out flat. */
export interface LessonPosition {
  readonly moduleId: string;
  readonly moduleOrder: number;
  /** Position across the whole trilha, not within the module. */
  readonly index: number;
}

/**
 * Generic over the lesson so callers keep their own fields.
 *
 * The unlock rule needs `isRequired` and nothing else, but the caller almost
 * always needs more — the duration, the title — from the same row. Widening
 * here means the service does not have to look each lesson up a second time
 * against the object it just flattened.
 */
export type OrderedLesson<L extends UnlockLesson = UnlockLesson> = L & LessonPosition;

/**
 * Every lesson in the order a client meets them.
 *
 * Sorted here rather than trusted from the caller. Positions are kept
 * contiguous and the repositories already order by them, so this sort is
 * almost always a no-op — but a pure function whose contract includes "and you
 * must have sorted it first" is a trap for whoever calls it next.
 */
export function lessonsInOrder<L extends UnlockLesson>(
  modules: readonly UnlockModule<L>[],
): OrderedLesson<L>[] {
  const ordered: OrderedLesson<L>[] = [];

  for (const module of [...modules].sort((a, b) => a.order - b.order)) {
    for (const lesson of [...module.lessons].sort((a, b) => a.order - b.order)) {
      ordered.push({
        ...lesson,
        moduleId: module.id,
        moduleOrder: module.order,
        index: ordered.length,
      });
    }
  }

  return ordered;
}

/**
 * Which lessons the client may open.
 *
 * Everything up to and including the first unfinished required lesson. That
 * lesson is itself unlocked — it is the one they are meant to do next, and
 * locking it would leave the trilha with no way forward.
 */
export function unlockedLessonIds(
  ordered: readonly OrderedLesson[],
  completedLessonIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const unlocked = new Set<string>();
  let blocked = false;

  for (const lesson of ordered) {
    if (blocked) break;
    unlocked.add(lesson.id);
    if (lesson.isRequired && !completedLessonIds.has(lesson.id)) blocked = true;
  }

  return unlocked;
}

/** The lesson a client should be sent to when they open the trilha. */
export function nextLessonId(
  ordered: readonly OrderedLesson[],
  completedLessonIds: ReadonlySet<string>,
): string | null {
  const pending = ordered.find((lesson) => lesson.isRequired && !completedLessonIds.has(lesson.id));
  if (pending) return pending.id;

  // Every required lesson is done. Send them to the first optional one they
  // have not seen, and if there is none, the trilha is finished.
  const optional = ordered.find((lesson) => !completedLessonIds.has(lesson.id));
  return optional?.id ?? null;
}

/**
 * A trilha counts as finished when every required lesson is finished.
 *
 * Optional lessons are excluded on purpose: making an extra become a
 * prerequisite for the certificate would mean nobody could safely publish one.
 * An empty trilha is not complete — it is unpublishable, and treating it as
 * finished would let a client "complete" nothing at all.
 */
export function isTrackComplete(
  ordered: readonly OrderedLesson[],
  completedLessonIds: ReadonlySet<string>,
): boolean {
  const required = ordered.filter((lesson) => lesson.isRequired);
  if (required.length === 0) return false;
  return required.every((lesson) => completedLessonIds.has(lesson.id));
}

/**
 * A single module counts as finished when every *required* lesson inside it is
 * finished — the trilha rule, scoped to one module. Optional lessons never
 * block, and a module with no required lessons never "completes" (there is
 * nothing that must be done), exactly as an all-optional trilha never does.
 */
export function isModuleComplete(
  ordered: readonly OrderedLesson[],
  moduleId: string,
  completedLessonIds: ReadonlySet<string>,
): boolean {
  const required = ordered.filter((lesson) => lesson.moduleId === moduleId && lesson.isRequired);
  if (required.length === 0) return false;
  return required.every((lesson) => completedLessonIds.has(lesson.id));
}
