/**
 * Email copy.
 *
 * Everything a client reads is Brazilian Portuguese; identifiers stay English.
 * Each message carries both a plain-text body (always) and an HTML body — a
 * text-only client still reads the text, and everyone else gets the branded
 * version. The HTML uses inline styles and a table-based button because email
 * clients strip <style> blocks and ignore most modern CSS.
 */
import type { EmailMessage } from './email-provider.js';

/** The brand's attention blue (`--ring` in the web palette) and near-black ink. */
const BRAND_BLUE = '#0140bf';
const INK = '#0a0a0b';
const MUTED = '#5b6472';
const SURFACE = '#f1f3f7';
const BORDER = '#e6e6e6';
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Escape the few characters that would break out of HTML text or an attribute. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface LayoutInput {
  readonly title: string;
  /** Paragraphs of body copy, plain strings (escaped here). */
  readonly paragraphs: readonly string[];
  readonly ctaLabel: string;
  readonly ctaUrl: string;
  /** Small print under the button. */
  readonly footnote: string;
}

/**
 * Wraps message content in the branded shell: a centred white card on a light
 * ground, a wordmark, the copy, one blue call-to-action, and the raw link as a
 * fallback for clients that do not render the button.
 */
function layout(input: LayoutInput): string {
  const url = escapeHtml(input.ctaUrl);
  const paragraphs = input.paragraphs
    .map(
      (line) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(
          line,
        )}</p>`,
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${SURFACE};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:14px;overflow:hidden;font-family:${FONT};">
            <tr>
              <td style="padding:28px 32px 8px;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:${INK};">Universo Kosmos</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 4px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:700;color:${INK};">${escapeHtml(
                  input.title,
                )}</h1>
                ${paragraphs}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 4px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:10px;background:${BRAND_BLUE};">
                      <a href="${url}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(
                        input.ctaLabel,
                      )}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 4px;">
                <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${MUTED};">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
                <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${url}" style="color:${BRAND_BLUE};text-decoration:underline;">${url}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid ${BORDER};margin-top:12px;">
                <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:${MUTED};">${escapeHtml(
                  input.footnote,
                )}</p>
                <p style="margin:12px 0 0;font-size:12px;color:${MUTED};">— Equipe Kosmos</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

interface InvitationEmailInput {
  readonly to: string;
  readonly tenantName: string;
  readonly inviterName: string;
  readonly acceptUrl: string;
  readonly expiresInDays: number;
}

export function invitationEmail(input: InvitationEmailInput): EmailMessage {
  const subject = `Seu acesso ao Universo Kosmos está pronto`;
  return {
    to: input.to,
    subject,
    text: [
      `Olá!`,
      ``,
      `${input.inviterName} convidou você para acessar o Universo Kosmos, a plataforma`,
      `de onboarding da Kosmos, em nome de ${input.tenantName}.`,
      ``,
      `Para criar sua senha e começar, acesse:`,
      ``,
      input.acceptUrl,
      ``,
      `Este convite é pessoal e vale por ${input.expiresInDays} dias.`,
      `Se você não esperava este e-mail, pode ignorá-lo com segurança.`,
      ``,
      `— Equipe Kosmos`,
    ].join('\n'),
    html: layout({
      title: 'Seu acesso está pronto',
      paragraphs: [
        `${input.inviterName} convidou você para acessar o Universo Kosmos, a plataforma de onboarding da Kosmos, em nome de ${input.tenantName}.`,
        `Para criar sua senha e começar, é só clicar no botão abaixo.`,
      ],
      ctaLabel: 'Criar minha senha',
      ctaUrl: input.acceptUrl,
      footnote: `Este convite é pessoal e vale por ${String(
        input.expiresInDays,
      )} dias. Se você não esperava este e-mail, pode ignorá-lo com segurança.`,
    }),
  };
}

interface TrackCompletedNotificationInput {
  /** Internal Kosmos recipient. */
  readonly to: string;
  readonly clientName: string;
  readonly clientEmail: string;
  readonly tenantName: string;
  readonly trackTitle: string;
  /** Link into the per-client drill-down in the admin console. */
  readonly drilldownUrl: string;
}

/**
 * Internal alert: a client just finished an entire track. Sent to Kosmos, not
 * to the client — so the copy addresses the team, and the button opens that
 * client's drill-down in the admin console.
 */
export function trackCompletedNotification(input: TrackCompletedNotificationInput): EmailMessage {
  const subject = `${input.tenantName} concluiu a trilha "${input.trackTitle}"`;
  return {
    to: input.to,
    subject,
    text: [
      `Um cliente concluiu uma trilha no Universo Kosmos.`,
      ``,
      `Empresa:  ${input.tenantName}`,
      `Pessoa:   ${input.clientName} (${input.clientEmail})`,
      `Trilha:   ${input.trackTitle}`,
      ``,
      `Ver o progresso do cliente:`,
      input.drilldownUrl,
      ``,
      `— Universo Kosmos`,
    ].join('\n'),
    html: layout({
      title: 'Um cliente concluiu a trilha',
      paragraphs: [
        `${input.clientName} (${input.clientEmail}), da empresa ${input.tenantName}, acaba de concluir a trilha "${input.trackTitle}".`,
      ],
      ctaLabel: 'Ver progresso do cliente',
      ctaUrl: input.drilldownUrl,
      footnote: 'Este é um aviso interno da equipe Kosmos.',
    }),
  };
}

interface TrackCompletedCongratsInput {
  readonly to: string;
  readonly clientName: string;
  readonly trackTitle: string;
  /** Where the button sends them back — the app home. */
  readonly appUrl: string;
}

/**
 * Client-facing congratulations for finishing a whole track. Warm, brief, and
 * addressed to the person — the counterpart to the internal alert that goes to
 * Kosmos.
 */
export function trackCompletedCongrats(input: TrackCompletedCongratsInput): EmailMessage {
  const firstName = input.clientName.trim().split(/\s+/)[0] || input.clientName;
  const subject = `Parabéns! Você concluiu "${input.trackTitle}" 🎉`;
  return {
    to: input.to,
    subject,
    text: [
      `Parabéns, ${firstName}!`,
      ``,
      `Você concluiu a trilha "${input.trackTitle}" no Universo Kosmos.`,
      `É mais uma etapa do seu onboarding com a Kosmos concluída — muito obrigado`,
      `pela dedicação.`,
      ``,
      `Sempre que quiser rever o conteúdo, é só acessar:`,
      input.appUrl,
      ``,
      `— Equipe Kosmos`,
    ].join('\n'),
    html: layout({
      title: `Parabéns, ${firstName}! 🎉`,
      paragraphs: [
        `Você concluiu a trilha "${input.trackTitle}" no Universo Kosmos.`,
        `É mais uma etapa do seu onboarding com a Kosmos concluída — obrigado pela dedicação. Sempre que quiser, o conteúdo continua disponível para rever.`,
      ],
      ctaLabel: 'Acessar o Universo Kosmos',
      ctaUrl: input.appUrl,
      footnote: 'Se precisar de ajuda, é só responder a este e-mail.',
    }),
  };
}

interface PasswordResetEmailInput {
  readonly to: string;
  readonly resetUrl: string;
  readonly expiresInMinutes: number;
}

export function passwordResetEmail(input: PasswordResetEmailInput): EmailMessage {
  const subject = `Redefinição de senha — Universo Kosmos`;
  return {
    to: input.to,
    subject,
    text: [
      `Recebemos um pedido para redefinir a senha da sua conta no Universo Kosmos.`,
      ``,
      `Para escolher uma nova senha, acesse:`,
      ``,
      input.resetUrl,
      ``,
      `O link vale por ${input.expiresInMinutes} minutos e só pode ser usado uma vez.`,
      ``,
      `Se você não pediu esta redefinição, ignore este e-mail. Sua senha atual`,
      `continua funcionando normalmente.`,
      ``,
      `— Equipe Kosmos`,
    ].join('\n'),
    html: layout({
      title: 'Redefinir sua senha',
      paragraphs: [
        `Recebemos um pedido para redefinir a senha da sua conta no Universo Kosmos.`,
        `Para escolher uma nova senha, clique no botão abaixo.`,
      ],
      ctaLabel: 'Escolher nova senha',
      ctaUrl: input.resetUrl,
      footnote: `O link vale por ${String(
        input.expiresInMinutes,
      )} minutos e só pode ser usado uma vez. Se você não pediu esta redefinição, ignore este e-mail — sua senha atual continua funcionando.`,
    }),
  };
}
