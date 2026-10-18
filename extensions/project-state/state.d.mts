export function statePath(piDir: string): string;
export function sessionsDir(piDir: string): string;
export function sessionRecordPath(piDir: string, sessionId: string): string;
export function stableStringify(value: unknown): string;
export function sanitizeSessionId(id: string | null | undefined): string;
export function createSession(input: {
  sessionId?: string | null;
  cwd?: string | null;
  piSessionFile?: string | null;
  startedAt?: string;
}): Record<string, any>;
export function loadState(piDir: string): Record<string, any> | undefined;
export function writeStateAtomic(piDir: string, state: unknown): string;
export function finalizeSession(
  piDir: string,
  session: unknown,
): { status: "created" | "exists"; path: string };
export function listSessions(
  piDir: string,
  options?: { limit?: number; allSnapshots?: boolean },
): Array<Record<string, any>>;


export function checkpointSession(piDir: string, session: Record<string, any>): { status: "created" | "exists"; path: string };
