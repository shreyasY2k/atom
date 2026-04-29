/**
 * k6 load test — GATE SESSION-15
 *
 * Usage:
 *   k6 run tests/load/gate_load_test.js \
 *     -e GATE_URL=http://localhost:8080 \
 *     -e DOMAIN_ID=<uuid> \
 *     -e AGENT_ID=<uuid> \
 *     -e AGENT_JWT=<token>
 *
 * Results saved to tests/load/results/summary.json via --summary-export.
 * Convenience target: make test-load
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

// ── Configuration ──────────────────────────────────────────────────────────────

const GATE_URL  = __ENV.GATE_URL  || "http://localhost:8080";
const DOMAIN_ID = __ENV.DOMAIN_ID || "test-domain-id";
const AGENT_ID  = __ENV.AGENT_ID  || "test-agent-id";
const AGENT_JWT = __ENV.AGENT_JWT || "test-jwt-token";

// ── k6 options ────────────────────────────────────────────────────────────────

export const options = {
  vus: 50,
  duration: "60s",
  thresholds: {
    http_req_duration: ["p(95)<50", "p(99)<100"],
    http_req_failed:   ["rate<0.001"],
    checks:            ["rate>0.999"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

// ── Custom metrics ────────────────────────────────────────────────────────────

const gateDuration = new Trend("gate_req_duration", true);
const errorRate    = new Rate("gate_error_rate");

// ── Main VU function ──────────────────────────────────────────────────────────

export default function () {
  const url = `${GATE_URL}/domain/${DOMAIN_ID}/agent/${AGENT_ID}/echo`;

  const params = {
    headers: {
      Authorization: `Bearer ${AGENT_JWT}`,
      "Content-Type": "application/json",
    },
    timeout: "5s",
  };

  const res = http.post(url, JSON.stringify({ probe: true }), params);

  // Record custom metrics
  gateDuration.add(res.timings.duration);
  errorRate.add(res.status >= 500 || res.status === 0);

  const ok = check(res, {
    "status is 2xx or expected": (r) =>
      r.status >= 200 && r.status < 300,
    "response time < 100ms": (r) => r.timings.duration < 100,
  });

  if (!ok) {
    console.error(`Request failed: status=${res.status} body=${res.body?.substring(0, 200)}`);
  }

  sleep(0.01); // 10ms think-time between requests per VU
}

// ── Setup: validate connectivity ──────────────────────────────────────────────

export function setup() {
  const healthUrl = `${GATE_URL}/healthz`;
  const res = http.get(healthUrl, { timeout: "5s" });
  if (res.status !== 200) {
    console.warn(`GATE health check returned ${res.status} — test may fail`);
  }
  return {
    gate_url:  GATE_URL,
    domain_id: DOMAIN_ID,
    agent_id:  AGENT_ID,
  };
}

// ── Teardown: print summary ───────────────────────────────────────────────────

export function teardown(data) {
  console.log(`Load test complete. Target: ${data.gate_url}`);
  console.log(`Domain: ${data.domain_id}  Agent: ${data.agent_id}`);
}

export function handleSummary(data) {
  return {
    "tests/load/results/summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}

// Inline minimal text summary (avoids k6/x/output dependency)
function textSummary(data, opts) {
  const metrics = data.metrics || {};
  const dur = metrics.http_req_duration || {};
  const trends = dur.values || {};
  return [
    "── GATE Load Test Summary ─────────────────────────────",
    `  p(50) : ${(trends["p(50)"] || 0).toFixed(2)} ms`,
    `  p(90) : ${(trends["p(90)"] || 0).toFixed(2)} ms`,
    `  p(95) : ${(trends["p(95)"] || 0).toFixed(2)} ms  (threshold < 50ms)`,
    `  p(99) : ${(trends["p(99)"] || 0).toFixed(2)} ms  (threshold < 100ms)`,
    `  errors: ${((metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(3)}%  (threshold < 0.1%)`,
    "────────────────────────────────────────────────────────",
  ].join("\n");
}
