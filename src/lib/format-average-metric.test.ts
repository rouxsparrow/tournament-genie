import assert from "node:assert/strict";
import test from "node:test";
import { formatAverageMetric } from "./format-average-metric";

test("formatAverageMetric renders signed two-decimal values", () => {
  assert.equal(formatAverageMetric(1.234), "+1.23");
  assert.equal(formatAverageMetric(-1.234), "-1.23");
  assert.equal(formatAverageMetric(0), "0.00");
  assert.equal(formatAverageMetric(undefined), "0.00");
});
