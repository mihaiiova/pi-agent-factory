import { test } from "node:test";
import assert from "node:assert/strict";
import { declareDependencies } from "../deps.mjs";

const PI_PACKAGES = [
  "npm:pi-mcp-adapter@2.32.1",
  "npm:pi-subagents@0.65.0",
  "npm:pi-web-access@0.27.0",
  "npm:yaml@2.8.3",
];

test("declareDependencies emits the git pin first, then only used npm pins", () => {
  const pins = declareDependencies(
    PI_PACKAGES,
    "7c48a54cb02f4c259248903f27b23a0cdfa7dbd5",
    ["pi-subagents", "pi-mcp-adapter"],
  );

  assert.deepEqual(pins, [
    "git:github.com/mihaiiova/pi-config@7c48a54cb02f4c259248903f27b23a0cdfa7dbd5",
    "npm:pi-mcp-adapter@2.32.1",
    "npm:pi-subagents@0.65.0",
  ]);
});

test("declareDependencies keeps exact npm pins and drops unused ones", () => {
  const pins = declareDependencies(PI_PACKAGES, "abc", ["pi-web-access"]);
  assert.ok(pins.includes("npm:pi-web-access@0.27.0"));
  assert.ok(!pins.some((p) => p.includes("yaml")), "yaml is unused and dropped");
  assert.ok(!pins.some((p) => p.includes("pi-subagents")), "unused pi-subagents dropped");
});

test("declareDependencies never emits local-path or secret-shaped entries", () => {
  const hostile = [
    "file:../../local-pkg",
    "link:../sibling",
    "/abs/path/pkg",
    "./rel/pkg",
    "GH_TOKEN=supersecret",
    "https://user:pass@example.com",
    "npm:pi-subagents@0.65.0",
  ];
  const pins = declareDependencies(hostile, "abc", ["pi-subagents"]);
  assert.deepEqual(pins, [
    "git:github.com/mihaiiova/pi-config@abc",
    "npm:pi-subagents@0.65.0",
  ]);
});

test("declareDependencies tolerates a missing rev and empty inputs", () => {
  assert.deepEqual(declareDependencies(undefined, undefined, undefined), []);
  assert.deepEqual(declareDependencies([], "", []), []);
});
