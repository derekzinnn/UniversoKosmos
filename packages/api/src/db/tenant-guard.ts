import { TenantScopeViolationError } from '../lib/errors.js';
import { currentScope, describeScope } from './tenant-scope.js';

/**
 * Which models carry tenant identity, and in which field.
 *
 * Anything absent from this map is deliberately global: Track, Module,
 * Lesson and Resource are Kosmos-authored content shared across every client;
 * RefreshToken and PasswordResetToken hang off a user during flows where no
 * tenant is known yet; AuditLog is written with an explicit tenantId by the
 * audit service and read only by Kosmos staff.
 */
const TENANT_KEY_BY_MODEL: Readonly<Record<string, string>> = {
  Tenant: 'id',
  User: 'tenantId',
  Invitation: 'tenantId',
  TrackAssignment: 'tenantId',
  LessonProgress: 'tenantId',
  WatchEvent: 'tenantId',
  HiddenLesson: 'tenantId',
};

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

/** Operations that carry no `where` and no `data`, so there is nothing to check. */
const UNCHECKABLE_OPERATIONS = new Set(['findRaw', 'aggregateRaw', 'runCommandRaw']);

export function isTenantScopedModel(model: string | undefined): boolean {
  return model !== undefined && model in TENANT_KEY_BY_MODEL;
}

/**
 * The tripwire.
 *
 * Every query for a tenant-scoped model is inspected before it reaches
 * PostgreSQL. If it is not pinned to the tenant the current scope allows, it
 * throws instead of returning another client's rows.
 *
 * This does not *fix* an unscoped query by quietly adding a filter. Silent
 * repair hides the bug and the next query written the same way may not be
 * repairable. A loud failure in development and in tests is the point.
 */
export function assertQueryIsTenantScoped(
  model: string | undefined,
  operation: string,
  args: unknown,
): void {
  if (!model || !(model in TENANT_KEY_BY_MODEL)) return;
  if (UNCHECKABLE_OPERATIONS.has(operation)) return;

  const key = TENANT_KEY_BY_MODEL[model] as string;
  const scope = currentScope();

  if (!scope) {
    throw new TenantScopeViolationError(
      `${model}.${operation} was executed with no tenant scope established. ` +
        `Wrap the call in withTenantScope(tenantId, ...) or, when the flow genuinely ` +
        `cannot know a tenant, withGlobalScope(reason, ...).`,
    );
  }

  if (scope.kind === 'global') return;

  const argsObject = isRecord(args) ? args : {};

  if (operation === 'upsert') {
    assertWhereIsPinned(model, operation, argsObject.where, key, scope.tenantId);
    assertDataIsPinned(model, operation, argsObject.create, key, scope.tenantId);
    return;
  }

  if (CREATE_OPERATIONS.has(operation)) {
    assertDataIsPinned(model, operation, argsObject.data, key, scope.tenantId);
    return;
  }

  assertWhereIsPinned(model, operation, argsObject.where, key, scope.tenantId);
}

function assertWhereIsPinned(
  model: string,
  operation: string,
  where: unknown,
  key: string,
  tenantId: string,
): void {
  if (!isRecord(where)) {
    throw violation(
      model,
      operation,
      `it has no \`where\` clause, so it would match rows from every tenant. ` +
        `Expected \`where.${key}\` to equal "${tenantId}".`,
    );
  }

  const actual = where[key];

  if (actual === undefined) {
    throw violation(
      model,
      operation,
      `\`where.${key}\` is missing. Expected "${tenantId}". Queries for ` +
        `tenant-scoped models must go through ScopedDb, which supplies it.`,
    );
  }

  if (actual !== tenantId) {
    throw violation(
      model,
      operation,
      `\`where.${key}\` is ${describeValue(actual)} but the active scope is ` +
        `"${tenantId}". Cross-tenant access requires an explicit, audited override.`,
    );
  }
}

function assertDataIsPinned(
  model: string,
  operation: string,
  data: unknown,
  key: string,
  tenantId: string,
): void {
  const rows = Array.isArray(data) ? data : [data];

  for (const row of rows) {
    if (!isRecord(row)) {
      throw violation(model, operation, `it has no \`data\` to inspect.`);
    }

    const actual = row[key];

    if (actual === undefined) {
      throw violation(
        model,
        operation,
        `\`data.${key}\` is missing. Expected "${tenantId}". Set the scalar ` +
          `foreign key directly — a nested \`connect\` is invisible to this guard.`,
      );
    }

    if (actual !== tenantId) {
      throw violation(
        model,
        operation,
        `\`data.${key}\` is ${describeValue(actual)} but the active scope is "${tenantId}".`,
      );
    }
  }
}

function violation(model: string, operation: string, detail: string): TenantScopeViolationError {
  return new TenantScopeViolationError(
    `Tenant isolation violation in ${model}.${operation}: ${detail} ` +
      `(active scope: ${describeScope(currentScope())})`,
  );
}

/**
 * Render an unknown value for an error message without ever invoking a
 * hostile or accidental toString — a nested filter object would otherwise
 * arrive in the message as a useless "[object Object]".
 */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return `a ${typeof value}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
