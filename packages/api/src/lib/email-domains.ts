/**
 * A light guard against obviously-unusable e-mail domains.
 *
 * The platform is invitation-only: Kosmos types a client's address when
 * inviting them, and the invitation link is the real proof the mailbox exists
 * (nobody who cannot receive it can join). So this is not deliverability
 * verification — it is a typo net. It catches the two ways a mistyped invite
 * silently goes nowhere: a placeholder/test domain (`fulano@teste.com`) and a
 * near-miss of a big provider (`fulano@gmial.com`). Both would otherwise pass
 * format validation, send a real e-mail into the void, and leave the client
 * wondering why nothing arrived.
 *
 * Deliberately a small, hand-kept list rather than an MX lookup or a paid
 * verification API: the invitation link is the real deliverability test, so
 * this only needs to catch the obvious mistakes, and a network call on every
 * invite would buy little for its cost. It errs towards letting real addresses
 * through: a domain that is not on either
 * list is accepted, because a false rejection of a legitimate client is worse
 * than the rare fake that the invitation link would catch anyway.
 */

/** Placeholder, example and disposable domains — never a real client. */
const BLOCKED_DOMAINS = new Set<string>([
  // Placeholders and test/example domains.
  'teste.com',
  'teste.com.br',
  'test.com',
  'test.com.br',
  'example.com',
  'example.org',
  'example.net',
  'exemplo.com',
  'exemplo.com.br',
  'dominio.com',
  'dominio.com.br',
  'email.com.br',
  'mail.com.br',
  // Disposable / throwaway inboxes.
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.info',
  'sharklasers.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
  'fakeinbox.com',
  'throwawaymail.com',
  'mailnesia.com',
  'mohmal.com',
  'discard.email',
]);

/**
 * Near-misses of the big providers, each mapped to what was almost certainly
 * meant — so the error can suggest the fix rather than just say "no".
 */
const DOMAIN_TYPOS: Readonly<Record<string, string>> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmil.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outllook.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'yahho.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'iclod.com': 'icloud.com',
  'icloud.con': 'icloud.com',
};

export interface EmailDomainVerdict {
  readonly ok: boolean;
  /** A Portuguese, ready-to-show reason, present only when `ok` is false. */
  readonly message?: string;
}

/** The domain part of an already-normalised (trimmed, lowercased) address. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  const domain = email.slice(at + 1);
  return domain.length > 0 ? domain : null;
}

/**
 * Verdict on an address's domain. The address is expected already normalised
 * (the email schema trims and lowercases before this runs).
 */
export function checkEmailDomain(email: string): EmailDomainVerdict {
  const domain = domainOf(email);
  if (domain === null) return { ok: true }; // Format is the email schema's job.

  const suggestion = DOMAIN_TYPOS[domain];
  if (suggestion) {
    return { ok: false, message: `Você quis dizer @${suggestion}? Verifique o domínio do e-mail.` };
  }

  if (BLOCKED_DOMAINS.has(domain)) {
    return {
      ok: false,
      message: 'Use um e-mail real — domínios de teste ou temporários não são aceitos.',
    };
  }

  return { ok: true };
}
