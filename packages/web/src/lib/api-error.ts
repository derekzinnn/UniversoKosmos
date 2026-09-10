/**
 * The API speaks in stable English codes; the product speaks Portuguese.
 * This file is the only place the two meet, which means the backend never has
 * to know what language a client reads, and copy changes never touch it.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const MESSAGES: Readonly<Record<string, string>> = {
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  ACCOUNT_INACTIVE: 'Sua conta está inativa. Fale com a equipe Kosmos.',
  RATE_LIMITED: 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
  VALIDATION_FAILED: 'Confira os campos destacados e tente novamente.',

  TOKEN_MISSING: 'Sua sessão expirou. Entre novamente.',
  TOKEN_INVALID: 'Sua sessão expirou. Entre novamente.',
  REFRESH_TOKEN_MISSING: 'Sua sessão expirou. Entre novamente.',
  REFRESH_TOKEN_INVALID: 'Sua sessão expirou. Entre novamente.',
  REFRESH_TOKEN_EXPIRED: 'Sua sessão expirou. Entre novamente.',
  REFRESH_TOKEN_REUSED:
    'Detectamos um acesso suspeito e encerramos esta sessão por segurança. Entre novamente.',

  RESET_TOKEN_INVALID: 'Este link de redefinição expirou ou já foi usado. Peça um novo.',
  INVITATION_INVALID: 'Este convite não é mais válido. Peça um novo para a equipe Kosmos.',
  INVITATION_USED: 'Este convite já foi utilizado.',
  USER_ALREADY_EXISTS: 'Este e-mail já tem uma conta. Faça login para continuar.',

  ROLE_NOT_INVITABLE: 'Você não pode enviar um convite com esse nível de acesso.',
  INSUFFICIENT_ROLE: 'Você não tem permissão para acessar esta área.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  FORBIDDEN_SCOPE: 'Você não tem permissão para acessar estes dados.',

  TENANT_NOT_FOUND: 'Não encontramos esta empresa.',

  TRACK_NOT_FOUND: 'Não encontramos esta trilha.',
  TRACK_SLUG_TAKEN: 'Já existe uma trilha com este endereço.',
  TRACK_NOT_READY: 'A trilha ainda não está pronta para ser publicada.',
  TRACK_PUBLISHED_CANNOT_DELETE: 'Despublique a trilha antes de excluí-la.',
  TRACK_ASSIGNED_CANNOT_DELETE: 'Esta trilha já foi liberada para pelo menos um cliente.',
  MODULE_NOT_FOUND: 'Não encontramos este módulo.',
  MODULE_HAS_PROGRESS: 'Algum cliente já começou as aulas deste módulo.',
  MODULE_ORDER_MISMATCH: 'A lista de módulos mudou. Recarregue a página e tente de novo.',
  LESSON_NOT_FOUND: 'Não encontramos esta aula.',
  LESSON_HAS_PROGRESS: 'Algum cliente já começou esta aula.',
  LESSON_ORDER_MISMATCH: 'A lista de aulas mudou. Recarregue a página e tente de novo.',
  RESOURCE_NOT_FOUND: 'Não encontramos este material.',
  ALREADY_ASSIGNED: 'Esta trilha já está liberada para este cliente.',
  NOT_ASSIGNED: 'Esta trilha não está liberada para este cliente.',
  TENANT_SLUG_TAKEN: 'Já existe uma empresa com este identificador.',
  ROUTE_NOT_FOUND: 'Não encontramos o que você procura.',

  LESSON_LOCKED: 'Termine a aula anterior para liberar esta. Suas aulas são liberadas em ordem.',
  LESSON_HAS_NO_VIDEO: 'Esta aula ainda não tem vídeo. Avisaremos quando estiver disponível.',
  LESSON_NOT_NEAR_END: 'Chegue perto do fim do vídeo para marcar a aula como concluída.',
  STAFF_HAS_NO_PROGRESS: 'Contas da equipe Kosmos não registram progresso.',

  NETWORK_ERROR: 'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.',
};

const FALLBACK = 'Algo não saiu como esperado. Tente novamente em alguns instantes.';

export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return MESSAGES[error.code] ?? FALLBACK;
  }
  return FALLBACK;
}

/**
 * Delete refusals a SUPERADMIN can override with `?force=true` — content that
 * has client progress, or a track that is still published/assigned. When one
 * of these comes back, the confirm dialog offers "apagar mesmo assim".
 */
const FORCEABLE_DELETE_CODES = new Set([
  'LESSON_HAS_PROGRESS',
  'MODULE_HAS_PROGRESS',
  'TRACK_PUBLISHED_CANNOT_DELETE',
  'TRACK_ASSIGNED_CANNOT_DELETE',
]);

export function isForceableDeleteError(error: unknown): boolean {
  return error instanceof ApiError && FORCEABLE_DELETE_CODES.has(error.code);
}

/** Field-level messages, already in Portuguese, straight from the API schema. */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_FAILED') return {};

  const details = error.details;
  if (!Array.isArray(details)) return {};

  const fields: Record<string, string> = {};

  for (const item of details as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;

    const { field, message } = item as { field?: unknown; message?: unknown };

    if (typeof field === 'string' && typeof message === 'string') {
      // First message per field wins, so the form shows the primary reason.
      fields[field] ??= message;
    }
  }

  return fields;
}
