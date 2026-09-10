import type { Request, Response } from 'express';
import { requireContext } from '../middleware/authenticate.js';
import type { CreateTenantBody, UpdateTenantBody } from '../schemas/tenant.schemas.js';
import {
  archiveTenant,
  createTenant,
  deleteTenant,
  getTenant,
  listTenants,
  reactivateTenant,
  updateTenant,
} from '../services/tenant.service.js';

export async function createTenantHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateTenantBody;

  const tenant = await createTenant(requireContext(req), {
    name: body.name,
    slug: body.slug,
    contractSignedAt: body.contractSignedAt ?? null,
  });

  res.status(201).json({ tenant });
}

export async function listTenantsHandler(req: Request, res: Response): Promise<void> {
  res.json({ tenants: await listTenants(requireContext(req)) });
}

export async function getTenantHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  res.json({ tenant: await getTenant(requireContext(req), id) });
}

export async function updateTenantHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  const body = req.body as UpdateTenantBody;
  res.json({ tenant: await updateTenant(requireContext(req), id, { name: body.name }) });
}

export async function archiveTenantHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  res.json({ tenant: await archiveTenant(requireContext(req), id) });
}

export async function reactivateTenantHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  res.json({ tenant: await reactivateTenant(requireContext(req), id) });
}

export async function deleteTenantHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id as string;
  await deleteTenant(requireContext(req), id);
  res.status(204).end();
}
