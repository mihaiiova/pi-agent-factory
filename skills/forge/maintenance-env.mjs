/** Project `.env` values for declared `integrations.env` names. Values are
 * written only from a direct user command and never returned to the model. */
import { readText, atomicWrite, safePath } from './maintenance-store.mjs';
import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { integrationSecrets, secretFileProblem } from './integration-secrets.mjs';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

export function declaredEnv(model) {
  return (model?.integrations?.env ?? []).filter(e => typeof e?.name === 'string');
}

/** Names that have a non-empty value in `.env` (values are not returned). */
export function envFileNames(text) {
  const names = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.match(LINE);
    if (match && match[2].replace(/^(["'])(.*)\1$/, '$2') !== '') names.add(match[1]);
  }
  return names;
}

/** Which declared variables are set, without exposing any value. */
export function envStatus(root, model, environment = process.env) {
  const fromFile = envFileNames(readText(root, '.env'));
  const secretNames = [];
  for (const path of new Set(integrationSecrets(model))) {
    if (secretFileProblem(root, path)) continue;
    let fd;
    try {
      fd = openSync(safePath(root, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = fstatSync(fd);
      if (info.isFile() && info.nlink === 1 && !(info.mode & 0o077)) secretNames.push([path, envFileNames(readFileSync(fd, 'utf8'))]);
    } catch { /* An unsafe or inaccessible file is reported separately by check. */ }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  return declaredEnv(model).map(e => ({
    name: e.name,
    secret: e.secret === true,
    set: fromFile.has(e.name) ? '.env' : environment[e.name] ? 'shell environment' : secretNames.find(([, names]) => names.has(e.name))?.[0] ?? 'not set',
  }));
}

/** Replace (or append) one NAME=value line, keeping every other line. */
export function withEnvValue(text, name, value) {
  if (/[\r\n\0]/.test(value)) throw new Error('Values must be a single line');
  const lines = String(text ?? '').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const entry = `${name}=${value}`;
  const index = lines.findIndex(line => line.match(LINE)?.[1] === name);
  if (index >= 0) lines[index] = entry;
  else lines.push(entry);
  return `${lines.join('\n')}\n`;
}

export function setEnvValue(root, model, name, value, destination = '.env') {
  if (!declaredEnv(model).some(e => e.name === name)) throw new Error(`${name} is not declared in integrations.env; propose declaring it first`);
  if (destination !== '.env') {
    if (!integrationSecrets(model).includes(destination)) throw new Error('Destination is not a declared integration secretsFile');
    const problem = secretFileProblem(root, destination);
    if (problem) throw new Error(`Integration secretsFile ${destination}: ${problem}`);
  }
  atomicWrite(root, destination, withEnvValue(readText(root, destination), name, value));
}
