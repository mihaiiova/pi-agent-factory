#!/usr/bin/env node
/** Offline escape hatch when a Pi session cannot load. No global Factory needed. */
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { recoveryPlan, applyRecovery, json } from './maintenance-store.mjs';
import { rollbackPlan, applyRollback } from './maintenance-updates.mjs';
const [command, dir = '.', ...flags] = process.argv.slice(2);
try {
  if (!['recover', 'rollback'].includes(command)) throw new Error('Usage: maintenance-cli.mjs recover|rollback <project-dir> [--dry-run] [--yes]');
  const root = resolve(dir);
  const plan = command === 'recover' ? recoveryPlan(root) : rollbackPlan(root);
  console.log(json(plan.preview));
  if (!flags.includes('--dry-run')) {
    let approved = flags.includes('--yes');
    if (!approved && process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      approved = /^y(es)?$/i.test((await rl.question('Apply this maintenance recovery? [y/N] ')).trim());
      rl.close();
    }
    if (!approved) console.log('Not approved; nothing written.');
    else console.log(command === 'recover' ? applyRecovery(root, plan, true) : applyRollback(root, plan, true));
  }
} catch (error) { console.error(`Factory: ${error.message}`); process.exitCode = 1; }
