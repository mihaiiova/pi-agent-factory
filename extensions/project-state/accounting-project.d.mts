import type { Ledger, AccountingTotals } from "./accounting.mjs";
export interface ProjectAccounting extends AccountingTotals {
  version: 1;
  ledgers: Ledger[];
  sessions: Array<AccountingTotals & {sessionId: string; sessionFile: string; warnings: string[]}>;
  warnings: string[];
}
export function sessionDirectory(cwd: string, root?: string): string;
export function readTranscript(file: string): { entries: any[]; header: Record<string, any>; warnings: string[] } | null;
export function collectProject(cwd: string, options?: {
  records?: Array<Record<string, any>>; sessionRoot?: string; sessionFiles?: string[]; latest?: boolean;
  live?: Array<{sessionFile: string; header: Record<string, any>; entries: any[]; branch: any[]; hintSpec?: number | null}>;
}): ProjectAccounting;
export function specReport(project: ProjectAccounting, specs: number[]): Record<string, any>;
export function money(value: number | null | undefined): string;
export function renderSpecReport(report: Record<string, any>): string;
