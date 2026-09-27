import { z } from 'zod';

/** Toggling one lesson's visibility for one client company. */
export const lessonVisibilitySchema = z.object({
  visible: z.boolean(),
});

export type LessonVisibilityBody = z.infer<typeof lessonVisibilitySchema>;
