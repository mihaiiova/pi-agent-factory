/**
 * pi-config — interactive project setup and model-tier routing
 *
 * Command: /pi-config
 *
 * Defines three named model tiers (high/medium/small), a parent (default)
 * tier, and a subagent→tier map. The source of truth is `.pi/pi-config.json`;
 * `/pi-config` generates the effective `.pi/settings.json` (model defaults,
 * `subagents.agentOverrides`, and a reconciled `spec.*` block) from it.
 *
 * Re-running prefills every prompt from the current config, so pressing Enter
 * through the flow is the no-op "keep" path. Writes only project-local files;
 * never edits the user's global settings file.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SUBAGENT_TIERS,
  TIER_NAMES,
  generateSettings,
  type PiConfig,
} from "./generate-settings.mjs";

// Derive the repo root from this extension's own location instead of a
// hardcoded path — pi-config is cloned to different locations per machine.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ── Constants ──────────────────────────────────────────────────

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** First-run thinking prefill, keyed by tier name. */
const DEFAULT_TIER_THINKING: Record<string, string> = {
  high: "high",
  medium: "medium",
  small: "low",
};

const CUSTOM_MODEL_SENTINEL = "⌨️ Type a custom model (provider/model-id)";

const DECISION_THRESHOLD_PRESETS = [
  { label: "0.6 (balanced — default)", value: 0.6 },
  { label: "0.3 (ask more)", value: 0.3 },
  { label: "0.9 (ask less)", value: 0.9 },
] as const;

const CUSTOM_THRESHOLD_SENTINEL = "⌨️ Enter a custom threshold (0–1)";

// ── File I/O ───────────────────────────────────────────────────

function loadJson<T>(path: string): T | undefined {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    // Malformed or unreadable — treat as absent.
  }
  return undefined;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function configPath(cwd: string): string {
  return join(cwd, ".pi", "pi-config.json");
}

function settingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

// ── Model options ──────────────────────────────────────────────

function modelRef(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

function collectModelOptions(ctx: {
  modelRegistry: { getAvailable(): ReadonlyArray<{ provider: string; id: string }> };
}): string[] {
  try {
    // Configuration must not be constrained by this session's enabledModels
    // scope: users need to be able to select any authenticated catalog model.
    return [...new Set(ctx.modelRegistry.getAvailable().map(modelRef))].sort();
  } catch {
    return [];
  }
}

function optionsWithCurrentFirst(options: string[], current?: string): string[] {
  if (current && options.includes(current)) {
    return [current, ...options.filter((o) => o !== current)];
  }
  return options;
}

function thresholdLabel(value: number): string {
  const preset = DECISION_THRESHOLD_PRESETS.find((p) => p.value === value);
  return preset ? preset.label : `${value} (current)`;
}

function parseThreshold(raw: string): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return undefined;
  return value;
}

// ── Spec facts (mirrors /spec-init inference) ──────────────────

function gitDefaultBranch(cwd: string): string | undefined {
  try {
    return execFileSync(
      "gh",
      ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  } catch {
    return undefined;
  }
}

function gitBranches(cwd: string): string[] {
  try {
    const out = execFileSync("git", ["branch", "-a", "--format=%(refname:short)"], {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return out
      .split("\n")
      .map((b) => b.replace(/^origin\//, "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function hasBranch(cwd: string, name: string): boolean {
  return gitBranches(cwd).includes(name);
}

function detectVersionFile(cwd: string): string | undefined {
  for (const candidate of ["package.json", "pubspec.yaml", "Cargo.toml", "pyproject.toml"]) {
    if (existsSync(join(cwd, candidate))) return candidate;
  }
  try {
    const files = execFileSync("ls", ["-1"], { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const csproj = files.split("\n").find((f) => f.trim().endsWith(".csproj"));
    if (csproj) return csproj.trim();
  } catch {
    // ignore
  }
  return undefined;
}

function detectChecks(cwd: string): Record<string, string> {
  const checks: Record<string, string> = {};
  const manifest = join(cwd, "package.json");
  if (!existsSync(manifest)) return checks;
  try {
    const scripts = (JSON.parse(readFileSync(manifest, "utf-8")) as { scripts?: Record<string, string> }).scripts ?? {};
    if (scripts.test) checks.test = "npm test";
    if (scripts.build) checks.build = "npm run build";
    if (scripts.lint) checks.lint = "npm run lint";
    if (scripts.typecheck) checks.typecheck = "npm run typecheck";
  } catch {
    // ignore
  }
  return checks;
}

function inferSpecFacts(cwd: string): Record<string, unknown> {
  const defaultBranch = gitDefaultBranch(cwd);
  const facts: Record<string, unknown> = {};

  const base = hasBranch(cwd, "development") ? "development" : defaultBranch;
  const release = hasBranch(cwd, "main") ? "main" : defaultBranch;
  if (base) facts.baseBranch = base;
  if (release) facts.releaseBranch = release;
  facts.tagPrefix = "v";

  const versionFile = detectVersionFile(cwd);
  if (versionFile) facts.versionFile = versionFile;

  const checks = detectChecks(cwd);
  if (Object.keys(checks).length > 0) facts.checks = checks;

  return facts;
}

// ── Validation ─────────────────────────────────────────────────

function validateSettings(path: string): { ok: boolean; message: string } {
  try {
    const out = execFileSync("bash", ["scripts/spec/validate-settings.sh", path], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, message: out.trim() };
  } catch (err: any) {
    return { ok: false, message: err.stderr?.trim() || err.message };
  }
}

// ── Extension ──────────────────────────────────────────────────

export default function piConfig(pi: ExtensionAPI) {
  pi.registerCommand("pi-config", {
    description: "Interactive project setup: model tiers, subagent routing, and spec block",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/pi-config requires TUI mode", "warning");
        return;
      }

      const cwd = ctx.cwd;
      const cfgFile = configPath(cwd);
      const settingsFile = settingsPath(cwd);

      const current = loadJson<PiConfig>(cfgFile) ?? ({} as PiConfig);
      const currentModel = ctx.model ? modelRef(ctx.model) : undefined;

      const modelOptions = collectModelOptions(ctx);
      if (modelOptions.length === 0) {
        ctx.ui.notify("No usable models found to choose from", "error");
        return;
      }

      const tiers: PiConfig["tiers"] = {};
      for (const name of TIER_NAMES) {
        const prefillModel = current.tiers?.[name]?.model ?? currentModel;
        const options = optionsWithCurrentFirst(
          [...modelOptions, CUSTOM_MODEL_SENTINEL],
          prefillModel,
        );
        const choice = await ctx.ui.select(`Tier "${name}" — model:`, options);
        if (choice === undefined) return;
        const model =
          choice === CUSTOM_MODEL_SENTINEL
            ? await ctx.ui.input("Custom model:", "provider/model-id")
            : choice;
        if (!model) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }

        const prefillThinking =
          current.tiers?.[name]?.thinking ?? DEFAULT_TIER_THINKING[name];
        const thinking = await ctx.ui.select(
          `Tier "${name}" — thinking level:`,
          optionsWithCurrentFirst(THINKING_LEVELS, prefillThinking),
        );
        if (thinking === undefined) return;

        tiers[name] = { model, thinking };
      }

      const parentTier = await ctx.ui.select(
        "Parent (default) tier:",
        optionsWithCurrentFirst(TIER_NAMES, current.parentTier),
      );
      if (parentTier === undefined) return;

      const subagentTiers: Record<string, string> = {};
      // Iterate the union of built-in defaults and any agents already persisted,
      // so re-running preserves agents added by hand instead of dropping them.
      const agentNames = [
        ...new Set([
          ...Object.keys(DEFAULT_SUBAGENT_TIERS),
          ...Object.keys(current.subagentTiers ?? {}),
        ]),
      ];
      for (const agent of agentNames) {
        const prefill = current.subagentTiers?.[agent] ?? DEFAULT_SUBAGENT_TIERS[agent];
        const tier = await ctx.ui.select(
          `Subagent "${agent}" — tier:`,
          optionsWithCurrentFirst(TIER_NAMES, prefill),
        );
        if (tier === undefined) return;
        subagentTiers[agent] = tier;
      }

      const currentThreshold =
        typeof current.specDecisionThreshold === "number"
          ? current.specDecisionThreshold
          : 0.6;
      const currentThresholdLabel = thresholdLabel(currentThreshold);
      const presetLabels = DECISION_THRESHOLD_PRESETS.map((p) => p.label);
      const thresholdOptions = [
        ...presetLabels,
        ...(presetLabels.includes(currentThresholdLabel) ? [] : [currentThresholdLabel]),
        CUSTOM_THRESHOLD_SENTINEL,
      ];
      const thresholdChoice = await ctx.ui.select(
        "Spec interview decision threshold (lower = more questions):",
        optionsWithCurrentFirst(thresholdOptions, currentThresholdLabel),
      );
      if (thresholdChoice === undefined) return;

      let specDecisionThreshold: number;
      if (thresholdChoice === CUSTOM_THRESHOLD_SENTINEL) {
        const raw = await ctx.ui.input(
          "Decision threshold (0–1):",
          String(currentThreshold),
        );
        if (!raw) return;
        const parsed = parseThreshold(raw);
        if (parsed === undefined) {
          ctx.ui.notify("Decision threshold must be a number in [0,1]", "error");
          return;
        }
        specDecisionThreshold = parsed;
      } else {
        specDecisionThreshold =
          DECISION_THRESHOLD_PRESETS.find((p) => p.label === thresholdChoice)?.value ??
          currentThreshold;
      }

      const nextConfig: PiConfig = {
        tiers,
        parentTier,
        subagentTiers,
        specDecisionThreshold,
      };

      const edited = await ctx.ui.editor(
        "Review .pi/pi-config.json",
        `${JSON.stringify(nextConfig, null, 2)}\n`,
      );
      if (edited === undefined) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      let finalConfig: PiConfig;
      try {
        finalConfig = JSON.parse(edited) as PiConfig;
      } catch (err: any) {
        ctx.ui.notify(`Invalid JSON, nothing written: ${err.message}`, "error");
        return;
      }

      const confirmed = await ctx.ui.confirm(
        "Write configuration?",
        [
          `.pi/pi-config.json — tier source of truth`,
          `.pi/settings.json — generated model defaults, subagent overrides, and spec block`,
        ].join("\n"),
      );
      if (!confirmed) {
        ctx.ui.notify("Cancelled; nothing written", "info");
        return;
      }

      writeJson(cfgFile, finalConfig);

      const existingSettings = loadJson<Record<string, unknown>>(settingsFile) ?? {};
      const settings = generateSettings(finalConfig, existingSettings, inferSpecFacts(cwd));
      writeJson(settingsFile, settings);

      const validation = validateSettings(settingsFile);
      if (validation.ok) {
        ctx.ui.notify(
          `Saved .pi/pi-config.json and .pi/settings.json — ${validation.message}`,
          "info",
        );
      } else {
        ctx.ui.notify(`Saved, but settings validation failed: ${validation.message}`, "warning");
      }
    },
  });
}
