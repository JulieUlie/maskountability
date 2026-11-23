import { test, expect } from '@playwright/test';
import { aSubmission, company, rowById, rowsForCompany } from '../support/db';

/** POST /api/submit: the only endpoint. Submissions land in a private queue for review. */
const submit = (request: import('@playwright/test').APIRequestContext, data: unknown) => request.post('/api/submit', { data });

test.describe('A valid submission', () => {
  test('is stored with status "new" and gets an id', async ({ request }) => {
    const sent = aSubmission();

    const res = await submit(request, sent);

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ ok: true, id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(res.headers()['cache-control']).toBe('no-store');

    const row = rowById(body.id);
    expect(row).toMatchObject({
      company: sent.company, claim: sent.claim, source_url: sent.source_url,
      evidence: sent.evidence, contact: sent.contact, status: 'new',
    });
    expect(Date.now() - Date.parse(row.created_at)).toBeLessThan(60_000);
  });

  test('optional fields may be left out, and are stored as empty (NULL)', async ({ request }) => {
    const res = await submit(request, { company: company(), claim: 'A claim with only the required parts.', consent: true });

    expect(res.status()).toBe(201);
    expect(rowById((await res.json()).id)).toMatchObject({ source_url: null, evidence: null, contact: null });
  });

  test('trims spaces and strips control characters', async ({ request }) => {
    const name = company('  Spaced');
    const res = await submit(request, aSubmission({ company: `${name}  `, claim: 'Line one\u0000\u0007 and more text here.' }));

    const row = rowById((await res.json()).id);
    expect(row.company).toBe(name.trim());
    expect(row.claim).toBe('Line one and more text here.');
  });

  test('cuts fields that are too long to their maximum', async ({ request }) => {
    const res = await submit(request, aSubmission({ company: 'C'.repeat(300), claim: 'x'.repeat(1500), evidence: 'e'.repeat(3000) }));

    const row = rowById((await res.json()).id);
    expect(row.company).toHaveLength(120);
    expect(row.claim).toHaveLength(1000);
    expect(row.evidence).toHaveLength(2000);
  });
});

test.describe('Refused submissions (422), nothing stored', () => {
  // Since v5 the answer also names the refused field, so the form can mark it and move focus there.
  const cases: [string, Record<string, unknown>, string, string][] = [
    ['a company name of 1 character', { company: 'X' }, 'Enter the company name.', 'company'],
    ['a claim under 10 characters', { claim: 'Too short' }, 'Describe the public claim in at least 10 characters.', 'claim'],
    ['a link that is not http(s)', { source_url: 'javascript:alert(1)' }, 'The link to the post must start with http:// or https://.', 'source_url'],
    ['a link that is not a URL', { source_url: 'www.example.com' }, 'The link to the post must start with http:// or https://.', 'source_url'],
    ['no consent', { consent: false }, 'Please confirm the consent statement.', 'consent'],
    ['consent as the text "true"', { consent: 'true' }, 'Please confirm the consent statement.', 'consent'],
  ];
  for (const [title, override, error, field] of cases) {
    test(`for ${title}`, async ({ request }) => {
      const sent = aSubmission(override);

      const res = await submit(request, sent);

      expect(res.status()).toBe(422);
      expect(await res.json()).toEqual({ ok: false, error, field });
      if (typeof sent.company === 'string' && sent.company.length > 2) {
        expect(rowsForCompany(sent.company as string)).toEqual([]);
      }
    });
  }
});

test.describe('Spam protection', () => {
  test('a filled-in honeypot looks accepted to the bot, but nothing is stored', async ({ request }) => {
    const sent = aSubmission({ website: 'http://spam.example' });

    const res = await submit(request, sent);

    expect(res.status()).toBe(201);
    expect(await res.json()).toEqual({ ok: true }); // no id: nothing was stored
    expect(rowsForCompany(sent.company as string)).toEqual([]);
  });
});

test.describe('Malformed requests', () => {
  test('405 for anything but POST', async ({ request }) => {
    const res = await request.get('/api/submit');
    expect(res.status()).toBe(405);
    expect(await res.json()).toEqual({ ok: false, error: 'Method not allowed.' });
  });

  test('415 when the body is not sent as JSON', async ({ request }) => {
    const res = await request.post('/api/submit', { form: { company: 'Acme' } });
    expect(res.status()).toBe(415);
  });

  test('400 for a body that is not valid JSON', async ({ request }) => {
    const res = await request.post('/api/submit', { data: Buffer.from('{"company":'), headers: { 'content-type': 'application/json' } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'The submission could not be read.' });
  });

  test('400 for a JSON array', async ({ request }) => {
    const res = await submit(request, [aSubmission()]);
    expect(res.status()).toBe(400);
  });

  test('413 for a submission over 20 KB', async ({ request }) => {
    const res = await submit(request, aSubmission({ evidence: 'x'.repeat(21 * 1024) }));
    expect(res.status()).toBe(413);
    expect(await res.json()).toEqual({ ok: false, error: 'The submission is too large.' });
  });
});

test.describe('What the site does not publish', () => {
  // The whole folder is the website; .assetsignore keeps the private parts out. Guard it.
  for (const path of ['/schema.sql', '/src/worker.js', '/wrangler.jsonc', '/README.md', '/package.json', '/playwright.config.ts', '/tests/api/submit.spec.ts', '/.gitignore']) {
    test(`${path} is not served`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(404);
      expect(await res.text()).not.toContain('CREATE TABLE');
    });
  }
});
