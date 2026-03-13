export function formatAverageMetric(value: number) {
  const formatted = value.toFixed(2);
  return value > 0 ? `+${formatted}` : formatted;
}
