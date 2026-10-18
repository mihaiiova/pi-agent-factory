export interface CostSample {
  key: string;
  kind: "main" | "subagent";
  sessionId: string;
  spec: number | null;
  workflow: string;
  phase: string;
  usage: Record<string, any>;
  cost: number | null;
  agent?: string;
  model?: string | null;
  status?: "completed" | "failed" | null;
  observedAt?: number;
  startedAt?: number;
}
export interface Ledger {
  version: 1;
  sessionId: string;
  sessionFile: string;
  lineageRoot?: string;
  samples: CostSample[];
  references: Array<{runId?: string; path?: string; spec: number | null; workflow: string; phase: string}>;
  phases: Array<{spec: number | null; workflow: string; phase: string}>;
  warnings: string[];
  leafId: string | null;
  sourceCount?: number;
  sourceTip?: string | null;
}
export interface AccountingTotals {
  mainCost: number | null;
  subagentCost: number | null;
  totalCost: number | null;
  coverage: { priced: number; unpriced: number };
  usage: import("./schema.mjs").UsageTotals;
  samples: CostSample[];
}
export const ACCOUNTING_VERSION: number;
export const CONTEXT_ENTRY: string;
export function hash(value: unknown): string;
export function price(value: unknown): number | null;
export function costOf(usage: unknown): number | null;
export function timestamp(entry: unknown): number;
export function userText(message: unknown): string;
export function invocation(text: string): {name: string | null; spec: number | null};
export function activeBranch(entries: any[], leafId?: string | null): any[];
export function sessionLedger(input: {entries?: any[]; branch?: any[]; header?: Record<string, any>; sessionFile?: string; lineageRoot?: string; hintSpec?: number | null}): Ledger;
export function attachSubagents(ledgers: Ledger[], artifacts: Array<{path: string; meta: Record<string, any>}>): string[];
export function deduplicate(samples: CostSample[]): CostSample[];
export function summarize(samples: CostSample[]): AccountingTotals;
export function agentSummary(samples: CostSample[]): import("./schema.mjs").SessionRecord["subagentUsage"];
