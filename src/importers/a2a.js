// Importer for A2A agent cards: reads /.well-known/agent-card.json (or agent.json) from a URL.
// Extracts name, skills, url, provider and description into Rostra's import shape.

/** @param {string} ref a URL or host. @returns {string|null} normalized URL */
export function parseRef(ref) {
  const s = String(ref ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s.includes("://") ? s : "https://" + s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Let MusedIn importer handle its own member profile URLs
    if (["musedin.com", "www.musedin.com", "musedin.pages.dev"].includes(u.hostname) && /^\/(?:m|i|verify)\//.test(u.pathname)) {
      return null;
    }
    // An A2A card target must be a host root or point to an agent-card/agent.json endpoint
    const p = u.pathname;
    if (p !== "/" && p !== "" && !p.endsWith("/agent-card.json") && !p.endsWith("/agent.json") && !p.includes(".well-known")) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchCardJson(fetchFn, targetUrl, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(targetUrl, {
      headers: { accept: "application/json", "user-agent": "rostra (agent resource management)" },
      signal: ctl.signal,
      redirect: "follow"
    });
  } catch (e) {
    throw new Error(`could not reach ${targetUrl}: ${e.name === "AbortError" ? "timed out" : e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    const err = new Error(`agent card not found at ${targetUrl}`);
    err.status = 404;
    throw err;
  }

  if (!res.ok) throw new Error(`server answered ${res.status} at ${targetUrl}`);

  try {
    return await res.json();
  } catch {
    throw new Error(`invalid JSON at ${targetUrl}`);
  }
}

/** Turn an A2A agent card JSON into Rostra's import shape. Exported for tests. */
export function mapAgentCard(card, originUrl) {
  const u = new URL(originUrl);
  const name = card.name || card.title || u.hostname;
  const profileUrl = card.url || card.homepage || originUrl;
  const provider = card.provider?.name || (typeof card.provider === "string" ? card.provider : null) || card.organization || card.operator || null;

  // Extract skills
  let rawSkills = [];
  if (Array.isArray(card.skills)) {
    for (const s of card.skills) {
      if (typeof s === "string") rawSkills.push(s);
      else if (s && typeof s === "object") {
        if (s.name) rawSkills.push(s.name);
        else if (s.id) rawSkills.push(s.id);
        if (Array.isArray(s.tags)) rawSkills.push(...s.tags);
      }
    }
  } else if (Array.isArray(card.capabilities)) {
    rawSkills = card.capabilities.filter((c) => typeof c === "string");
  } else if (Array.isArray(card.tags)) {
    rawSkills = card.tags.filter((t) => typeof t === "string");
  }

  const skills = Array.from(new Set(rawSkills.map((s) => String(s).trim()).filter(Boolean))).slice(0, 50);

  // Construct notes
  const notesParts = [];
  if (provider) notesParts.push(`provider: ${provider}`);
  if (card.description) notesParts.push(card.description);
  const notes = notesParts.join(" · ").slice(0, 500) || null;

  const agent = {
    name: String(name).slice(0, 100),
    source: "a2a",
    source_ref: u.origin,
    profile_url: profileUrl,
    skills,
    availability: card.availability || (card.status === "active" ? "active" : null),
    notes
  };

  return { agent, engagements: [] };
}

/** @type {import("./index.js").Importer} */
export const a2a = {
  name: "a2a",
  description: "A2A agent card from /.well-known/agent-card.json (or agent.json)",
  match: (ref) => parseRef(ref) !== null,
  async read(ref, { fetch: fetchFn = globalThis.fetch, timeoutMs = 10000 } = {}) {
    const rawUrl = parseRef(ref);
    if (!rawUrl) throw new Error(`not a valid URL or host for A2A card: ${ref}`);

    const u = new URL(rawUrl);
    let card = null;

    if (u.pathname.endsWith(".json")) {
      card = await fetchCardJson(fetchFn, u.toString(), timeoutMs);
    } else {
      const cardUrl = `${u.origin}/.well-known/agent-card.json`;
      try {
        card = await fetchCardJson(fetchFn, cardUrl, timeoutMs);
      } catch (err) {
        if (err.status === 404) {
          // Fallback to /.well-known/agent.json
          const altUrl = `${u.origin}/.well-known/agent.json`;
          card = await fetchCardJson(fetchFn, altUrl, timeoutMs);
        } else {
          throw err;
        }
      }
    }

    if (!card || typeof card !== "object") throw new Error("empty or invalid agent card payload");
    return mapAgentCard(card, u.origin);
  }
};
