/**
 * The agent runtime: what a generated system's agents use while they work —
 * the orchestrator's memory, declared command tools, request_permission and
 * /factory-permission, and the lead's capability section for projects built
 * before it was build output.
 *
 * The installed Factory tooling loads this from the bundle recorded in
 * .factory/build.json (the one that last built the project), so updating the
 * tooling changes none of it until the project is rebuilt. Stable interface:
 * registerAgent(pi, Type, root, { maintaining }), where maintaining() is true
 * during a /factory-update turn.
 */
import { readText } from './maintenance-store.mjs';
import { parsedModel } from './changes.mjs';
import { memoryPrompt, updateMemory, failedTools, MEMORY_FILE } from './memory.mjs';
import { registerPermissions } from './permissions-extension.mjs';
import { capabilitySection } from './agent-context.mjs';

export function registerAgent(pi, Type, root, { maintaining = () => false } = {}) {
  registerMemory(pi, Type, root, maintaining);
  registerPermissions(pi, Type, root);
  registerAgentContext(pi, root);
}

/**
 * Orchestrator memory: notes loaded once per session, written freely by the
 * memory tool, and a nudge to record a lesson after a task with failed tool
 * calls. Subagent processes skip all of it.
 */
function registerMemory(pi, Type, root, maintaining) {
  if (process.env.PI_SUBAGENT_CHILD === '1') return;
  let snapshot = '';
  let failed = [];
  let maintenanceTurn = false;
  pi.registerTool({
    name: 'memory', label: 'Memory',
    description: `Keep durable notes across sessions in ${MEMORY_FILE}: add an entry, or replace/remove the one entry containing "match". Notes load at the start of the next session.`,
    promptSnippet: 'Save, update or remove a durable note for future sessions',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('add'), Type.Literal('replace'), Type.Literal('remove')]),
      text: Type.Optional(Type.String({ description: 'add/replace: the entry, one short line' })),
      match: Type.Optional(Type.String({ description: 'replace/remove: text from the existing entry' })),
    }),
    async execute(_id, params) {
      return { content: [{ type: 'text', text: updateMemory(root, params) }], details: undefined };
    },
  });
  // A snapshot keeps the prompt stable; writes take effect next session.
  pi.on('session_start', () => { try { snapshot = memoryPrompt(root); } catch { snapshot = ''; } });
  pi.on('before_agent_start', (event) => {
    if (!snapshot) return;
    // A /factory-update turn can't use the memory tool; keep any nudge for later.
    maintenanceTurn = maintaining();
    if (maintenanceTurn) return { systemPrompt: `${event.systemPrompt}\n\n${snapshot}` };
    const nudge = failed.length ? `\n\nThe previous task had failed tool calls (${failed.join(', ')}). If you learned something that will matter next time, save it with memory.` : '';
    failed = [];
    return { systemPrompt: `${event.systemPrompt}\n\n${snapshot}${nudge}` };
  });
  pi.on('agent_end', (event) => { if (!maintenanceTurn) failed = failedTools(event?.messages); });
}

/**
 * The orchestrator's "What you can use" section for a project generated before
 * it was build output. ./run passes .pi/CAPABILITIES.md once the project is
 * rebuilt; until then it is rendered from system.yaml at session start.
 */
function registerAgentContext(pi, root) {
  if (process.env.PI_SUBAGENT_CHILD === '1') return;
  let section = '';
  pi.on('session_start', () => {
    try {
      if (readText(root, '.pi/CAPABILITIES.md') !== null) { section = ''; return; }
      const model = parsedModel(readText(root, '.pi/system.yaml'));
      section = capabilitySection(model, model.orchestrator?.name);
    } catch { section = ''; }
  });
  pi.on('before_agent_start', (event) => (section ? { systemPrompt: `${event.systemPrompt}\n\n${section}` } : undefined));
}
