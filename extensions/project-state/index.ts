/**
 * project-state — project-local resume context and append-only session history
 *
 * Commands: /session-status, /session-history, /session-cost
 *
 * Maintains a mutable `.pi/state.json` resume projection (non-authoritative —
 * git branch state and GitHub lifecycle labels are re-derived at session
 * boundaries and win on divergence) plus write-once
 * `.pi/sessions/*.json` immutable snapshots; resumed sessions append revisions.
 *
 * Persistence, schema/migration, metadata, and rendering live in the pure
 * `.mjs` modules so they are unit-testable without a running Pi session.
 */

import {
  CONFIG_DIR_NAME,
  CURRENT_SESSION_VERSION,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectProvenance, readCheckResults } from "./metadata.mjs";
import { formatCost, formatHistory, formatStatus } from "./presentation.mjs";
import { deriveActiveSpec, parseChangedFiles, parseSpecPhase } from "./reconcile.mjs";
import { createStateDocument } from "./schema.mjs";
import { detectWorkflow } from "./workflow.mjs";
import { collectProject } from "./accounting-project.mjs";
import { agentSummary, CONTEXT_ENTRY, invocation, userText } from "./accounting.mjs";
import {
  createSession,
  checkpointSession,
  listSessions,
  loadState,
  writeStateAtomic,
} from "./state.mjs";

// Derive the pi-config repo root from this extension's own location instead of
// a hardcoded path — pi-config is cloned to different locations per machine.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// In-memory session record mutated during the session, finalized on shutdown.
let currentSession: ReturnType<typeof createSession> | null = null;

// ── Authoritative-source reconciliation helpers ─────────────────

function gitSafe(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function currentBranch(cwd: string): string | null {
  const branch = gitSafe(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch && branch !== "HEAD" ? branch : null;
}

/** Read the authoritative lifecycle phase from GitHub labels, best-effort. */
function readGhSpecPhase(number: number, cwd: string): string | null {
  try {
    const out = execFileSync(
      "gh",
      ["issue", "view", String(number), "--json", "labels", "--jq", ".labels[].name"],
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    return parseSpecPhase(out);
  } catch {
    return null;
  }
}

function readJsonFile(path: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, any>;
  } catch {
    return null;
  }
}

function readChecks(piDir: string): Record<string, string> | null {
  const settings = readJsonFile(join(piDir, "settings.json"));
  const checks = settings?.spec?.checks;
  return checks && typeof checks === "object" ? checks : null;
}

function readVersionFile(piDir: string): string | undefined {
  const settings = readJsonFile(join(piDir, "settings.json"));
  const versionFile = settings?.spec?.versionFile;
  return typeof versionFile === "string" ? versionFile : undefined;
}

function readSubagentModels(piDir: string): Record<string, unknown> | null {
  const settings = readJsonFile(join(piDir, "settings.json"));
  const overrides = settings?.subagents?.agentOverrides;
  return overrides && typeof overrides === "object" ? overrides : null;
}

function changedFiles(cwd: string): string[] {
  const out = gitSafe(cwd, ["status", "--porcelain=v1"]);
  return out == null ? [] : parseChangedFiles(out);
}

/** Load state without throwing: malformed/unsupported files read as missing. */
function loadStateSafe(piDir: string) {
  try {
    return loadState(piDir);
  } catch {
    return undefined;
  }
}

function activeModel(ctx: ExtensionContext) {
  if (!ctx.model) return null;
  return {
    provider: ctx.model.provider,
    model: ctx.model.id,
    thinkingLevel: ctx.thinkingLevel ?? null,
  };
}

function projectAccounting(ctx: ExtensionContext) {
  const sessionFile = ctx.sessionManager.getSessionFile() ?? "";
  return collectProject(ctx.cwd, { live: [{
    sessionFile,
    header: ctx.sessionManager.getHeader() ?? { id: ctx.sessionManager.getSessionId() },
    entries: ctx.sessionManager.getEntries(),
    branch: ctx.sessionManager.getBranch(),
  }] });
}

function liveAccounting(ctx: ExtensionContext, project = projectAccounting(ctx)) {
  return project.sessions.find(s => s.sessionId === ctx.sessionManager.getSessionId()) ?? null;
}

function reconcileContext(cwd: string) {
  const branch = currentBranch(cwd);
  const activeSpec = deriveActiveSpec(branch);
  const phase = activeSpec ? readGhSpecPhase(activeSpec.number, cwd) : null;
  return { branch, activeSpec, phase };
}

function persistProjection(
  piDir: string,
  context: { branch: string | null; activeSpec: { number: number } | null; phase: string | null },
  lastSessionId: string | null,
) {
  writeStateAtomic(
    piDir,
    createStateDocument({
      activeSpec: context.activeSpec,
      phase: context.phase,
      branch: context.branch,
      checks: readChecks(piDir),
      lastSessionId,
    }),
  );
}

// ── Extension ──────────────────────────────────────────────────

export default function projectState(pi: ExtensionAPI) {
  // Child usage is represented by its owner's subagent observations, never
  // also recorded as an independent main project session.
  if (process.env.PI_SUBAGENT_CHILD === "1") return;

  pi.on("before_agent_start", (event, ctx) => {
    const branch = ctx.sessionManager.getBranch();
    const command = invocation("prompt" in event && typeof event.prompt === "string" ? event.prompt : "");
    const previousName = [...branch].reverse().filter(e => e.type === "message" && e.message?.role === "user")
      .map(e => invocation(userText((e as any).message)).name).find(Boolean);
    const context = {
      spec: command.spec ?? deriveActiveSpec(currentBranch(ctx.cwd))?.number ?? null,
      workflow: command.name ?? previousName ?? "general",
    };
    const last = [...branch].reverse().find(e => e.type === "custom" && e.customType === CONTEXT_ENTRY);
    if (JSON.stringify(last?.data) !== JSON.stringify(context)) pi.appendEntry(CONTEXT_ENTRY, context);
  });
  pi.on("session_start", (_event, ctx) => {
    const piDir = join(ctx.cwd, CONFIG_DIR_NAME);
    try {
      const previous = loadStateSafe(piDir);
      const { branch, activeSpec, phase } = reconcileContext(ctx.cwd);
      persistProjection(piDir, { branch, activeSpec, phase }, previous?.lastSessionId ?? null);

      currentSession = createSession({
        sessionId: ctx.sessionManager.getSessionId(),
        cwd: ctx.cwd,
        piSessionFile: ctx.sessionManager.getSessionFile(),
        startedAt: ctx.sessionManager.getHeader()?.timestamp ?? undefined,
      });
      currentSession.branch = branch;
      currentSession.activeSpec = activeSpec;
      currentSession.phase = phase;
      currentSession.subagentModels = readSubagentModels(piDir);
      currentSession.provenance = collectProvenance({
        piConfigRoot: REPO_ROOT,
        cwd: ctx.cwd,
        piDir,
        versionFile: readVersionFile(piDir),
        piVersion: VERSION,
        piSessionFormatVersion: CURRENT_SESSION_VERSION,
      });
    } catch {
      // session_start must never throw.
    }
  });

  pi.on("session_shutdown", (event, ctx) => {
    const piDir = join(ctx.cwd, CONFIG_DIR_NAME);
    try {
      if (event.reason === "reload") {
        // The same session continues under a fresh extension instance: re-derive
        // the projection from authoritative sources without finalizing (which
        // would be premature).
        persistProjection(
          piDir,
          reconcileContext(ctx.cwd),
          loadStateSafe(piDir)?.lastSessionId ?? null,
        );
        return;
      }

      if (currentSession) {
        // Re-derive branch/spec/phase at the shutdown boundary so the write-once
        // snapshot reflects the current authoritative state, not the session-start
        // context (e.g. after /spec-start created a branch mid-session).
        const context = reconcileContext(ctx.cwd);
        currentSession.branch = context.branch;
        currentSession.activeSpec = context.activeSpec;
        currentSession.phase = context.phase;
        const accounting = projectAccounting(ctx);
        const ledger = accounting.ledgers.find(l => l.sessionId === ctx.sessionManager.getSessionId());
        const totals = liveAccounting(ctx, accounting);
        currentSession.accounting = ledger ?? null;
        currentSession.usage = totals?.usage ?? null;
        currentSession.piSessionFile = ctx.sessionManager.getSessionFile() ?? null;
        currentSession.model = activeModel(ctx);
        currentSession.changedFiles = changedFiles(ctx.cwd);
        currentSession.subagentUsage = agentSummary(ledger?.samples ?? []);
        currentSession.workflow = detectWorkflow(ctx.sessionManager.getBranch());
        currentSession.checkResults = readCheckResults(join(piDir, "artifacts"), {
          since: Date.parse(currentSession.startedAt ?? ""),
        });
        currentSession.finalizedAt = new Date().toISOString();
        checkpointSession(piDir, currentSession);

        persistProjection(piDir, context, currentSession.sessionId);
      }
    } catch {
      // session_shutdown must never throw.
    } finally {
      currentSession = null;
    }
  });

  pi.on("session_before_compact", (_event, ctx) => {
    const piDir = join(ctx.cwd, CONFIG_DIR_NAME);
    try {
      // Persist a minimal, freshly re-derived projection before compaction so
      // resume context is available even if the process dies mid-compaction.
      persistProjection(
        piDir,
        reconcileContext(ctx.cwd),
        loadStateSafe(piDir)?.lastSessionId ?? null,
      );
    } catch {
      // session_before_compact must never throw.
    }
  });

  pi.registerCommand("session-status", {
    description: "Show the current project resume projection and session cost",
    handler: async (_args, ctx) => {
      try {
        const piDir = join(ctx.cwd, CONFIG_DIR_NAME);
        const state = loadStateSafe(piDir);
        ctx.ui.notify(formatStatus(state, liveAccounting(ctx)), "info");
      } catch (err) {
        ctx.ui.notify(`/session-status failed: ${(err as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("session-history", {
    description: "Show recent finalized project session records",
    handler: async (_args, ctx) => {
      try {
        const project = projectAccounting(ctx);
        const records = listSessions(join(ctx.cwd, CONFIG_DIR_NAME), { limit: 10 }).map(record => ({
          ...record,
          accounting: project.ledgers.find(l => l.sessionId === (record.piSessionId ?? record.sessionId)) ?? null,
        }));
        ctx.ui.notify(formatHistory(records, { limit: 10 }), "info");
      } catch (err) {
        ctx.ui.notify(`/session-history failed: ${(err as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("session-cost", {
    description: "Show current, recent, and aggregate known session cost",
    handler: async (_args, ctx) => {
      try {
        const piDir = join(ctx.cwd, CONFIG_DIR_NAME);
        const records = listSessions(piDir);
        const project = projectAccounting(ctx);
        ctx.ui.notify(formatCost(liveAccounting(ctx, project), records, { limit: 10, project }), "info");
      } catch (err) {
        ctx.ui.notify(`/session-cost failed: ${(err as Error).message}`, "error");
      }
    },
  });
}

