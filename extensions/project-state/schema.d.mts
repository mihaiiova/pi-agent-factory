export interface ActiveSpec {
  number: number;
  title?: string;
}

export interface StateDocument {
  schemaVersion: number;
  activeSpec: ActiveSpec | null;
  phase: string | null;
  branch: string | null;
  lastSessionId: string | null;
  pendingWork: string | null;
  checks: Record<string, string> | null;
  updatedAt: string;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  reasoning?: number;
  cost: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    total: number | null;
  };
}

export interface SessionProvenance {
  piConfigCommit: string | null;
  piVersion: string | null;
  piSessionFormatVersion: number | null;
  productVersion: string | null;
  configHash: string | null;
}

export interface SessionRecord {
  schemaVersion: number;
  sessionId: string;
  piSessionId: string | null;
  piSessionFile: string | null;
  cwd: string | null;
  startedAt: string | null;
  finalizedAt: string | null;
  summary: string | null;
  outcome: string | null;
  workflow: string | null;
  activeSpec: ActiveSpec | null;
  phase: string | null;
  branch: string | null;
  changedFiles: string[];
  checkResults: Record<string, string> | null;
  usage: UsageTotals | null;
  accounting: import("./accounting.mjs").Ledger | null;
  snapshotRevision?: number;
  snapshotFingerprint?: string;
  model: { provider: string; model: string; thinkingLevel: string | null } | null;
  subagentModels: Record<string, unknown> | null;
  subagentUsage: {
    agents: Array<{
      agent: string;
      runs: number;
      cost: number | null;
      status: "completed" | "failed" | null;
      model: string | null;
    }>;
    totalCost: number | null;
  } | null;
  provenance: SessionProvenance;
}

export const SCHEMA_VERSION: number;
export class SchemaError extends Error {
  constructor(message: string);
}
export const MIGRATIONS: Readonly<Record<number, (doc: Record<string, any>) => Record<string, any>>>;
export function migrateDocument(
  doc: unknown,
  options?: {
    targetVersion?: number;
    migrations?: Record<number, (doc: Record<string, any>) => Record<string, any>>;
  },
): Record<string, any>;
export function createStateDocument(fields?: Record<string, any>): StateDocument;
export function createSessionDocument(fields?: Record<string, any>): SessionRecord;

