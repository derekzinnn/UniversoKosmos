import { z } from 'zod';
import { checkEmailDomain } from '../lib/email-domains.js';

/**
 * Password policy.
 *
 * Length is the only rule. Composition rules ("one uppercase, one symbol")
 * push people towards Password1! and are explicitly discouraged by NIST
 * SP 800-63B; a long passphrase is stronger and easier to remember. The upper
 * bound exists so nobody can hand argon2 a ten-megabyte string and tie up a
 * worker doing it.
 */
export const passwordSchema = z
  .string()
  .min(10, 'A senha precisa ter pelo menos 10 caracteres')
  .max(200, 'A senha é longa demais');

/**
 * Trimmed and lowercased before validation, not after.
 *
 * People paste addresses with a trailing space and type them with capitals.
 * Rejecting " Ze@Padaria.com.br " as malformed would be technically defensible
 * and practically useless. Normalising first also means the value that reaches
 * the database already satisfies the users_email_normalised CHECK constraint.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Informe um e-mail válido').max(254));

/**
 * The same address, but also refused if its domain is an obvious typo or a
 * placeholder/disposable one (see `lib/email-domains.ts`). Used where a person
 * *types a new* address that a real e-mail will be sent to — inviting a client
 * — so a mistake is caught before the invitation vanishes into a dead domain.
 *
 * Login and password-reset keep the plain `emailSchema`: they match an address
 * that already exists rather than creating one, and reset must answer 202 to
 * every well-formed address regardless, so a domain gate there would buy
 * nothing and only change its shape.
 */
export const deliverableEmailSchema = emailSchema.superRefine((value, ctx) => {
  const verdict = checkEmailDomain(value);
  if (!verdict.ok) {
    ctx.addIssue({ code: 'custom', message: verdict.message ?? 'Informe um e-mail válido' });
  }
});

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Informe seu nome completo')
  .max(120, 'O nome é longo demais');

export const roleSchema = z.enum(['SUPERADMIN', 'CLIENT_OWNER', 'CLIENT_MEMBER']);
