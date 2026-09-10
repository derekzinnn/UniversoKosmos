import { Router } from 'express';
import {
  archiveTenantHandler,
  createTenantHandler,
  deleteTenantHandler,
  getTenantHandler,
  listTenantsHandler,
  reactivateTenantHandler,
  updateTenantHandler,
} from '../controllers/tenant.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import { createTenantSchema, updateTenantSchema } from '../schemas/tenant.schemas.js';

export const tenantRouter: Router = Router();

tenantRouter.use(authenticate);

tenantRouter.post(
  '/',
  requireRole('SUPERADMIN'),
  validateBody(createTenantSchema),
  createTenantHandler,
);

/**
 * Not restricted by role: the tenant guard already limits a client user to
 * their own company, so this returns every tenant for Kosmos staff and
 * exactly one for everybody else.
 */
tenantRouter.get('/', listTenantsHandler);
tenantRouter.get('/:id', getTenantHandler);

tenantRouter.patch(
  '/:id',
  requireRole('SUPERADMIN'),
  validateBody(updateTenantSchema),
  updateTenantHandler,
);

// Archive (the reversible "remove") and its undo. No body — the id is the whole
// request — so no validateBody. SUPERADMIN only, like every other write here.
tenantRouter.post('/:id/archive', requireRole('SUPERADMIN'), archiveTenantHandler);
tenantRouter.post('/:id/reactivate', requireRole('SUPERADMIN'), reactivateTenantHandler);

// Permanent, irreversible delete. Guarded in the service to archived clients
// only, so this is always the second half of a deliberate two-step removal.
tenantRouter.delete('/:id', requireRole('SUPERADMIN'), deleteTenantHandler);
