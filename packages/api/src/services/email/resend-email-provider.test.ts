import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/errors.js';
import { ResendEmailProvider } from './resend-email-provider.js';

function okResponse(): Response {
  return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 });
}

describe('ResendEmailProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts the message to the Resend API with the configured sender', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const provider = new ResendEmailProvider('re_test_key', 'Universo Kosmos <nao-responda@kosmosdigital.com.br>');
    await provider.send({ to: 'ana@empresa.com.br', subject: 'Oi', text: 'Corpo em texto' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test_key');

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: 'Universo Kosmos <nao-responda@kosmosdigital.com.br>',
      to: 'ana@empresa.com.br',
      subject: 'Oi',
      text: 'Corpo em texto',
    });
    // No html part unless one was given.
    expect(body).not.toHaveProperty('html');
  });

  it('includes an html part when the message carries one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const provider = new ResendEmailProvider('re_key', 'from@kosmosdigital.com.br');
    await provider.send({ to: 'x@y.com', subject: 'S', text: 't', html: '<p>t</p>' });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>;
    expect(body.html).toBe('<p>t</p>');
  });

  it('throws EMAIL_SEND_FAILED when Resend rejects the message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('domain not verified', { status: 403 })));

    const provider = new ResendEmailProvider('re_key', 'from@kosmosdigital.com.br');
    await expect(
      provider.send({ to: 'x@y.com', subject: 'S', text: 't' }),
    ).rejects.toMatchObject({ code: 'EMAIL_SEND_FAILED' });
  });

  it('throws EMAIL_SEND_FAILED when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const provider = new ResendEmailProvider('re_key', 'from@kosmosdigital.com.br');
    const error = await provider.send({ to: 'x@y.com', subject: 'S', text: 't' }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('EMAIL_SEND_FAILED');
  });
});
