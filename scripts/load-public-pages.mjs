#!/usr/bin/env node

const baseUrl = process.env.LOAD_BASE_URL ?? "http://localhost:3000";
const durationSec = Number.parseInt(process.env.LOAD_DURATION_SEC ?? "60", 10);
const concurrency = Number.parseInt(process.env.LOAD_CONCURRENCY ?? "200", 10);
const warmupSec = Number.parseInt(process.env.LOAD_WARMUP_SEC ?? "10", 10);
const thinkMs = Number.parseInt(process.env.LOAD_THINK_MS ?? "1000", 10);

const routes = [
  { name: "standings", path: "/api/public/standings/summary?category=MD", weight: 0.4 },
  { name: "standings", path: "/api/public/standings/summary?category=WD", weight: 0.2 },
  { name: "standings", path: "/api/public/standings/summary?category=XD", weight: 0.2 },
  { name: "presenting", path: "/api/public/presenting?stage=group", weight: 0.15 },
  { name: "brackets", path: "/api/public/brackets?category=MD&series=A", weight: 0.05 },
];

function pickRoute() {
  const total = routes.reduce((sum, route) => sum + route.weight, 0);
  const target = Math.random() * total;
  let cumulative = 0;
  for (const route of routes) {
    cumulative += route.weight;
    if (target <= cumulative) return route;
  }
  return routes[routes.length - 1];
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const index = Math.floor((sorted.length - 1) * q);
  return sorted[index];
}

const startedAt = Date.now();
const warmupEndAt = startedAt + Math.max(0, warmupSec) * 1000;
const stopAt = warmupEndAt + durationSec * 1000;

const allLatencies = [];
const byRoute = new Map();
let totalRequests = 0;
let failedRequests = 0;

for (const route of routes) {
  if (!byRoute.has(route.name)) {
    byRoute.set(route.name, []);
  }
}

async function worker() {
  while (Date.now() < stopAt) {
    const route = pickRoute();
    const url = `${baseUrl}${route.path}`;
    const requestStarted = Date.now();
    const inMeasurementWindow = requestStarted >= warmupEndAt;

    try {
      const response = await fetch(url, { cache: "no-store" });
      await response.arrayBuffer();
      const latency = Date.now() - requestStarted;
      if (inMeasurementWindow) {
        allLatencies.push(latency);
        byRoute.get(route.name).push(latency);
        totalRequests += 1;
        if (!response.ok) {
          failedRequests += 1;
        }
      }
    } catch {
      if (inMeasurementWindow) {
        failedRequests += 1;
        totalRequests += 1;
      }
    }

    if (thinkMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, thinkMs));
    }
  }
}

console.log(
  `[load-public-pages] starting: baseUrl=${baseUrl} warmupSec=${warmupSec} durationSec=${durationSec} concurrency=${concurrency} thinkMs=${thinkMs}`
);

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const elapsedMs = Date.now() - startedAt;
const measuredElapsedMs = Math.max(1, elapsedMs - warmupSec * 1000);
const overallSorted = [...allLatencies].sort((a, b) => a - b);

function summarize(name, latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    route: name,
    count: sorted.length,
    p50Ms: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    p99Ms: quantile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

const summary = {
  elapsedMs,
  measuredElapsedMs,
  totalRequests,
  failedRequests,
  errorRate: totalRequests === 0 ? 0 : failedRequests / totalRequests,
  throughputRps: measuredElapsedMs === 0 ? 0 : totalRequests / (measuredElapsedMs / 1000),
  overall: summarize("overall", overallSorted),
  routes: Array.from(byRoute.entries()).map(([name, latencies]) => summarize(name, latencies)),
};

console.log(JSON.stringify(summary, null, 2));

if (summary.errorRate > 0) {
  process.exitCode = 1;
}
