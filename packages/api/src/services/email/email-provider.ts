export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain-text body. Always present, so a text-only client still reads it. */
  readonly text: string;
  /** Optional HTML body. A provider that supports it sends both parts. */
  readonly html?: string;
}

/**
 * How Universo Kosmos sends email.
 *
 * The application never talks to a mail vendor directly. It talks to this
 * interface, so choosing Resend or SES or Postmark later is one new file and
 * one line in the factory — no changes in any service, and the tests keep
 * working without a network.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}
