import { env } from '../../config/env.js';
import { ConsoleEmailProvider } from './console-email-provider.js';
import type { EmailProvider } from './email-provider.js';
import { ResendEmailProvider } from './resend-email-provider.js';

let provider: EmailProvider | undefined;

/**
 * One implementation chosen at startup from `EMAIL_PROVIDER`: `console` prints
 * to stdout for development, `resend` sends for real. The env schema guarantees
 * `RESEND_API_KEY` is present when the provider is resend, so the assertion is
 * for the type checker, not a real branch.
 */
export function emailProvider(): EmailProvider {
  provider ??= (() => {
    switch (env.EMAIL_PROVIDER) {
      case 'console':
        return new ConsoleEmailProvider();
      case 'resend':
        return new ResendEmailProvider(env.RESEND_API_KEY as string, env.EMAIL_FROM);
    }
  })();
  return provider;
}

/** Test seam: lets integration tests capture what would have been sent. */
export function setEmailProvider(next: EmailProvider): void {
  provider = next;
}

export type { EmailMessage, EmailProvider } from './email-provider.js';
