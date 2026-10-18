export function formatStatus(state: unknown, currentUsage: unknown): string;
export function formatHistory(
  records: unknown[],
  options?: { limit?: number },
): string;
export function formatCost(
  currentUsage: unknown,
  records: unknown[],
  options?: { limit?: number; project?: import("./accounting-project.mjs").ProjectAccounting },
): string;

