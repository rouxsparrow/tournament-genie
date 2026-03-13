export function formatAverageMetric(value: number | null | undefined) {
  const safeValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const formatted = safeValue.toFixed(2);
  return safeValue > 0 ? `+${formatted}` : formatted;
}
