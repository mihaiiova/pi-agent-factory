#!/usr/bin/env node
// The extension and all CLI entry points share one observation ledger.
import { run } from '../../extensions/project-state/accounting-cli.mjs';
process.exitCode = run();
