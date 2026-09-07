import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { EmailMessage, EmailProvider } from './email-provider.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Sends transactional email through Resend's HTTP API.
 *
 * No SDK: it is one POST, and adding a dependency to make one fetch would be
 * its own liability — the same call the `resend` package makes under the hood.
 * The API key is secret and server-only. `from` comes from `EMAIL_FROM`, whose
 * domain must be verified in the Resend dashboard or Resend rejects the send.
 *
 * A failed send throws: an invitation or a password reset that silently never
 * arrives is worse than a visible error the caller can surface or retry.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });
    } catch (error) {
      logger.error({ error, to: message.to }, 'Resend request failed to reach the API');
      throw new AppError({
        message: 'Could not send the email',
        status: 502,
        code: 'EMAIL_SEND_FAILED',
      });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.error(
        { status: response.status, to: message.to, detail },
        'Resend rejected the message',
      );
      throw new AppError({
        message: 'Could not send the email',
        status: 502,
        code: 'EMAIL_SEND_FAILED',
      });
    }

    logger.info({ to: message.to, subject: message.subject }, 'Email sent via Resend');
  }
}
