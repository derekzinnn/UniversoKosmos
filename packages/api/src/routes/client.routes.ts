import { Router } from 'express';
import {
  clientDrilldownHandler,
  setLessonVisibilityHandler,
} from '../controllers/client-drilldown.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { lessonVisibilitySchema } from '../schemas/client.schemas.js';

export const clientRouter: Router = Router();

clientRouter.use(authenticate);

/**
 * The per-client drill-down — one company's onboarding, lesson by lesson.
 * Kosmos staff only, and the service reaches into that one tenant through
 * `runAsSuperadminOnTenant`, which records the access as `TENANT_SCOPE_OVERRIDDEN`.
 */
clientRouter.get('/:tenantId', requireRole('SUPERADMIN'), clientDrilldownHandler);

/**
 * Hide or show one lesson for this client. Same audited reach-into-one-tenant
 * as the drill-down; the body is `{ visible: boolean }`. PATCH, matching the
 * codebase's other partial updates (and the CORS allow-list).
 */
clientRouter.patch(
  '/:tenantId/lessons/:lessonId/visibility',
  requireRole('SUPERADMIN'),
  validateBody(lessonVisibilitySchema),
  setLessonVisibilityHandler,
);
