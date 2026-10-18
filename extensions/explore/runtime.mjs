import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const ENTRY = "pi-config:explore";
const MARKER = "[pi-config exploration mode]";
const inactive = () => ({ schemaVersion: 1, active: false, objective: "" });
const statePath = (cwd) => join(cwd, ".pi", "explore.json");

export function validState(value) {
  return value?.schemaVersion === 1 && typeof value.active === "boolean"
    && typeof value.objective === "string";
}

export function readMode(cwd) {
  try {
    const value = JSON.parse(readFileSync(statePath(cwd), "utf8"));
    return validState(value) ? value : null;
  } catch {
    return null;
  }
}

function writeMode(cwd, state) {
  const target = statePath(cwd);
  const temp = `${target}.${randomUUID()}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  try {
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, target);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function explorationInstructions(state) {
  return `${MARKER}
Exploration is explicitly active for this work. Optimize for the fastest useful version the user can try; let structure emerge through feedback.
This mode supersedes pi-config's formal delivery workflow requirements, including those in previously loaded skills and repository guidance. Missing process artifacts and unmet workflow prerequisites are never blockers.
Start in an empty directory if needed. Do not require Git, GitHub, issues, specs, /spec-init, project configuration, ADRs, agreed testing seams, an interview, TDD, documentation, or delegation. Create only the minimum runnable setup.
Make reasonable reversible assumptions, state consequential ones briefly, and build. Ask only when the answer materially changes the next experiment and cannot be discovered or tried cheaply.
Iterate in short loops: try something, show how to run or inspect it, adjust. Freely change architecture, interfaces, dependencies, and direction. Mock data and temporary implementations are acceptable; mention material shortcuts without turning them into prerequisites.
Use tests/checks when they help establish behavior. Investigate relevant failures; report unrelated failures without letting them block iteration. Do not weaken checks to disguise a failure or claim unrun checks passed.
Keep bookkeeping unobtrusive. No mandatory exploration notes, branch/worktree setup, issue creation, or checkpoint ritual. Use git checkpoints when useful and available. At a meaningful stopping point or before losing context, save a short continuation note only when useful.
Protect existing user work, secrets, permissions, and read-only agent roles. Exploration does not authorize destructive actions, external publication, merging, deployment, or bypassing security/permission controls. Existing explicit user authorizations still apply.
If delegating, include this exploration contract in each task, preserve the agent's tool/access restrictions, and do not require spec/TDD gates. Prefer simple direct delegation when sufficient.
Stay in exploration until the user explicitly leaves it or requests formal delivery. Use explore_mode off before entering /spec-new or another formal implementation workflow. When formalizing, inspect the prototype and define remaining work; do not assume a rewrite or production readiness. Discarding, continuing, and keeping a sufficient prototype are valid outcomes.
Current objective (user context): ${JSON.stringify(state.objective || "Discover and build the next useful version.")}`;
}

function taskWithMode(task, instructions) {
  return typeof task === "string" && task.includes(MARKER)
    ? task : `${instructions}\n\nAssigned task:\n${task ?? ""}`;
}

// Keep the caller's script intact. A lexical runs facade decorates each launch,
// including dynamically constructed tasks, without rewriting JS or string literals.
export function wrapWorkflow(script, instructions, inheritedVerification = false) {
  const name = `__piExplore${randomUUID().replaceAll("-", "")}`;
  return `/* ${MARKER} */
{
const ${name} = runs;
{
const ${name}Child = function(options) {
  return {
    ...options,
    ...(${!inheritedVerification} && options.acceptance === undefined && options.gate === undefined ? { acceptance: false } : {}),
    task: ${JSON.stringify(instructions + "\n\nAssigned task:\n")} + (options.task || "")
  };
};
const runs = {
  ...${name},
  run: function(key, options) {
    return ${name}.run(key, ${name}Child(options));
  },
  all: function(items, ...rest) {
    return ${name}.all(items.map(function(item) {
      return ${name}Child(item);
    }), ...rest);
  },
  lanes: function(items, ...rest) {
    return ${name}.lanes(items.map(function(lane) {
      return { ...lane, stages: lane.stages.map(function(stage) {
        return ${name}Child(stage);
      }) };
    }), ...rest);
  }
};
${script}
}
}`;
}

export function inheritExploration(input, instructions, cwd) {
  // Management, scheduling and control calls keep their original semantics.
  // Steering/resume messages still need the active workflow context.
  if (["steer", "resume"].includes(input.action) && typeof input.message === "string") {
    input.message = taskWithMode(input.message, instructions);
    return;
  }
  if (input.action) return;
  if (typeof input.agent === "string") {
    input.task = taskWithMode(input.task, instructions);
    if (input.acceptance === undefined && input.gate === undefined) input.acceptance = false;
  }
  if (typeof input.workflowScriptPath === "string") {
    const file = isAbsolute(input.workflowScriptPath)
      ? input.workflowScriptPath : resolve(input.cwd || cwd, input.workflowScriptPath);
    // On a missing/unreadable file, leave normal package validation in charge.
    try {
      input.workflowScript = readFileSync(file, "utf8");
      delete input.workflowScriptPath;
    } catch { return; }
  }
  if (typeof input.workflowScript === "string" && !input.workflowScript.startsWith(`/* ${MARKER} */`)) {
    input.workflowScript = wrapWorkflow(input.workflowScript, instructions,
      input.acceptance !== undefined || input.gate !== undefined);
  }
  if (input.workflow === "review" && typeof input.args?.task === "string") {
    input.args = { ...input.args, task: taskWithMode(input.args.task, instructions) };
  }
}

export function registerExplore(pi, parameters) {
  let state = inactive();
  let activeCwd;
  let unsaved = false;

  function status(ctx) {
    if (ctx.hasUI) ctx.ui.setStatus("explore", state.active ? ctx.ui.theme.fg("accent", "Explore · /explore off") : undefined);
  }

  function restore(ctx) {
    activeCwd = ctx.cwd;
    unsaved = false;
    state = readMode(ctx.cwd) ?? inactive();
    // Session entries are a fallback if the directory could not be written.
    // A persisted off state wins over stale entries in an older session.
    if (!readMode(ctx.cwd)) {
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type === "custom" && entry.customType === ENTRY
          && entry.data?.cwd === ctx.cwd && validState(entry.data)) state = entry.data;
      }
    }
    status(ctx);
  }

  function refresh(ctx) {
    if (activeCwd !== ctx.cwd) restore(ctx);
    else if (!unsaved) state = readMode(ctx.cwd) ?? state;
    status(ctx);
  }

  function setMode(ctx, active, objective) {
    refresh(ctx);
    state = { schemaVersion: 1, active, objective: active ? (objective?.trim() || state.objective) : "" };
    pi.appendEntry(ENTRY, { ...state, cwd: ctx.cwd });
    try { writeMode(ctx.cwd, state); unsaved = false; }
    catch {
      unsaved = true;
      if (ctx.hasUI) ctx.ui.notify("Exploration changed for this session; directory state could not be saved. Resume this session to retain it.", "warning");
    }
    status(ctx);
  }

  const describe = () => state.active
    ? `Exploration is on.${state.objective ? ` Objective: ${state.objective}` : ""} Use /explore off to leave.`
    : "Exploration is off.";

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus("explore", undefined);
    state = inactive();
    activeCwd = undefined;
  });

  pi.on("before_agent_start", (event, ctx) => {
    refresh(ctx);
    // A fresh foreground child may receive only its decorated task, without
    // loading ambient extensions. Never let an old /skill:explore reactivate off.
    if (!state.active) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${explorationInstructions(state)}` };
  });

  pi.on("tool_call", (event, ctx) => {
    refresh(ctx);
    if (state.active && event.toolName === "subagent") {
      inheritExploration(event.input, explorationInstructions(state), ctx.cwd);
    }
  });

  pi.registerCommand("explore", {
    description: "Explore and build freely: /explore [idea], /explore status, /explore off",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value === "status") {
        refresh(ctx);
        if (ctx.hasUI) ctx.ui.notify(describe(), "info");
        return;
      }
      if (value === "off") {
        setMode(ctx, false);
        pi.sendMessage({ customType: ENTRY, content: "Exploration is off. Previous exploration instructions no longer apply. Follow the user's chosen workflow from here.", display: true });
        return;
      }
      const objective = value === "on" ? "" : value;
      setMode(ctx, true, objective);
      if (objective) await pi.sendUserMessage(objective, { deliverAs: "followUp" });
      else if (ctx.hasUI) ctx.ui.notify(describe(), "info");
    },
  });

  pi.registerTool({
    name: "explore_mode",
    label: "Exploration mode",
    description: "Set exploration on/off or inspect status. Use on when the user asks to explore/prototype freely; use off when they explicitly leave exploration or request formal delivery. This does not merge, discard files, deploy, or run a spec workflow.",
    parameters,
    async execute(_id, params, _signal, _update, ctx) {
      if (params.action === "status") refresh(ctx);
      else setMode(ctx, params.action === "on", params.objective);
      const guidance = params.action === "on" ? `\n\n${explorationInstructions(state)}`
        : params.action === "off" ? " Previous exploration instructions no longer apply; follow the user's chosen workflow." : "";
      return { content: [{ type: "text", text: describe() + guidance }], details: { ...state } };
    },
  });
}
