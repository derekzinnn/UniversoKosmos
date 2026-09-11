import { describe, expect, it } from 'vitest';
import { checkEmailDomain } from './email-domains.js';

describe('checkEmailDomain', () => {
  it('accepts an ordinary real domain', () => {
    expect(checkEmailDomain('cliente@empresa.com.br').ok).toBe(true);
    expect(checkEmailDomain('ana@gmail.com').ok).toBe(true);
  });

  it('rejects placeholder and test domains', () => {
    for (const email of ['x@teste.com', 'x@test.com', 'x@example.com', 'x@dominio.com.br']) {
      expect(checkEmailDomain(email).ok).toBe(false);
    }
  });

  it('rejects disposable inboxes', () => {
    expect(checkEmailDomain('x@mailinator.com').ok).toBe(false);
    expect(checkEmailDomain('x@yopmail.com').ok).toBe(false);
  });

  it('rejects a provider typo and suggests the correction', () => {
    const verdict = checkEmailDomain('ana@gmial.com');
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('@gmail.com');
  });

  it('leaves format validation to the schema — a value with no domain passes', () => {
    // The email schema rejects this first; the domain checker must not throw.
    expect(checkEmailDomain('not-an-email').ok).toBe(true);
  });

  it('matches on the domain only, not the local part', () => {
    // "teste" as a name is fine; only the domain is judged.
    expect(checkEmailDomain('teste@empresa.com').ok).toBe(true);
  });
});
