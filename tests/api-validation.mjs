import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 4123;
const baseUrl = `http://127.0.0.1:${port}`;
const session = `api-test-${Date.now()}`;

const server = spawn("node", ["server/index.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "test",
    NIGHTCAP_DATA_PATH: ".tmp/nightcap-api.json"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForHealth();
  await request("/api/test/reset", { method: "POST" });

  const venues = await request("/api/venues?city=New%20York&vibe=cocktail");
  assert.equal(Array.isArray(venues.venues), true);
  assert.ok(venues.venues.length > 0);

  await assert.rejects(
    () => request("/api/ratings", {
      method: "POST",
      body: { venueId: venues.venues[0].id, overallScore: 999, vibesScore: -5 }
    }),
    /1 to 10/
  );

  await assert.rejects(
    () => request("/api/plans", {
      method: "POST",
      body: { venues: "not-an-array", groupSize: 1 }
    }),
    /venues must be an array/
  );

  await assert.rejects(
    () => request("/api/plans", {
      method: "POST",
      body: { venues: venues.venues, groupSize: 4, priorities: ["vibes"] }
    }),
    /Invite two friends/
  );

  const inviteOne = await request("/api/invites", { method: "POST", body: { contact: "friend1@example.com" } });
  assert.equal(inviteOne.inviteCount, 1);
  const inviteTwo = await request("/api/invites", { method: "POST", body: { contact: "friend2@example.com" } });
  assert.equal(inviteTwo.inviteCount, 2);

  const plan = await request("/api/plans", {
    method: "POST",
    body: { venues: venues.venues, groupSize: 4, priorities: ["vibes", "people"] }
  });
  assert.equal(plan.plan.length, 3);

  console.log("API validation audit passed");
} finally {
  server.kill("SIGTERM");
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-nightcap-session": session
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try {
      await request("/api/health");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw new Error("Server did not start");
}
