import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRuntimePlan, launcherScript, AGENT_DIR } from "../runtime.mjs";

const PI_PACKAGES = ["npm:pi-subagents@0.65.0", "npm:pi-mcp-adapter@2.32.1", "npm:pi-web-access@0.27.0"];

test("buildRuntimePlan derives the isolated agent dir, packages, and warnings", () => {
  const plan = buildRuntimePlan({ packages: ["npm:foo@1.0.0"] }, { piPackages: PI_PACKAGES });
  assert.equal(plan.agentDir, ".factory/pi-home");
  assert.deepEqual(plan.packages, ["npm:pi-subagents@0.65.0", "npm:pi-mcp-adapter@2.32.1", "npm:foo@1.0.0"]);
  assert.ok(plan.warnings.length >= 2, "warns about auth + parent context files");
});

test("launcherScript sets the isolated agent dir and never copies auth.json", () => {
  const script = launcherScript();
  assert.match(script, /PI_CODING_AGENT_DIR/);
  assert.match(script, /\.factory\/pi-home/);
  assert.match(script, /exec pi/);
  assert.match(script, /\$\{BASH_SOURCE\[0\]\}/, "resolves root from its own location");
  assert.match(script, /command -v pi/, "fails explicitly when pi is missing");
  assert.match(script, /cd "\$ROOT"/, "changes into the project root");
  assert.match(script, /\.pi\/system\.yaml/, "validates the project model before launching");
  assert.ok(!/auth\.json|cp .*auth|ln .*auth/.test(script), "must not copy host credentials");
});

test("AGENT_DIR constant is the stable project-relative pi-home", () => {
  assert.equal(AGENT_DIR, ".factory/pi-home");
});
