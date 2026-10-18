import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { explorationInstructions, inheritExploration, readMode, registerExplore } from "../../extensions/explore/runtime.mjs";

const root = mkdtempSync(join(tmpdir(), "pi-explore-test-"));
after(() => rmSync(root, { recursive: true, force: true }));
let count = 0;
function directory() { const dir = join(root, String(++count)); mkdirSync(dir); return dir; }

function host(cwd = directory(), entries = [], hasUI = true) {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const notices = [];
  const statuses = new Map();
  const sent = [];
  const pi = {
    on(name, callback) { handlers.set(name, callback); },
    registerCommand(name, definition) { commands.set(name, definition); },
    registerTool(definition) { tools.set(definition.name, definition); },
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
    sendUserMessage(text, options) { sent.push({ text, options }); },
    sendMessage(message) { sent.push(message); },
  };
  const ctx = {
    cwd, hasUI, sessionManager: { getBranch: () => entries },
    ui: { setStatus: (key, value) => statuses.set(key, value), notify: (...args) => notices.push(args), theme: { fg: (_color, text) => text } },
  };
  registerExplore(pi, {});
  const emit = (name, event = {}) => handlers.get(name)?.(event, ctx);
  const command = (args) => commands.get("explore").handler(args, ctx);
  const tool = (params) => tools.get("explore_mode").execute("call", params, undefined, undefined, ctx);
  const prompt = () => emit("before_agent_start", { systemPrompt: "Original project and tool instructions." });
  emit("session_start");
  return { ctx, entries, handlers, notices, statuses, sent, emit, command, tool, prompt };
}

test("empty directory needs no git/config/issue and immediately starts the requested experiment", async () => {
  const h = host();
  assert.equal(h.prompt(), undefined);
  await h.command("Make a small audio app");
  assert.equal(readMode(h.ctx.cwd).active, true);
  assert.deepEqual(h.sent, [{ text: "Make a small audio app", options: { deliverAs: "followUp" } }]);
  assert.match(h.prompt().systemPrompt, /Original project and tool instructions/);
  assert.match(h.prompt().systemPrompt, /Missing process artifacts.*never blockers/);
  assert.match(h.statuses.get("explore"), /Explore/);
});

test("bare on enables without inventing work; status is read-only", async () => {
  const h = host();
  await h.command("on");
  const before = readFileSync(join(h.ctx.cwd, ".pi", "explore.json"), "utf8");
  await h.command("status");
  assert.equal(h.sent.length, 0);
  assert.equal(h.entries.length, 1);
  assert.equal(readFileSync(join(h.ctx.cwd, ".pi", "explore.json"), "utf8"), before);
});

test("mode survives new sessions, reload, resume, and repeated prompts after compaction", async () => {
  const h = host();
  await h.command("Try report creation");
  for (const reason of ["new", "reload", "resume"]) {
    const next = host(h.ctx.cwd);
    next.emit("session_start", { reason });
    assert.match(next.prompt().systemPrompt, /Try report creation/);
    assert.match(next.prompt().systemPrompt, /Try report creation/);
  }
});

test("off persists and wins over stale active entries on resume", async () => {
  const h = host();
  await h.command("Try it");
  const old = [...h.entries];
  await h.command("off");
  assert.equal(h.prompt(), undefined);
  assert.equal(h.statuses.get("explore"), undefined);
  assert.match(h.sent.at(-1).content, /Previous exploration instructions no longer apply/);
  assert.equal(host(h.ctx.cwd, old).prompt(), undefined);
});

test("mode does not leak into another directory or after session replacement", async () => {
  const h = host();
  await h.command("Audio");
  assert.equal(host().prompt(), undefined);
  h.emit("session_shutdown");
  h.ctx.cwd = directory();
  h.emit("session_start");
  assert.equal(h.prompt(), undefined);
});

test("headless natural-language tool entry/exit and objective updates work", async () => {
  const h = host(directory(), [], false);
  await h.tool({ action: "on", objective: "Prototype A" });
  await h.tool({ action: "on", objective: "Prototype B" });
  assert.match(h.prompt().systemPrompt, /Prototype B/);
  const result = await h.tool({ action: "off" });
  assert.equal(result.details.active, false);
  assert.equal(h.prompt(), undefined);
});

test("another session's explicit off is observed on the next run", async () => {
  const first = host();
  await first.command("on");
  const second = host(first.ctx.cwd);
  await second.command("off");
  assert.equal(first.prompt(), undefined);
});

test("unwritable state does not block iteration and session entries retain the mode", async () => {
  const h = host();
  // A directory at the target path deterministically prevents atomic replacement,
  // including when these tests run as root.
  mkdirSync(join(h.ctx.cwd, ".pi", "explore.json"), { recursive: true });
  await h.command("Build anyway");
  assert.match(h.prompt().systemPrompt, /Build anyway/);
  assert.match(h.notices.at(-1)[0], /could not be saved/);
  const resumed = host(h.ctx.cwd, h.entries);
  assert.match(resumed.prompt().systemPrompt, /Build anyway/);
  await resumed.command("off");
  assert.equal(resumed.prompt(), undefined);
});

test("malformed and unsupported state are ignored without blocking normal work", () => {
  for (const value of ["broken", '{"schemaVersion":2,"active":true,"objective":"x"}', "[]"]) {
    const dir = directory(); mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi", "explore.json"), value);
    assert.equal(host(dir).prompt(), undefined);
  }
});

test("single and resumed delegated tasks receive mode without changing tools/access", async () => {
  const h = host(); await h.command("Try audio");
  const input = { agent: "scout", task: "Inspect the player", context: "fresh", tools: ["read"] };
  h.emit("tool_call", { toolName: "subagent", input });
  assert.match(input.task, /Try audio/);
  assert.match(input.task, /read-only agent roles/);
  assert.match(input.task, /Inspect the player/);
  assert.deepEqual(input.tools, ["read"]);
  assert.equal(input.context, "fresh");
  assert.equal(input.acceptance, false);
  const task = input.task;
  h.emit("tool_call", { toolName: "subagent", input });
  assert.equal(input.task, task);
  const resume = { action: "resume", message: "Try a simpler UI", id: "run-1" };
  h.emit("tool_call", { toolName: "subagent", input: resume });
  assert.match(resume.message, /exploration mode/);
  assert.equal(resume.id, "run-1");
});

test("inactive mode and unrelated/management tools remain unchanged", async () => {
  const h = host();
  const input = { agent: "worker", task: "Implement" };
  h.emit("tool_call", { toolName: "subagent", input });
  assert.equal(input.task, "Implement");
  await h.command("on");
  const management = { action: "schedule.create", workflowScript: "return 1;" };
  h.emit("tool_call", { toolName: "subagent", input: management });
  assert.equal(management.workflowScript, "return 1;");
  h.emit("tool_call", { toolName: "bash", input });
  assert.equal(input.task, "Implement");
});

const instructions = explorationInstructions({ active: true, objective: "Try playback" });
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

test("scripted dynamic run/all/lanes children inherit mode while script literals, results, and options survive", async () => {
  const launches = [];
  const runs = {
    run(key, options) { launches.push(options); return Promise.resolve({ output: key }); },
    all(items, options) { assert.equal(options.limit, 2); launches.push(...items); return Promise.resolve(items.map(x => ({ output: x.key }))); },
    lanes(items) { launches.push(...items.flatMap(x => x.stages)); return Promise.resolve(["lane-result"]); },
  };
  const input = { workflowScript: `
const literal = "runs.run is just text";
const first = await runs.run("one", { agent: "worker", task: "Build " + "player", tools: ["read"] });
const parallel = await runs.all([{ key: "two", agent: "scout", task: first.output }], { limit: 2 });
const lanes = await runs.lanes([{ key: "ui", stages: [{ key: "three", agent: "worker", task: parallel[0].output }] }]);
return { literal, first: first.output, parallel: parallel[0].output, lanes };
` };
  inheritExploration(input, instructions, root);
  const result = await new AsyncFunction("runs", input.workflowScript)(runs);
  assert.deepEqual(result, { literal: "runs.run is just text", first: "one", parallel: "two", lanes: ["lane-result"] });
  assert.equal(launches.length, 3);
  for (const launch of launches) assert.match(launch.task, /Try playback/);
  for (const launch of launches) assert.equal(launch.acceptance, false);
  assert.deepEqual(launches[0].tools, ["read"]);
  const once = input.workflowScript;
  inheritExploration(input, instructions, root);
  assert.equal(input.workflowScript, once);
});

test("file workflows use the requested cwd and retain early returns", async () => {
  const dir = directory(); writeFileSync(join(dir, "experiment.js"), 'return (await runs.run("x", { agent: "worker", task: "Try" })).output;');
  const input = { workflowScriptPath: "experiment.js", cwd: dir };
  inheritExploration(input, instructions, root);
  assert.equal(input.workflowScriptPath, undefined);
  const result = await new AsyncFunction("runs", input.workflowScript)({ run: (_key, options) => ({ output: options.task }) });
  assert.match(result, /Try playback/);
  const missing = { workflowScriptPath: "absent.js" };
  inheritExploration(missing, instructions, root);
  assert.equal(missing.workflowScriptPath, "absent.js");
});

test("named reviews receive context without altering resource authority", () => {
  const input = { workflow: "review", args: { task: "Review UI" } };
  inheritExploration(input, instructions, root);
  assert.equal(input.workflow, "review");
  assert.equal(input.workflowScript, undefined);
  assert.match(input.args.task, /Review UI/);
});

test("explicit verification gates survive direct and scripted delegation", async () => {
  for (const verification of [{ gate: "npm test" }, { acceptance: { level: "verified" } }]) {
    const direct = { agent: "worker", task: "Try", ...verification };
    inheritExploration(direct, instructions, root);
    for (const [key, value] of Object.entries(verification)) assert.deepEqual(direct[key], value);
    const input = { ...verification, workflowScript: 'return runs.run("one", { agent: "worker", task: "Try" });' };
    inheritExploration(input, instructions, root);
    await new AsyncFunction("runs", input.workflowScript)({ run: (_key, params) => {
      assert.equal(params.acceptance, undefined, "keep inherited verification rather than overriding it");
      return {};
    } });
  }
  const input = { workflowScript: 'return runs.run("one", { agent: "worker", task: "Try", gate: "npm test" });' };
  inheritExploration(input, instructions, root);
  await new AsyncFunction("runs", input.workflowScript)({ run: (_key, params) => {
    assert.equal(params.gate, "npm test"); assert.equal(params.acceptance, undefined); return {};
  } });
});
