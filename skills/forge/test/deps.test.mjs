import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimePackages } from "../deps.mjs";

const FORGE = "git:github.com/mihaiiova/pi-forge@v0.19.1";
const PI_PACKAGES = [
  "npm:pi-mcp-adapter@2.32.1",
  "npm:pi-subagents@0.83.1",
  "npm:pi-web-access@0.27.0",
  "npm:yaml@2.8.3",
  "npm:@juicesharp/rpiv-ask-user-question@2.9.0",
  "npm:@lanlance/pi-btw@0.2.0",
];

test("runtimePackages emits the Forge pin and two runtime primitives, in order", () => {
  const { packages, errors } = runtimePackages(PI_PACKAGES);
  assert.deepEqual(packages, [FORGE, "npm:pi-subagents@0.83.1", "npm:pi-mcp-adapter@2.32.1"]);
  assert.deepEqual(errors, []);
});

test("runtimePackages appends declared npm:/git: specs after the primitives", () => {
  const { packages, errors } = runtimePackages(PI_PACKAGES, ["npm:foo@1.2.3", "git:github.com/x/y@v1"]);
  assert.deepEqual(packages, [
    FORGE,
    "npm:pi-subagents@0.83.1",
    "npm:pi-mcp-adapter@2.32.1",
    "npm:foo@1.2.3",
    "git:github.com/x/y@v1",
  ]);
  assert.deepEqual(errors, []);
});

test("runtimePackages never emits dev-only, web, local-path, or secret-shaped entries", () => {
  const hostile = [
    "npm:pi-subagents@0.83.1",
    "npm:pi-mcp-adapter@2.32.1",
    "npm:pi-web-access@0.27.0",       // web tools — dev/ambient, not a primitive
    "npm:yaml@2.8.3",                  // forge dev dep
    "git:github.com/mihaiiova/pi-config@sha", // the old skill-leak pin
    "file:../../local",
    "link:../x",
    "/abs/path",
    "./rel/path",
    "GH_TOKEN=secret",
    "npm:@juicesharp/rpiv-ask-user-question@2.9.0",
  ];
  const { packages } = runtimePackages(hostile, []);
  assert.deepEqual(packages, [FORGE, "npm:pi-subagents@0.83.1", "npm:pi-mcp-adapter@2.32.1"]);
});

test("a missing required primitive is an error, never silently omitted", () => {
  const { packages, errors } = runtimePackages(["npm:pi-subagents@0.83.1"]);
  assert.deepEqual(packages, [FORGE, "npm:pi-subagents@0.83.1"]);
  assert.ok(errors.some((e) => e.includes('"pi-mcp-adapter"')), "names the missing primitive");
});

test("an unpinned declared spec is rejected", () => {
  const { errors } = runtimePackages(PI_PACKAGES, ["npm:foo", "git:github.com/x/y"]);
  assert.ok(errors.some((e) => e.includes("npm:foo") && e.includes("pinned")), "unpinned npm rejected");
  assert.ok(errors.some((e) => e.includes("git:github.com/x/y") && e.includes("pinned")), "unpinned git rejected");
});

test("a declared spec that conflicts with a pinned primitive is rejected", () => {
  const { packages, errors } = runtimePackages(PI_PACKAGES, ["npm:pi-subagents@0.60.0"]);
  assert.ok(!packages.includes("npm:pi-subagents@0.60.0"), "conflicting version not emitted");
  assert.ok(errors.some((e) => e.includes("conflicts")), "conflict reported");
});

test("runtimePackages output is deterministic", () => {
  const a = runtimePackages(PI_PACKAGES, ["npm:foo@1.0.0"]);
  const b = runtimePackages(PI_PACKAGES, ["npm:foo@1.0.0"]);
  assert.deepEqual(a, b);
});

test("runtimePackages tolerates empty inputs by reporting missing primitives", () => {
  const { packages, errors } = runtimePackages(undefined, undefined);
  assert.deepEqual(packages, [FORGE]);
  assert.equal(errors.length, 2, "both primitives are reported missing");
});
