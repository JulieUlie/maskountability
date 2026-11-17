import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/**
 * Read the local D1 database straight from the test, to check what really got stored
 * (the API only answers "ok" and an id, by design: submissions are private).
 * Wrangler keeps local D1 as a plain SQLite file; it is opened read-only, so the running
 * test server is never disturbed (a second `wrangler d1 execute` process did disturb it).
 */
export type Row = {
  id: string; created_at: string; company: string; claim: string;
  source_url: string | null; evidence: string | null; contact: string | null; status: string;
};

const D1_DIR = '.wrangler/test-state/v3/d1/miniflare-D1DatabaseObject';

function dbFile() {
  const file = readdirSync(D1_DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
  if (!file) throw new Error(`No local D1 database in ${D1_DIR}`);
  return join(D1_DIR, file);
}

export function rowsWhere(sql: string, ...params: (string | number)[]): Row[] {
  const db = new DatabaseSync(dbFile(), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as unknown as Row[];
  } finally {
    db.close();
  }
}

export const rowById = (id: string) => rowsWhere('SELECT * FROM submissions WHERE id = ?', id)[0];
export const rowsForCompany = (name: string) => rowsWhere('SELECT * FROM submissions WHERE company = ?', name);

/** A unique company name, so tests never see each other's rows. */
export const company = (label = 'Test Co') => `${label} ${randomUUID().slice(0, 8)}`;

/** A valid submission; override what the test is about. */
export const aSubmission = (overrides: Record<string, unknown> = {}) => ({
  company: company(),
  claim: 'Based in Belgium and guiding trips here year-round.',
  source_url: 'https://example.com/post/1',
  evidence: 'Company registry checked on 1 Nov 2026.',
  contact: 'tester@example.com',
  website: '',
  consent: true,
  ...overrides,
});
