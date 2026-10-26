/** Best-effort credential redaction at the model boundary; never reads auth/env files. */
import { loadYaml } from './yaml-loader.mjs';
import { readText } from './maintenance-store.mjs';
const sensitive = /(token|secret|password|authorization|cookie|credential|api[-_]?key|private[-_]?key|auth$|^key$)/i;
const reference = /^(?:Bearer )?\$\{[A-Z_][A-Z0-9_]*\}$/;
function walk(value, path, visit) {
  if (Array.isArray(value)) return value.map((v, i) => walk(v, [...path, i], visit));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, walk(v, [...path, k], visit)]));
  return visit(value, path);
}
function isCredential(value, path) {
  if (typeof value !== 'string' || !value.length || reference.test(value)) return false;
  const plain = value.replace(/\$\{[A-Z_][A-Z0-9_]*\}/g, '');
  const embedded = /https?:\/\/[^/@\s:]+(?::[^/@\s]+)?@|[?&](?:token|api_key|key|secret|password)=[^&#\s]+/i.test(plain);
  return sensitive.test(String(path.at(-1))) || path.at(-2) === 'env' || embedded;
}
export function redacted(value) {
  return walk(value, [], (v, path) => isCredential(v, path) ? '[redacted]' : v);
}
function secretsAt(root) {
  const secrets = new Set();
  for (const p of ['.pi/system.yaml', '.pi/settings.json', '.pi/mcp.json']) {
    try {
      const text = readText(root, p);
      const value = p.endsWith('.yaml') ? loadYaml().parse(text) : JSON.parse(text);
      walk(value, [], (v, path) => { if (isCredential(v, path)) secrets.add(v); return v; });
    } catch { /* inspection separately reports unreadable configuration */ }
  }
  return [...secrets].sort((a,b) => b.length - a.length);
}
export function redactForModel(root, value) {
  let text = JSON.stringify(redacted(value));
  for (const secret of secretsAt(root)) {
    // Cover both ordinary strings and JSON-escaped strings inside diff text.
    const encoded = JSON.stringify(secret).slice(1, -1);
    text = text.split(encoded).join('[redacted]');
  }
  // Known credential formats in authored prose/CLI arguments. This is not DLP:
  // custom credentials embedded in arbitrary free text cannot be identified.
  text = text.replace(/(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/g, '[redacted]');
  return JSON.parse(text);
}
export function assertNoNewSecrets(before, after) {
  walk(after, [], (value, path) => {
    // Named schema entities can move when a sibling is removed. Compare their
    // unchanged credential fields by name, not by the old array index.
    let old = before, next = after;
    for (const key of path) {
      old = Array.isArray(next) && next[key]?.name && Array.isArray(old)
        ? old.find(item => item?.name === next[key].name) : old?.[key];
      next = next?.[key];
    }
    if ((typeof value === 'string' && value.includes('[redacted]') && old !== value) || (isCredential(value, path) && old !== value)) throw new Error(`Use an environment reference, not a literal credential at ${path.join('.')}`);
    return value;
  });
}
