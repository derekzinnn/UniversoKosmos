import { describe, expect, it } from 'vitest';
import type { UnlockModule } from './unlock.js';
import {
  isModuleComplete,
  isTrackComplete,
  lessonsInOrder,
  nextLessonId,
  unlockedLessonIds,
} from './unlock.js';

function module_(id: string, order: number, lessons: [string, number, boolean][]): UnlockModule {
  return {
    id,
    order,
    lessons: lessons.map(([lessonId, lessonOrder, isRequired]) => ({
      id: lessonId,
      order: lessonOrder,
      isRequired,
    })),
  };
}

/** Two modules, three lessons: m1[a, b] then m2[c]. All required. */
const track: UnlockModule[] = [
  module_('m1', 0, [
    ['a', 0, true],
    ['b', 1, true],
  ]),
  module_('m2', 1, [['c', 0, true]]),
];

const ordered = lessonsInOrder(track);

describe('lessonsInOrder', () => {
  it('walks modules then lessons, both by position', () => {
    expect(ordered.map((lesson) => lesson.id)).toEqual(['a', 'b', 'c']);
    expect(ordered.map((lesson) => lesson.index)).toEqual([0, 1, 2]);
  });

  it('sorts input that arrives out of order', () => {
    const scrambled = lessonsInOrder([
      module_('m2', 1, [['c', 0, true]]),
      module_('m1', 0, [
        ['b', 1, true],
        ['a', 0, true],
      ]),
    ]);
    expect(scrambled.map((lesson) => lesson.id)).toEqual(['a', 'b', 'c']);
  });

  it('carries the owning module down to each lesson', () => {
    expect(ordered.map((lesson) => lesson.moduleId)).toEqual(['m1', 'm1', 'm2']);
  });
});

describe('unlockedLessonIds', () => {
  it('opens the first lesson to somebody who has watched nothing', () => {
    expect([...unlockedLessonIds(ordered, new Set())]).toEqual(['a']);
  });

  it('keeps the current lesson open — locking it would leave no way forward', () => {
    const unlocked = unlockedLessonIds(ordered, new Set());
    expect(unlocked.has('a')).toBe(true);
  });

  it('opens the next lesson once the current one is finished', () => {
    expect([...unlockedLessonIds(ordered, new Set(['a']))]).toEqual(['a', 'b']);
  });

  it('crosses a module boundary like any other step', () => {
    expect([...unlockedLessonIds(ordered, new Set(['a', 'b']))]).toEqual(['a', 'b', 'c']);
  });

  it('never blocks on an optional lesson', () => {
    const withOptional = lessonsInOrder([
      module_('m1', 0, [
        ['a', 0, false],
        ['b', 1, true],
        ['c', 2, true],
      ]),
    ]);
    // `a` is unwatched but optional, so `b` still opens. `b` is required and
    // unwatched, so `c` does not.
    expect([...unlockedLessonIds(withOptional, new Set())]).toEqual(['a', 'b']);
  });

  it('does not let a later completion unlock past an earlier gap', () => {
    // Somebody who somehow completed `c` without `a` still cannot open `c`.
    expect([...unlockedLessonIds(ordered, new Set(['c']))]).toEqual(['a']);
  });

  it('opens everything once everything is done', () => {
    expect([...unlockedLessonIds(ordered, new Set(['a', 'b', 'c']))]).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for a trilha with no lessons', () => {
    expect([...unlockedLessonIds(lessonsInOrder([]), new Set())]).toEqual([]);
  });
});

describe('nextLessonId', () => {
  it('points at the first unfinished required lesson', () => {
    expect(nextLessonId(ordered, new Set(['a']))).toBe('b');
  });

  it('falls back to an unwatched optional lesson once the required ones are done', () => {
    const withOptional = lessonsInOrder([
      module_('m1', 0, [
        ['a', 0, true],
        ['extra', 1, false],
      ]),
    ]);
    expect(nextLessonId(withOptional, new Set(['a']))).toBe('extra');
  });

  it('is null when there is nothing left', () => {
    expect(nextLessonId(ordered, new Set(['a', 'b', 'c']))).toBeNull();
  });
});

describe('isTrackComplete', () => {
  it('is true when every required lesson is done', () => {
    expect(isTrackComplete(ordered, new Set(['a', 'b', 'c']))).toBe(true);
  });

  it('ignores unfinished optional lessons', () => {
    const withOptional = lessonsInOrder([
      module_('m1', 0, [
        ['a', 0, true],
        ['extra', 1, false],
      ]),
    ]);
    expect(isTrackComplete(withOptional, new Set(['a']))).toBe(true);
  });

  it('is false while anything required is outstanding', () => {
    expect(isTrackComplete(ordered, new Set(['a', 'b']))).toBe(false);
  });

  it('is false for an empty trilha — finishing nothing is not finishing', () => {
    expect(isTrackComplete(lessonsInOrder([]), new Set())).toBe(false);
  });

  it('is false for a trilha of only optional lessons', () => {
    const optionalOnly = lessonsInOrder([module_('m1', 0, [['a', 0, false]])]);
    expect(isTrackComplete(optionalOnly, new Set())).toBe(false);
  });
});

describe('isModuleComplete', () => {
  it('is true when every required lesson in that module is done', () => {
    // m1 needs a and b; c belongs to m2 and does not count.
    expect(isModuleComplete(ordered, 'm1', new Set(['a', 'b']))).toBe(true);
  });

  it('is scoped to the one module — a finished m2 does not complete m1', () => {
    expect(isModuleComplete(ordered, 'm1', new Set(['c']))).toBe(false);
  });

  it('closes an earlier module before the whole trilha is done', () => {
    // m1 is complete on a+b even though c (m2) is still outstanding.
    expect(isModuleComplete(ordered, 'm1', new Set(['a', 'b']))).toBe(true);
    expect(isTrackComplete(ordered, new Set(['a', 'b']))).toBe(false);
  });

  it('is false while anything required in the module is outstanding', () => {
    expect(isModuleComplete(ordered, 'm1', new Set(['a']))).toBe(false);
  });

  it('ignores unfinished optional lessons in the module', () => {
    const withOptional = lessonsInOrder([
      module_('m1', 0, [
        ['a', 0, true],
        ['extra', 1, false],
      ]),
    ]);
    expect(isModuleComplete(withOptional, 'm1', new Set(['a']))).toBe(true);
  });

  it('is false for a module of only optional lessons — nothing must be done', () => {
    const optionalOnly = lessonsInOrder([module_('m1', 0, [['a', 0, false]])]);
    expect(isModuleComplete(optionalOnly, 'm1', new Set())).toBe(false);
  });

  it('is false for a module id that is not in the trilha', () => {
    expect(isModuleComplete(ordered, 'nope', new Set(['a', 'b', 'c']))).toBe(false);
  });
});
