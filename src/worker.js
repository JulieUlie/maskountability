// Maskountability Worker: accepts public claim submissions and serves the static site.
// Submissions are stored privately in D1 and are never published automatically.

const MAX_BODY_BYTES = 20 * 1024;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function validUrl(value) {
  if (!value) return true;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

async function handleSubmit(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    return json({ ok: false, error: "Send the form as JSON." }, 415);
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "The submission is too large." }, 413);
  }

  // The declared length can be missing (chunked upload), so check the real size too.
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "The submission is too large." }, 413);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "The submission could not be read." }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ ok: false, error: "The submission could not be read." }, 400);
  }

  // Honeypot: real visitors leave this empty; bots tend to fill it in.
  if (clean(data.website, 200) !== "") {
    return json({ ok: true }, 201);
  }

  const company = clean(data.company, 120);
  const claim = clean(data.claim, 1000);
  const sourceUrl = clean(data.source_url, 500);
  const evidence = clean(data.evidence, 2000);
  const contact = clean(data.contact, 200);

  if (company.length < 2) return json({ ok: false, error: "Enter the company name." }, 422);
  if (claim.length < 10) return json({ ok: false, error: "Describe the public claim in at least 10 characters." }, 422);
  if (!validUrl(sourceUrl)) return json({ ok: false, error: "The link to the post must start with http:// or https://." }, 422);
  if (data.consent !== true) return json({ ok: false, error: "Please confirm the consent statement." }, 422);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO submissions (id, created_at, company, claim, source_url, evidence, contact, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')"
  ).bind(id, new Date().toISOString(), company, claim, sourceUrl || null, evidence || null, contact || null).run();

  return json({ ok: true, id }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/submit") {
      return handleSubmit(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
