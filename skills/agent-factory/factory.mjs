#!/usr/bin/env node
/**
 * factory — the deterministic Agent Factory CLI (Node ESM).
 *
 * MVP (spec 1): `factory validate <dir>` reads `<dir>/.pi/system.yaml`, parses
 * it with the pinned `yaml` package, migrates older supported schema versions
 * forward, validates against schema v1, and prints actionable errors.
 *
 * Exit codes: 0 valid · 1 invalid / missing / unparseable.
 *
 * Generation (`generate`), discovery, import, and modify are later specs.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSystem } from "./parse.mjs";
import { migrate } from "./migrate.mjs";
import { validateSystem } from "./validate.mjs";

const USAGE = `Usage: factory validate <dir>

Read <dir>/.pi/system.yaml, migrate it forward if needed, and validate it
against the schema v1 contract (see schema.md). Prints each error to stderr.

Exit codes:
  0  valid
  1  invalid, missing, or unparseable system.yaml

Commands available in this spec:
  validate <dir>   validate a project's declarative model
`;

function fail(message) {
  console.error(`error - ${message}`);
  process.exitCode = 1;
}

function main(argv) {
  const [command, dir] = argv;

  if (command === "-h" || command === "--help" || command === undefined) {
    process.stdout.write(USAGE);
    process.exitCode = command === undefined ? 1 : 0;
    return;
  }

  if (command !== "validate") {
    fail(`unknown command "${command}"`);
    process.stderr.write(USAGE);
    return;
  }

  if (!dir) {
    fail("missing <dir> argument");
    process.stderr.write(USAGE);
    return;
  }

  const systemPath = join(resolve(dir), ".pi", "system.yaml");

  let text;
  try {
    text = readFileSync(systemPath, "utf-8");
  } catch {
    fail(`no readable system.yaml at ${systemPath}`);
    return;
  }

  let doc;
  try {
    doc = parseSystem(text);
  } catch (err) {
    fail(`failed to parse ${systemPath}: ${err.message}`);
    return;
  }

  // Migrate older supported versions (schema omitted → v0, or explicit 0).
  const isObject = doc !== null && typeof doc === "object" && !Array.isArray(doc);
  const needsMigration =
    isObject && (doc.schema === 0 || doc.schema === undefined);
  const normalized = needsMigration ? migrate(doc) : doc;

  const { ok, errors } = validateSystem(normalized);
  if (ok) {
    console.log(`ok - ${systemPath} is a valid system.yaml (schema v1)`);
    process.exitCode = 0;
  } else {
    for (const error of errors) {
      console.error(`error - ${error}`);
    }
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
