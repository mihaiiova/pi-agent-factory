#!/usr/bin/env node
/** Installed/staged credential-free compatibility check. No model or network. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSystem } from './parse.mjs';
import { validateSystem } from './validate.mjs';
import { generateProject, managedPaths } from './generate.mjs';
import { checkCapabilities } from './capabilities.mjs';
import { readText } from './maintenance-store.mjs';
const root = process.argv[2];
const model = parseSystem(readFileSync(join(root, '.pi/system.yaml'), 'utf8'));
const validation = validateSystem(model);
if (!validation.ok) throw new Error(validation.errors.join('\n'));
const settings = JSON.parse(readText(root, '.pi/settings.json'));
const mcpJson = JSON.parse(readText(root, '.pi/mcp.json'));
const opts = { piPackages: settings.packages };
const check = checkCapabilities(model, { settings, mcpJson }, opts);
if (!check.ok) throw new Error(check.errors.join('\n'));
const existing = Object.fromEntries(managedPaths(model).map(p => [p, readText(root, p)]).filter(([,v]) => v !== null));
const plan = generateProject(model, existing, opts);
if (plan.errors.length || plan.files.some(f => ['.pi/settings.json', '.pi/mcp.json'].includes(f.path) && f.action !== 'none')) throw new Error('Staged generator would change derived operational configuration: reconcile separately before upgrading');
console.log('Factory maintenance compatibility checks passed (no model/network)');
