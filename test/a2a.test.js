import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRef, mapAgentCard, a2a } from "../src/importers/a2a.js";
import { importAgent, importerFor } from "../src/importers/index.js";
import { memStore } from "./helpers.js";

const SAMPLE_CARD = {
  name: "Atlas Scout",
  description: "Autonomous indexing and OSINT agent for research communities.",
  url: "https://atlas.example.org",
  provider: {
    name: "Atlas Research Lab",
    url: "https://atlas-lab.example.org"
  },
  skills: [
    { id: "osint", name: "OSINT research", tags: ["intelligence", "search"] },
    { id: "python", name: "Python scraping", tags: ["python", "automation"] }
  ],
  status: "active"
};

test("a2a parseRef: parses domains and URLs, excludes musedin member profile routes", () => {
  assert.equal(parseRef("https://agent.example.org"), "https://agent.example.org/");
  assert.equal(parseRef("agent.example.org"), "https://agent.example.org/");
  assert.equal(parseRef("https://agent.example.org/.well-known/agent-card.json"), "https://agent.example.org/.well-known/agent-card.json");
  assert.equal(parseRef(""), null);
  assert.equal(parseRef("invalid url:://"), null);
  assert.equal(parseRef("https://musedin.com/m/agent_123"), null);
});

test("a2a mapAgentCard: extracts name, skills, provider notes and profile url", () => {
  const mapped = mapAgentCard(SAMPLE_CARD, "https://atlas.example.org");
  const a = mapped.agent;
  assert.equal(a.name, "Atlas Scout");
  assert.equal(a.source, "a2a");
  assert.equal(a.source_ref, "https://atlas.example.org");
  assert.equal(a.profile_url, "https://atlas.example.org");
  assert.ok(a.skills.includes("OSINT research"));
  assert.ok(a.skills.includes("intelligence"));
  assert.ok(a.skills.includes("Python scraping"));
  assert.match(a.notes, /provider: Atlas Research Lab/);
  assert.match(a.notes, /Autonomous indexing and OSINT agent/);
});

test("a2a importAgent: fetches agent-card.json via mock fetch and saves to store", async () => {
  const store = memStore();
  const mockFetch = async (url) => {
    if (url === "https://atlas.example.org/.well-known/agent-card.json") {
      return {
        ok: true,
        status: 200,
        json: async () => SAMPLE_CARD
      };
    }
    return { ok: false, status: 404 };
  };

  const imp = importerFor("https://atlas.example.org");
  assert.equal(imp.name, "a2a");

  const r = await importAgent(store, "https://atlas.example.org", { fetch: mockFetch });
  assert.equal(r.source, "a2a");
  assert.equal(r.created, true);

  const agent = r.agent;
  assert.equal(agent.name, "Atlas Scout");
  assert.equal(agent.source, "a2a");
  assert.equal(agent.source_ref, "https://atlas.example.org");
  assert.ok(agent.skills.length >= 3);
  assert.match(agent.notes, /Atlas Research Lab/);
});

test("a2a importAgent: falls back to /.well-known/agent.json when agent-card.json is 404", async () => {
  const store = memStore();
  const mockFetch = async (url) => {
    if (url === "https://fallback.example.org/.well-known/agent-card.json") {
      return { ok: false, status: 404 };
    }
    if (url === "https://fallback.example.org/.well-known/agent.json") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          name: "Fallback Agent",
          skills: ["testing", "fallback"],
          provider: "Fallback Corp"
        })
      };
    }
    return { ok: false, status: 404 };
  };

  const r = await importAgent(store, "https://fallback.example.org", { fetch: mockFetch });
  assert.equal(r.agent.name, "Fallback Agent");
  assert.ok(r.agent.skills.includes("testing"));
  assert.match(r.agent.notes, /Fallback Corp/);
});
