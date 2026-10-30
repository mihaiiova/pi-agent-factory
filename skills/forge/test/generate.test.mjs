import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystem } from "../parse.mjs";
import { generateProject } from "../generate.mjs";
import { expectedForgePin } from './version-helper.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(here, "fixtures/generate/minimal");
const minimalYaml = readFileSync(resolve(fixtureRoot, ".pi/system.yaml"), "utf-8");
const model = parseSystem(minimalYaml);

const EXPECTED_PATHS = [
  ".env.example",
  ".gitignore",
  ".pi/APPEND_SYSTEM.md",
  ".pi/CAPABILITIES.md",
  ".pi/mcp.json",
  ".pi/settings.json",
  "README.md",
  "data/knowledge/.gitkeep",
  "run",
];

function byPath(files, path) {
  return files.find((f) => f.path === path);
}

test("fresh generate creates the full single-agent tree", () => {
  const { files } = generateProject(model, {});

  assert.deepEqual(
    files.map((f) => f.path).sort(),
    EXPECTED_PATHS.slice().sort(),
  );
  for (const f of files) {
    assert.equal(f.action, "create", `${f.path} should be created fresh`);
  }

  const settings = JSON.parse(byPath(files, ".pi/settings.json").content);
  assert.equal(settings.defaultProvider, "provider-a");
  assert.equal(settings.defaultModel, "model-large");
  assert.equal(settings.defaultThinkingLevel, "medium");
  assert.deepEqual(settings.defaultTools, [
    "read", "grep", "find", "ls", "bash", "edit", "write", "subagent",
  ]);
  assert.equal(settings.subagents, undefined, "no routing overrides: agents carry their own models");

  const mcp = JSON.parse(byPath(files, ".pi/mcp.json").content);
  assert.deepEqual(mcp, { mcpServers: {}, autoEnableCodemode: false });
});

test("generated project pins the Forge package to its release", () => {
  const { files } = generateProject(model, {});
  const settings = JSON.parse(byPath(files, ".pi/settings.json").content);
  assert.ok(settings.packages.includes(expectedForgePin));
});

test("re-running generate is a no-op (idempotent)", () => {
  const first = generateProject(model, {});
  const existing = Object.fromEntries(first.files.map((f) => [f.path, f.content]));

  const second = generateProject(model, existing);
  for (const f of second.files) {
    assert.equal(f.action, "none", `${f.path} should be unchanged on re-run`);
  }
});

test("unrelated keys in .pi/settings.json survive regeneration", () => {
  const existing = {
    ".pi/settings.json": JSON.stringify({
      theme: "dark",
      defaultModel: "old/model",
      subagents: { agentOverrides: { worker: { model: "old/model" } }, maxDepth: 2 },
    }),
  };

  const { files } = generateProject(model, existing);
  const settings = JSON.parse(byPath(files, ".pi/settings.json").content);

  assert.equal(settings.theme, "dark", "unrelated key preserved");
  assert.equal(settings.defaultModel, "model-large", "model-owned key overwritten");
  assert.deepEqual(settings.subagents, { maxDepth: 2 }, "stale routing overrides dropped, other subagent settings kept");
});

test("orchestrator.model and thinking drive the primary session", () => {
  const changed = {
    ...model,
    orchestrator: { ...model.orchestrator, model: "openrouter/anthropic/some-model", thinking: "low" },
  };

  const { files } = generateProject(changed, {});
  const settings = JSON.parse(byPath(files, ".pi/settings.json").content);

  assert.equal(settings.defaultProvider, "openrouter");
  assert.equal(settings.defaultModel, "anthropic/some-model");
  assert.equal(settings.defaultThinkingLevel, "low");

  const { thinking, ...noThinking } = changed.orchestrator;
  const plain = JSON.parse(byPath(generateProject({ ...model, orchestrator: noThinking }, {}).files, ".pi/settings.json").content);
  assert.equal(plain.defaultThinkingLevel, undefined, "thinking omitted when undeclared");
});

test("each agent's own model, thinking and skills land in its frontmatter", () => {
  const withAgent = {
    ...model,
    agents: [{ name: "helper", model: "provider-b/model-small", thinking: "high", skills: ["notes"], tools: ["read"] }],
    skills: [{ name: "notes", body: "# Notes" }],
  };
  const agent = byPath(generateProject(withAgent, {}).files, ".pi/agents/helper.md").content;
  assert.match(agent, /^model: provider-b\/model-small$/m);
  assert.match(agent, /^thinking: high$/m);
  assert.match(agent, /^skills:\n  - notes$/m);
});

test("sourced skills generate no SKILL.md and packaged sources join runtime packages", () => {
  const sourced = {
    ...model,
    skills: [
      { name: "packaged", source: "npm:@acme/skills@1.0.0" },
      { name: "local", source: "./vendor/local" },
    ],
  };
  const { files } = generateProject(sourced, {}, {
    piPackages: ["npm:pi-subagents@0.83.1"],
  });
  assert.ok(!files.some((f) => f.path.startsWith(".pi/skills/packaged") || f.path.startsWith(".pi/skills/local")));
  const settings = JSON.parse(byPath(files, ".pi/settings.json").content);
  assert.deepEqual(settings.packages, [expectedForgePin, "npm:pi-subagents@0.83.1", "npm:@acme/skills@1.0.0"]);
});

test("unrelated keys in .pi/mcp.json survive regeneration", () => {
  const existing = {
    ".pi/mcp.json": JSON.stringify({
      mcpServers: { openseo: { url: "http://localhost:3002/mcp" } },
      extra: true,
    }),
  };

  const { files } = generateProject(model, existing);
  const mcp = JSON.parse(byPath(files, ".pi/mcp.json").content);

  assert.equal(mcp.extra, true, "non-capability key preserved");
  // system.yaml is authoritative: the model declares no MCP servers, so a
  // previously-present (undeclared) server is dropped, not preserved.
  assert.deepEqual(mcp.mcpServers, {}, "undeclared server removed");
});

test("user edits to an authored file survive when the model is unchanged", () => {
  const first = generateProject(model, {});
  const original = byPath(first.files, ".pi/APPEND_SYSTEM.md").content;
  const markerLine = original.split("\n", 1)[0];
  const userEdited = `${markerLine}\nI added my own orchestrator instructions.\n`;

  const { files } = generateProject(model, { ".pi/APPEND_SYSTEM.md": userEdited });
  const entry = byPath(files, ".pi/APPEND_SYSTEM.md");

  assert.equal(entry.action, "none");
  assert.equal(entry.content, userEdited);
});

test("user-authored files without a forge marker are never touched", () => {
  const existing = { "README.md": "# My own README\n\nHand written.\n" };

  const { files } = generateProject(model, existing);
  const entry = byPath(files, "README.md");

  assert.equal(entry.action, "none");
  assert.equal(entry.content, existing["README.md"]);
});

test("conflict when a user edits an authored file AND the model changes it", () => {
  const first = generateProject(model, {});
  const original = byPath(first.files, ".pi/APPEND_SYSTEM.md").content;
  const markerLine = original.split("\n", 1)[0];
  const userEdited = `${markerLine}\nUser's own instructions.\n`;

  const changedModel = {
    ...model,
    orchestrator: { ...model.orchestrator, prompt: "A new orchestrator prompt.\n" },
  };

  const { files } = generateProject(changedModel, { ".pi/APPEND_SYSTEM.md": userEdited });
  const entry = byPath(files, ".pi/APPEND_SYSTEM.md");

  assert.equal(entry.action, "conflict");
  assert.equal(entry.content, userEdited, "conflict must not overwrite");
  assert.equal(entry.desired, changedModel.orchestrator.prompt);
});

test("authored scaffold carries an forge marker and the scaffolded body", () => {
  const { files } = generateProject(model, {});
  const append = byPath(files, ".pi/APPEND_SYSTEM.md").content;
  assert.match(append, /^<!-- forge:generated v1 sha256=[0-9a-f]{64} -->\n/);
  assert.ok(append.endsWith(model.orchestrator.prompt));

  const gitignore = byPath(files, ".gitignore").content;
  assert.match(gitignore, /^# forge:generated v1 sha256=[0-9a-f]{64}\n/);
  assert.ok(gitignore.includes("data/"));
  assert.ok(gitignore.includes(".env\n"));
  assert.ok(gitignore.includes(".pi/state.json"));
  assert.ok(gitignore.includes(".pi/sessions/"));

  const readme = byPath(files, "README.md").content;
  assert.ok(readme.includes(`# ${model.name}`));
  assert.ok(readme.includes(model.description));
});

test("golden tree: minimal fixture produces the committed snapshot", () => {
  const goldenDir = resolve(fixtureRoot, "golden");
  const { files } = generateProject(model, {}, {
    piPackages: ["npm:pi-subagents@0.83.1", "npm:pi-web-access@0.27.0"],
  });

  const produced = new Map(files.map((f) => [f.path, f.content]));
  const goldenPaths = readdirSync(goldenDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      entry.parentPath === goldenDir
        ? entry.name
        : `${entry.parentPath.slice(goldenDir.length + 1)}/${entry.name}`,
    )
    .sort();

  assert.deepEqual([...produced.keys()].sort(), goldenPaths);
  for (const path of goldenPaths) {
    const expected = readFileSync(resolve(goldenDir, path), "utf-8")
      .replace('git:github.com/mihaiiova/pi-forge@v<PACKAGE_VERSION>', expectedForgePin);
    assert.equal(produced.get(path), expected, `golden mismatch: ${path}`);
  }
});

test("runtime packages are computed from piPackages + declared model packages", () => {
  const piPackages = [
    "npm:pi-subagents@0.83.1",
        "npm:pi-web-access@0.27.0",
  ];
  const withDeclared = generateProject(
    { ...model, packages: ["npm:foo@1.0.0"] },
    {},
    { piPackages },
  );
  const settings = JSON.parse(byPath(withDeclared.files, ".pi/settings.json").content);
  assert.deepEqual(settings.packages, [
    expectedForgePin,
    "npm:pi-subagents@0.83.1",
        "npm:foo@1.0.0",
  ]);

  // Without piPackages, the Forge pin is still present (but primitives are missing).
  const plain = generateProject(model, {});
  const plainSettings = JSON.parse(byPath(plain.files, ".pi/settings.json").content);
  assert.deepEqual(plainSettings.packages, [expectedForgePin]);
});

test("generateProject reports missing runtime primitives as errors", () => {
  const { files, errors } = generateProject(model, {}, { piPackages: [] });
  assert.ok(errors.some((e) => e.includes('"pi-subagents"')), "the missing primitive is reported");
  const settings = JSON.parse(byPath(files, ".pi/settings.json").content);
  assert.deepEqual(settings.packages, [expectedForgePin]);
});

test("generateProject emits the executable run launcher", () => {
  const { files } = generateProject(model, {});
  const run = byPath(files, "run");
  assert.ok(run, "run launcher is emitted");
  assert.equal(run.executable, true, "run launcher is marked executable");
  assert.match(run.content, /PI_CODING_AGENT_DIR/);
  assert.match(run.content, /exec pi/);
});

test("MCP and extension specialists run in the background; builtin-only ones do not", () => {
  const withAgents = {
    ...model,
    agents: [
      { name: "researcher", model: "provider-a/m", tools: ["read", "mcp:seo", "web_search"] },
      { name: "writer", model: "provider-a/m", tools: ["read", "write"] },
    ],
  };
  const { files } = generateProject(withAgents, { ".forge/pi-home/extensions/subagent/config.json": '{"timeoutMs": 5}\n' });
  assert.match(byPath(files, ".pi/agents/researcher.md").content, /\nasync: true\n/);
  assert.doesNotMatch(byPath(files, ".pi/agents/writer.md").content, /async:/);
  const config = byPath(files, ".forge/pi-home/extensions/subagent/config.json");
  assert.deepEqual(JSON.parse(config.content), { timeoutMs: 5, forceTopLevelAsync: true });
  assert.match(byPath(files, ".pi/APPEND_SYSTEM.md").content, /`researcher` use MCP or extension tools/);

  // Builtin-only systems keep their files exactly as before.
  const plain = generateProject({ ...model, agents: [withAgents.agents[1]] }, {}).files;
  assert.equal(byPath(plain, ".forge/pi-home/extensions/subagent/config.json"), undefined);
  assert.doesNotMatch(byPath(plain, ".pi/APPEND_SYSTEM.md").content, /Running specialists/);
});

test("agreed document formats land in their writer's instructions", () => {
  const documents = [
    { name: "decisions", path: "strategy/decisions.md", writer: model.orchestrator.name, purpose: "Owner decisions", maxWords: 600,
      sections: [{ heading: "Decide now", guide: "Yes/no questions" }, { heading: "Actions" }], rules: ["Caveats only in the last section"] },
    { name: "evidence-packet", writer: "writer", sections: [{ heading: "Findings" }] },
  ];
  const withDocs = { ...model, agents: [{ name: "writer", model: "provider-a/m", tools: ["read"], prompt: "Research." }], documents };
  const { files } = generateProject(withDocs, {});
  const lead = byPath(files, ".pi/APPEND_SYSTEM.md").content;
  assert.match(lead, /## Document formats/);
  assert.match(lead, /### decisions → `strategy\/decisions.md`/);
  assert.match(lead, /Length: at most 600 words\./);
  assert.match(lead, /1\. \*\*Decide now\*\* — Yes\/no questions\n2\. \*\*Actions\*\*/);
  assert.match(lead, /- Caveats only in the last section/);
  assert.doesNotMatch(lead, /evidence-packet/);
  const writer = byPath(files, ".pi/agents/writer.md").content;
  assert.match(writer, /  Research\.\n  \n  ## What you can use\n[\s\S]*## Document formats/);
  assert.match(writer, /### evidence-packet \(returned in your output\)/);
});

test("document delivery targets are rendered as steps for the writer", () => {
  const documents = [{ name: "article", path: "drafts/article.md", writer: "writer", sections: [{ heading: "Body" }],
    deliver: [{ mcp: "gdrive", tool: "create_file", with: { folder: "Owlie/Articles" } }, { mcp: "slack", tool: "post_message", note: "link only" }] }];
  const withDocs = { ...model, agents: [{ name: "writer", model: "provider-a/m", tools: ["write", "mcp:gdrive/create_file", "mcp:slack/post_message"] }], documents };
  const writer = byPath(generateProject(withDocs, {}).files, ".pi/agents/writer.md").content;
  assert.match(writer, /When the file is written, also deliver it:/);
  assert.match(writer, /- MCP server `gdrive`, tool `create_file` with \{"folder":"Owlie\/Articles"\}/);
  assert.match(writer, /- MCP server `slack`, tool `post_message` — link only/);
  assert.match(writer, /Report where each delivery landed/);
});

test("existing gitignore gets only missing safety entries without changing user text", () => {
  const original = "# user rules\nnode_modules\n.env/\n.pi/sessions";
  const file = byPath(generateProject(model, { ".gitignore": original }).files, ".gitignore");
  assert.equal(file.action, "write");
  assert.equal(file.content, original + "\n# forge: required ignores\n.env\n.forge/\n.pi/state.json\n.pi/git/\n.pi/npm/\n");
  const again = byPath(generateProject(model, { ".gitignore": file.content }).files, ".gitignore");
  assert.equal(again.action, "none");
  assert.equal(again.content, file.content);
});

test("complete user gitignore stays byte-for-byte unchanged", () => {
  const original = "# hand-written\r\n.env\r\n.forge\r\n.pi/state.json\r\n.pi/sessions\r\n.pi/git\r\n.pi/npm/\r\n";
  const file = byPath(generateProject(model, { ".gitignore": original }).files, ".gitignore");
  assert.equal(file.action, "none");
  assert.equal(file.content, original);
});

test("edited scaffold gets safety entries appended without replacing edits", () => {
  const scaffold = byPath(generateProject(model, {}).files, ".gitignore").content;
  const edited = scaffold.replace('.forge/\n', '') + '# custom\n';
  const file = byPath(generateProject(model, { ".gitignore": edited }).files, ".gitignore");
  assert.equal(file.action, 'write');
  assert.equal(file.content, edited + '# forge: required ignores\n.forge/\n');
});

test('README lists exact named workflow commands and unattended options', () => {
  const workflowModel = { ...model, workflows: [{ name: 'daily-report', entry: model.orchestrator.name }] };
  const readme = byPath(generateProject(workflowModel, {}).files, 'README.md').content;
  assert.match(readme, /\.\/run --workflow daily-report/);
  assert.match(readme, /--allow-concurrent/);
  assert.match(readme, /--timeout/);
  assert.match(readme, /--input/);
});

test('README states timeout cleanup ownership and detached-process limit', () => {
  const workflowModel = { ...model, workflows: [{ name: 'daily-report', entry: model.orchestrator.name }] };
  const readme = byPath(generateProject(workflowModel, {}).files, 'README.md').content;
  assert.match(readme, /pi-subagents/);
  assert.match(readme, /independently detached processes.*survive/i);
  assert.match(readme, /cleanup.*incomplete/i);
});

test('README describes systemd scope and fallback', () => {
  const workflowModel = { ...model, workflows: [{ name: 'daily-report', entry: model.orchestrator.name }] };
  const readme = byPath(generateProject(workflowModel, {}).files, 'README.md').content;
  assert.match(readme, /systemd.*scope/i);
  assert.match(readme, /fallback/i);
});
