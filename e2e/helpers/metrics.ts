import { mkdir, writeFile } from "fs/promises";
import path from "path";

type Sample = {
  metric: string;
  ms: number;
  meta?: Record<string, string | number | boolean | null>;
  at: string;
};

type SummaryStat = {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
};

export class MetricsCollector {
  private readonly startedAtMs = Date.now();
  private readonly samples: Sample[] = [];
  private readonly counters = new Map<string, number>();

  addSample(
    metric: string,
    ms: number,
    meta?: Record<string, string | number | boolean | null>
  ) {
    this.samples.push({
      metric,
      ms,
      meta,
      at: new Date().toISOString(),
    });
  }

  time<T>(
    metric: string,
    fn: () => Promise<T>,
    meta?: Record<string, string | number | boolean | null>
  ): Promise<T> {
    const started = Date.now();
    return fn().finally(() => {
      this.addSample(metric, Date.now() - started, meta);
    });
  }

  increment(counter: string, by = 1) {
    this.counters.set(counter, (this.counters.get(counter) ?? 0) + by);
  }

  getCounter(counter: string) {
    return this.counters.get(counter) ?? 0;
  }

  getTotalRunMs() {
    return Date.now() - this.startedAtMs;
  }

  private static percentile(sorted: number[], p: number) {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  buildSummary() {
    const byMetric = new Map<string, number[]>();
    for (const sample of this.samples) {
      const arr = byMetric.get(sample.metric) ?? [];
      arr.push(sample.ms);
      byMetric.set(sample.metric, arr);
    }

    const summary: Record<string, SummaryStat> = {};
    for (const [metric, values] of byMetric.entries()) {
      const sorted = [...values].sort((a, b) => a - b);
      const total = values.reduce((sum, value) => sum + value, 0);
      summary[metric] = {
        count: values.length,
        minMs: sorted[0] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
        avgMs: values.length > 0 ? total / values.length : 0,
        p50Ms: MetricsCollector.percentile(sorted, 50),
        p95Ms: MetricsCollector.percentile(sorted, 95),
      };
    }

    return summary;
  }

  printSummary() {
    const summary = this.buildSummary();
    const rows = Object.entries(summary).map(([metric, stat]) => ({
      metric,
      count: stat.count,
      minMs: Math.round(stat.minMs),
      p50Ms: Math.round(stat.p50Ms),
      p95Ms: Math.round(stat.p95Ms),
      maxMs: Math.round(stat.maxMs),
      avgMs: Math.round(stat.avgMs),
    }));
    console.table(rows);
  }

  async writeJson(
    filenamePrefix: string,
    extra?: Record<string, unknown>
  ) {
    const dir = path.resolve(process.cwd(), "test-results", "metrics");
    await mkdir(dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(dir, `${filenamePrefix}-${timestamp}.json`);
    const payload = {
      generatedAt: new Date().toISOString(),
      totalRunMs: this.getTotalRunMs(),
      counters: Object.fromEntries(this.counters.entries()),
      summary: this.buildSummary(),
      samples: this.samples,
      ...(extra ?? {}),
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    return filePath;
  }
}

