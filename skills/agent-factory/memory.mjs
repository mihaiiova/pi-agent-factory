/**
 * memory — the orchestrator's own notes, kept across sessions.
 *
 * Opt-in with `orchestrator.memory` in system.yaml. The notes live in
 * `.pi/MEMORY.md` as one `- ` entry per line, are loaded into the
 * orchestrator's prompt at session start, and are written freely by the
 * orchestrator through the `memory` tool within a size cap. Subagents neither
 * see nor write them. Turning a lesson into a lasting change (a prompt, a
 * skill, a tool) still goes through /factory-update review and apply.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const MEMORY_FILE = '.pi/MEMORY.md';
export const DEFAULT_MAX_CHARS = 4000;

/** The memory settings for a validated model, or null when it is off. */
export function memoryConfig(model) {
  const memory = model?.orchestrator?.memory;
  if (memory === true) return { maxChars: DEFAULT_MAX_CHARS };
  if (memory && typeof memory === 'object') return { maxChars: memory.maxChars ?? DEFAULT_MAX_CHARS };
  return null;
}

export function readEntries(root) {
  const file = join(root, MEMORY_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim()).filter(Boolean);
}

const render = (entries) => entries.map((e) => `- ${e}`).join('\n');

function writeEntries(root, entries) {
  const file = join(root, MEMORY_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `# Memory\n\nNotes the orchestrator keeps across sessions. Edit freely.\n\n${render(entries)}\n`);
}

/**
 * Apply one memory action and return what the tool reports. `match` picks the
 * single entry containing that text for replace/remove. Throws when the
 * result would exceed the cap, so the agent shortens or removes entries first.
 */
export function updateMemory(root, { action, text, match }, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const entries = readEntries(root);
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const find = () => {
    const needle = clean(match);
    if (!needle) throw new Error(`${action} needs "match": text from the entry to change`);
    const hits = entries.map((e, i) => (e.includes(needle) ? i : -1)).filter((i) => i >= 0);
    if (hits.length !== 1) throw new Error(hits.length ? `"${needle}" matches ${hits.length} entries; use more of the entry's text` : `No entry contains "${needle}"`);
    return hits[0];
  };
  if (action === 'add') {
    if (!clean(text)) throw new Error('add needs "text"');
    entries.push(clean(text));
  } else if (action === 'replace') {
    if (!clean(text)) throw new Error('replace needs "text"');
    entries[find()] = clean(text);
  } else if (action === 'remove') {
    entries.splice(find(), 1);
  } else {
    throw new Error('action must be add, replace or remove');
  }
  const size = render(entries).length;
  if (size > maxChars) throw new Error(`Memory would be ${size} of ${maxChars} characters. Remove or shorten entries first, then retry.`);
  writeEntries(root, entries);
  return `Memory saved (${size}/${maxChars} characters, ${entries.length} entries). It loads in the next session.`;
}

/** The prompt section loaded at session start. */
export function memoryPrompt(root, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const entries = readEntries(root);
  return [
    '## Memory',
    '',
    'You keep durable notes across sessions with the `memory` tool (add, replace, remove).',
    'Before you finish a task, save what you learned that will matter next time: a correction or preference from the user,',
    'a tool or specialist that failed and what worked instead, a fact about this environment.',
    'Keep each entry to one short line. Don\'t save task details, secrets, or anything already noted below;',
    'update an entry that changed instead of adding a new one.',
    `Memory holds ${maxChars} characters. When it is full, remove or merge entries that matter least.`,
    '',
    entries.length ? render(entries) : '(no notes yet)',
  ].join('\n');
}

/** Failed tool calls in one agent run, by tool name. */
export function failedTools(messages) {
  return [...new Set((Array.isArray(messages) ? messages : [])
    .filter((m) => m?.role === 'toolResult' && m.isError === true && m.toolName !== 'memory' && m.toolName !== 'factory_plan')
    .map((m) => m.toolName))];
}
