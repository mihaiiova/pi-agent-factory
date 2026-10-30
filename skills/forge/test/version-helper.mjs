import { readFileSync } from 'node:fs';

// Derive the expected release pin independently from package.json, the
// generator's version source, so release bumps do not stale the tests.
const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
export const expectedForgePin = `git:github.com/mihaiiova/pi-forge@v${version}`;
