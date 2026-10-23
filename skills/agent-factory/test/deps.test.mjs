import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimePackages } from "../deps.mjs";

const PI_PACKAGES = [
  "npm:pi-mcp-adapter@2.32.1",
  "npm:pi-subagents@0.65.0",
  "npm:pi-web-access@0.27.0",
  "npm:yaml@2.8.3",
  "npm:@juicesharp/rpiv-ask-user-question@2.9.0",
  "npm:@lanlance/pi-btw@0.2.0",
];

test("runtimePackages emits only the two runtime primitives, in order", () => {
  const pins = runtimePackages(PI_PACKAGES);
  assert.deepEqual(pins, ["npm:pi-subagents@0.65.0", "npm:pi-mcp-adapter@2.32.1"]);
});

test("runtimePackages appends declared npm:/git: specs after the primitives", () => {
  const pins = runtimePackages(PI_PACKAGES, ["npm:foo@1.2.3", "git:github.com/x/y@v1"]);
  assert.deepEqual(pins, [
    "npm:pi-subagents@0.65.0",
    "npm:pi-mcp-adapter@2.32.1",
    "npm:foo@1.2.3",
    "git:github.com/x/y@v1",
  ]);
});

test("runtimePackages never emits dev-only, web, local-path, or secret-shaped entries", () => {
  const hostile = [
    "npm:pi-subagents@0.65.0",
    "npm:pi-mcp-adapter@2.32.1",
    "npm:pi-web-access@0.27.0",       // web tools — dev/ambient, not a primitive
    "npm:yaml@2.8.3",                  // factory dev dep
    "git:github.com/mihaiiova/pi-config@sha", // the old skill-leak pin
    "file:../../local",
    "link:../x",
    "/abs/path",
    "./rel/path",
    "GH_TOKEN=secret",
    "npm:@juicesharp/rpiv-ask-user-question@2.9.0",
  ];
  const pins = runtimePackages(hostile, ["file:../declared-local"]);
  assert.deepEqual(pins, ["npm:pi-subagents@0.65.0", "npm:pi-mcp-adapter@2.32.1"]);
});

test("runtimePackages handles scoped npm names and tolerates empty inputs", () => {
  assert.deepEqual(runtimePackages(undefined, undefined), []);
  assert.deepEqual(runtimePackages([], []), []);
  const pins = runtimePackages(["npm:@scope/thing@1.0.0", "npm:pi-subagents@0.65.0"], undefined);
  assert.deepEqual(pins, ["npm:pi-subagents@0.65.0"]);
});
