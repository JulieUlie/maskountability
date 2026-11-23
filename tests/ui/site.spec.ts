import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { company, rowsForCompany } from '../support/db';

/**
 * The register is still empty in reality (cases/index.json is []), so the list and case pages get
 * fictional cases through page.route. The submit form talks to the real local Worker and D1.
 */
const aCase = (id: string, over: Record<string, any> = {}) => ({
  id,
  status: 'published',
  subject: { name: 'Northwind Outdoor Supplies', type: 'limited_company', registry: { country: 'BE', number: '0123.456.789', retrieved: '2026-11-01' } },
  claim: { text: 'Based in Belgium and guiding trips here year-round.', source_url: 'https://example.com/post/1', date_seen: '2026-10-20', archived_copy: 'https://archive.example/abc' },
  period: { claim_made: '2026-10-18', evidence_covers: { from: '2026-01-01', to: '2026-10-31' } },
  evidence: [
    { direction: 'contradicts_claim', description: 'Registry lists a seat abroad since 2024.', method: 'registry_lookup', date: '2026-11-01', source: 'Company registry' },
    { direction: 'supports_claim', description: 'Two trips in Belgium in July.', method: 'public_listing', source: 'Booking page', notes: 'Only summer dates checked.' },
  ],
  verdict: { result: 'not_supported', reasoning: 'The company is not based in Belgium.', reviewer: 'J. T.', decided: '2026-11-05' },
  log: [{ at: '2026-11-05', change: 'Published' }],
  ...over,
});

const CASES = [
  aCase('northwind-belgium'),
  aCase('evergreen-coffee', { subject: { name: 'Evergreen Coffee', type: 'brand' }, claim: { ...aCase('x').claim, text: 'Every bean is fair trade certified.' }, verdict: { ...aCase('x').verdict, result: 'supported' } }),
  aCase('harbor-bikes', { subject: { name: 'Harbor Bikes', type: 'limited_company' }, claim: { ...aCase('x').claim, text: 'Our frames are made in Europe.' }, verdict: { ...aCase('x').verdict, result: 'insufficient_evidence' } }),
  aCase('draft-case', { status: 'draft', subject: { name: 'Secret Draft Ltd', type: 'brand' } }), // must never show
];

async function withCases(page: Page, cases = CASES) {
  await page.route('**/cases/index.json', (r) => r.fulfill({ json: cases.map((c) => c.id) }));
  await page.route(/\/cases\/[a-z0-9-]+\.json$/, (r) => {
    const id = new URL(r.request().url()).pathname.split('/').pop()!.replace('.json', '');
    if (id === 'index') return r.fallback(); // handled by the index route above
    const c = cases.find((x) => x.id === id);
    return c ? r.fulfill({ json: c }) : r.fulfill({ status: 404, body: 'not found' });
  });
}

test.describe('The register (index)', () => {
  test('today it is empty and says so, without search controls @mobile', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('No published claims yet')).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search' })).toBeHidden();
  });

  test('lists published cases only, with their verdict', async ({ page }) => {
    await withCases(page);
    await page.goto('/');

    const cards = page.locator('#list article');
    await expect(cards).toHaveCount(3);
    await expect(page.locator('#count')).toHaveText('3 claims');
    await expect(page.locator('#list')).not.toContainText('Secret Draft Ltd');
    await expect(cards.filter({ hasText: 'Northwind' }).locator('.pill')).toHaveText('Not supported');
  });

  test('search looks in the company name and the claim', async ({ page }) => {
    await withCases(page);
    await page.goto('/');

    await page.getByRole('searchbox', { name: 'Search' }).fill('fair trade');

    await expect(page.locator('#list article')).toHaveCount(1);
    await expect(page.locator('#list')).toContainText('Evergreen Coffee');
    await expect(page.locator('#count')).toHaveText('1 claim');
  });

  test('filters by verdict, and explains when nothing matches', async ({ page }) => {
    await withCases(page);
    await page.goto('/');

    await page.getByRole('combobox', { name: 'Filter by verdict' }).selectOption({ label: 'Insufficient evidence' });
    await expect(page.locator('#list article')).toHaveCount(1);
    await expect(page.locator('#list')).toContainText('Harbor Bikes');

    await page.getByRole('searchbox', { name: 'Search' }).fill('northwind');
    await expect(page.getByText('No matches')).toBeVisible();
  });

  test('shows an error when the list cannot be loaded', async ({ page }) => {
    await page.route('**/cases/index.json', (r) => r.fulfill({ status: 500, body: 'oops' }));
    await page.goto('/');

    await expect(page.getByText('Could not load the case list.')).toBeVisible();
  });

  test('only the count is announced while typing, not the whole list (v5)', async ({ page }) => {
    await withCases(page);
    await page.goto('/');

    await expect(page.locator('#count')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#list')).not.toHaveAttribute('aria-live', /.*/);
  });

  test('cards do not move on hover when reduced motion is asked for (v5)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await withCases(page);
    await page.goto('/');

    const card = page.locator('#list article').first();
    await card.hover();
    await expect(card).toHaveCSS('transform', 'none');
  });

  test('company names are shown as text, never run as HTML', async ({ page }) => {
    let alerted = false;
    page.on('dialog', async (d) => { alerted = true; await d.dismiss(); });
    await withCases(page, [aCase('xss-case', { subject: { name: '<img src=x onerror=alert(1)>', type: 'brand' } })]);
    await page.goto('/');

    await expect(page.locator('#list h2')).toHaveText('<img src=x onerror=alert(1)>');
    expect(alerted).toBe(false);
  });
});

test.describe('A case page', () => {
  test('shows the claim, the evidence for and against, the verdict and the history @mobile', async ({ page }) => {
    await withCases(page);
    await page.goto('/');
    await page.getByRole('link', { name: /Northwind Outdoor Supplies/ }).click();

    await expect(page).toHaveURL(/case(\.html)?\?id=northwind-belgium/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Northwind Outdoor Supplies');
    await expect(page).toHaveTitle('Northwind Outdoor Supplies · Claim record');
    for (const h of ['The claim', 'Period covered by the evidence', 'Evidence', 'Verdict', 'History']) {
      await expect(page.getByRole('heading', { name: h, level: 2, exact: true })).toBeVisible();
    }
    await expect(page.locator('.evidence li')).toHaveCount(2);
    await expect(page.locator('.evidence')).toContainText('Contradicts the claim');
    await expect(page.locator('.evidence')).toContainText('Limits: Only summer dates checked.');
    await expect(page.getByText('Registry BE 0123.456.789, retrieved 2026-11-01')).toBeVisible();
  });

  test('a source that is not a web link is shown as text, never as a clickable link (v5)', async ({ page }) => {
    await withCases(page, [aCase('bad-link', { claim: { ...aCase('x').claim, source_url: 'javascript:alert(1)' } })]);
    await page.goto('/case.html?id=bad-link');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Original post' })).toHaveCount(0);
    await expect(page.getByText('Original post not linked')).toBeVisible();
  });

  test('a record without evidence or history still shows its verdict (v5)', async ({ page }) => {
    await withCases(page, [aCase('bare', { evidence: undefined, log: undefined })]);
    await page.goto('/case.html?id=bare');

    await expect(page.locator('.pill')).toHaveText('Not supported');
    await expect(page.locator('.evidence li')).toHaveCount(0);
  });

  for (const [title, query, message] of [
    ['an unknown case', '?id=does-not-exist', 'Case not found or not yet published.'],
    ['a draft that is not public yet', '?id=draft-case', 'Case not found or not yet published.'],
    ['an id with forbidden characters', '?id=../secret', 'Case not found.'],
    ['no id at all', '', 'Case not found.'],
  ]) {
    test(`refuses ${title}`, async ({ page }) => {
      await withCases(page);
      await page.goto(`/case.html${query}`);

      await expect(page.locator('#content .error')).toHaveText(message);
      await expect(page).toHaveTitle('Case not found · Maskountability');
    });
  }
});

test.describe('Sending a claim', () => {
  const form = (page: Page) => ({
    company: page.getByRole('textbox', { name: 'Company or brand name' }),
    claim: page.getByRole('textbox', { name: 'The public claim' }),
    link: page.getByRole('textbox', { name: /Link to the post or page/ }),
    evidence: page.getByRole('textbox', { name: /Evidence and sources/ }),
    consent: page.getByRole('checkbox', { name: /I confirm the information is true/ }),
    send: page.getByRole('button', { name: 'Send claim' }),
    status: page.getByRole('status'),
  });

  test('a complete claim is received, stored for review, and the form is cleared @mobile', async ({ page }) => {
    const name = company('UI Co');
    await page.goto('/submit.html');
    const f = form(page);

    await f.company.fill(name);
    await f.claim.fill('Every product is made by hand in Antwerp.');
    await f.link.fill('https://example.com/about');
    await f.consent.check();
    await f.send.click();

    await expect(f.status).toHaveText('Thank you. Your claim has been received and will be reviewed before anything is published.');
    await expect(f.company).toHaveValue('');
    await expect(f.consent).not.toBeChecked();
    await expect.poll(() => rowsForCompany(name).length).toBe(1);
    expect(rowsForCompany(name)[0]).toMatchObject({ status: 'new', source_url: 'https://example.com/about' });
  });

  test('shows the server\'s reason when something is missing', async ({ page }) => {
    await page.goto('/submit.html');
    const f = form(page);

    await f.company.fill(company());
    await f.claim.fill('Too short'); // 9 characters
    await f.consent.check();
    await f.send.click();

    await expect(f.status).toHaveText('Describe the public claim in at least 10 characters.');
    await expect(f.status).toHaveClass('err');
    await expect(f.claim).toHaveValue('Too short'); // nothing typed is lost
  });

  test('marks the refused field and moves focus to it, until it is changed (v5)', async ({ page }) => {
    await page.goto('/submit.html');
    const f = form(page);

    await f.company.fill(company());
    await f.claim.fill('Too short');
    await f.consent.check();
    await f.send.click();

    await expect(f.claim).toBeFocused();
    await expect(f.claim).toHaveAttribute('aria-invalid', 'true');
    await expect(f.claim).toHaveAccessibleDescription('Describe the public claim in at least 10 characters.');
    await expect(f.company).not.toHaveAttribute('aria-invalid', /.*/);

    await f.claim.pressSequentially(' at all');
    await expect(f.claim).not.toHaveAttribute('aria-invalid', /.*/);
  });

  test('asks for consent before sending', async ({ page }) => {
    await page.goto('/submit.html');
    const f = form(page);

    await f.company.fill(company());
    await f.claim.fill('Every product is made by hand in Antwerp.');
    await f.send.click();

    await expect(f.status).toHaveText('Please confirm the consent statement.');
    await expect(f.consent).toBeFocused();
  });

  test('explains when the server cannot be reached', async ({ page }) => {
    await page.route('**/api/submit', (r) => r.abort('internetdisconnected'));
    await page.goto('/submit.html');
    const f = form(page);

    await f.company.fill(company());
    await f.claim.fill('Every product is made by hand in Antwerp.');
    await f.consent.check();
    await f.send.click();

    await expect(f.status).toHaveText('Could not reach the server. Check your connection and try again.');
    await expect(f.send).toBeEnabled();
  });

  test('the spam trap is hidden from people and from screen readers', async ({ page }) => {
    await page.goto('/submit.html');

    // Hidden by moving it far off screen (left: -10000px), so it is not "hidden" in Playwright's sense:
    // check that it is outside the page instead, and unreachable with Tab.
    const trap = page.locator('input[name="website"]');
    const box = (await trap.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(0);
    await expect(trap).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('.hp')).toHaveAttribute('aria-hidden', 'true');
  });
});

test.describe('Help page', () => {
  test('says honestly what is stored when a claim is sent (v5)', async ({ page }) => {
    await page.goto('/help.html');

    await page.getByText('Is my data stored?').click();
    await expect(page.getByText(/what you type, including an optional contact, is stored privately for review/)).toBeVisible();
    await expect(page.getByText('Nothing is submitted through this page.')).toHaveCount(0);
  });
});

test.describe('Theme and accessibility', () => {
  test('L switches light and dark, and the choice is remembered on other pages', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');

    await page.keyboard.press('l');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.goto('/submit.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('form controls follow the theme, and a saved theme is applied in the page head (v5)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/submit.html');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');

    await page.keyboard.press('l');
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');

    // The stored choice is set by a script in <head>, before the body is drawn, so it never flashes light first.
    for (const path of ['/', '/case.html', '/submit.html', '/help.html']) {
      const html = await (await page.request.get(path)).text();
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head, path).toContain('localStorage.getItem("maskountability-theme")');
    }
  });

  test('L typed in a text field does not switch the theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/submit.html');

    await page.getByRole('textbox', { name: 'Company or brand name' }).type('Lol');

    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  });

  for (const path of ['/', '/case.html?id=northwind-belgium', '/submit.html', '/help.html']) {
    test(`${path} has no detectable WCAG violations`, async ({ page }) => {
      // Regression test: the grey text was #6a6a63 (4.19:1) until 17 Nov 2026, now #5f5f58 like help.html.
      await withCases(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}× ${v.help}`)).toEqual([]);
    });
  }

  for (const path of ['/', '/case.html?id=northwind-belgium', '/submit.html', '/help.html']) {
    test(`${path} has no detectable WCAG violations in dark mode (v5)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await withCases(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}× ${v.help}`)).toEqual([]);
    });
  }
});
