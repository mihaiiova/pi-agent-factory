/** Small schema-aware change layer. No filesystem or installation authority. */
import { loadYaml } from './yaml-loader.mjs';
import { validateSystem } from './validate.mjs';
import { migrate } from './migrate.mjs';
import { DEFAULT_SUBAGENT_TIERS } from '../../extensions/pi-config/generate-settings.mjs';

const collections = { agent: ['agents'], skill: ['skills'], mcp: ['integrations', 'mcp'], workflow: ['workflows'] };
const blocks = { orchestrator: ['orchestrator'], policies: ['policies'], models: ['models'], integrations: ['integrations'], packages: ['packages'] };
const safeName = (s) => typeof s === 'string' && /^[a-zA-Z0-9_-]+$/.test(s) && !['__proto__', 'constructor', 'prototype'].includes(s);
export function assertValid(model) {
  const result = validateSystem(model);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  if (model.skills?.some(s => s.name === 'factory-update')) throw new Error('factory-update is reserved maintenance infrastructure');
  return model;
}

/** Operations: add/update/remove named entities or tiers; assign model; set a
 * schema block; replace the entire model for uncommon edits. Validate the final
 * batch, allowing dependent references to be repaired in the same proposal.
 * YAML nodes not changed by the batch retain comments and presentation. */
export function changeModel(text, operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw new Error('Expected 1–100 structured operations');
  const yaml = loadYaml();
  let doc = yaml.parseDocument(text);
  if (doc.errors.length) throw new Error(doc.errors.map(e => e.message).join('\n'));
  if (doc.toJS()?.schema !== 1 && !operations.some(o => ['replace', 'migrate'].includes(o.op))) throw new Error('Preview an explicit migrate or replace operation first');
  const before = doc.toJS();
  const put = (path, value) => doc.setIn(path, doc.createNode(value));
  const route = (name, tier) => {
    if (!doc.hasIn(['models', 'subagents'])) {
      const current = doc.toJS();
      const defaults = Object.entries(DEFAULT_SUBAGENT_TIERS).filter(([, t]) => current.models?.tiers?.[t]);
      put(['models', 'subagents'], { ...Object.fromEntries(defaults), ...Object.fromEntries((current.agents ?? []).map(a => [a.name, a.model])) });
    }
    put(['models', 'subagents', name], tier);
  };
  for (const o of operations) {
    if (!o || typeof o !== 'object') throw new Error('Invalid operation');
    if (o.op === 'reconcile') {
      if (operations.length !== 1) throw new Error('Reconciliation must be a separate proposal');
      continue;
    }
    if (o.op === 'migrate') {
      doc = new yaml.Document(assertValid(migrate(doc.toJS())));
      continue;
    }
    if (o.op === 'replace') {
      doc = new yaml.Document(assertValid(o.model));
      continue;
    }
    if (o.op === 'set' && Object.hasOwn(blocks, o.target)) {
      put(blocks[o.target], o.value);
      continue;
    }
    if (o.op === 'assign' && safeName(o.name) && typeof o.tier === 'string') {
      const model = doc.toJS();
      if (o.name === model.orchestrator?.name) put(['orchestrator', 'model'], o.tier);
      else {
        const index = model.agents?.findIndex(a => a.name === o.name) ?? -1;
        if (index < 0) throw new Error(`Unknown agent ${o.name}`);
        put(['agents', index, 'model'], o.tier);
        // Routing override must not contradict the agent's declared assignment.
        route(o.name, o.tier);
      }
      continue;
    }
    if (!['add', 'update', 'remove'].includes(o.op) || !safeName(o.name)) throw new Error('Unknown operation or unsafe name');
    if (o.target === 'tier') {
      const path = ['models', 'tiers', o.name];
      const present = doc.hasIn(path);
      if ((o.op === 'add') === present) throw new Error(`Tier ${o.name}: ${present ? 'already exists' : 'not found'}`);
      if (o.op === 'remove') doc.deleteIn(path);
      else put(path, o.op === 'update' ? { ...doc.getIn(path)?.toJSON(), ...o.value } : o.value);
    } else if (Object.hasOwn(collections, o.target)) {
      const path = collections[o.target];
      const list = doc.toJS();
      const items = path.reduce((v, k) => v?.[k], list) ?? [];
      const index = items.findIndex(i => i.name === o.name);
      if ((o.op === 'add') === (index >= 0)) throw new Error(`${o.target} ${o.name}: ${index >= 0 ? 'already exists' : 'not found'}`);
      if (o.op === 'add') {
        if (!doc.hasIn(path)) put(path, []);
        doc.addIn(path, doc.createNode({ ...o.value, name: o.name }));
        if (o.target === 'agent') route(o.name, o.value?.model);
      } else if (o.op === 'remove') doc.deleteIn([...path, index]);
      else {
        if (!o.value || typeof o.value !== 'object' || Array.isArray(o.value)) throw new Error('update requires an object value');
        for (const [key, value] of Object.entries(o.value)) {
          if (key === 'name' && value !== o.name) throw new Error('Rename via a validated model replacement');
          put([...path, index, key], value);
        }
        if (o.target === 'agent' && o.value.model !== undefined) route(o.name, o.value.model);
      }
    } else throw new Error(`Unknown target ${o.target}`);
  }
  const model = assertValid(doc.toJS());
  // The existing validator permits conventional routing defaults for absent
  // specialists. Explicit deletion must still repair a now-stale override.
  const removed = new Set([...(before?.agents ?? []).map(a => a.name), ...operations.filter(o => o.op === 'remove' && o.target === 'agent').map(o => o.name)]);
  for (const name of removed) {
    if (!model.agents?.some(a => a.name === name) && model.models?.subagents?.[name]) throw new Error(`Remove models.subagents.${name} in the same batch`);
  }
  return { model, text: doc.toString() };
}
export function migratedModel(text) { return assertValid(migrate(loadYaml().parse(text))); }
