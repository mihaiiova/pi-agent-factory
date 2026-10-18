export function aggregateUsage(entries: unknown[]): Record<string, any> | null;
export function readProductVersion(
  cwd: string | undefined,
  versionFile: string | undefined,
): string | null;
export function configHash(piDir: string | undefined): string | null;
export function readPiConfigCommit(piConfigRoot: string): string | null;
export function collectSubagentUsage(
  sessionDir: string | null | undefined,
  options?: { sessionId: string; entries: any[]; branch?: any[]; sessionFile?: string },
): import("./schema.mjs").SessionRecord["subagentUsage"];
export function collectProvenance(input: {
  piConfigRoot?: string;
  cwd?: string;
  piDir?: string;
  versionFile?: string;
  piVersion?: string;
  piSessionFormatVersion?: number;
}): Record<string, any>;
export function readCheckResults(
  artifactsRoot: string | null | undefined,
  options?: { since?: number },
): Record<string, string> | null;

