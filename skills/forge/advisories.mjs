/** Non-blocking configuration observations; text matches are only heuristics. */
import { cliEntries, cliAgents, commandShape, readerFileWarning } from './cli-tools.mjs';
import { enforcedAgentTools } from './policy.mjs';

export function configurationAdvisories(model) {
  const out = [];
  const commands = cliEntries(model);
  const effective = a => enforcedAgentTools(a.name, model.policies, a.tools);
  const seen = new Map();
  for (const c of commands) {
    if (!cliAgents(model, c.name, effective).length) out.push(`Command ${c.name} is not available to any agent (it may be intentionally predeclared).`);
    const key = commandShape(c);
    if (seen.has(key)) out.push(`Commands ${seen.get(key)} and ${c.name} have equivalent shapes modulo placeholder names.`);
    else seen.set(key, c.name);
    const warning = readerFileWarning(c);
    if (warning) out.push(`Command ${c.name}: ${warning}`);
  }
  const lead = model.orchestrator;
  if (Array.isArray(lead?.projectContext) && lead.projectContext.length) {
    out.push('Project context is sent to the model and may contain untrusted instructions or credentials. It also enables edit for any accessible file, not only the listed files.');
  }
  if (lead && Array.isArray(lead.tools)) {
    const tools = lead.tools;
    const canRead = tools.includes('read') || tools.includes('bash') || commands.some(c => tools.includes(`cli:${c.name}`) && ['cat', 'head', 'less', 'sed', 'awk'].includes(c.command.split('/').pop()));
    const prompt = lead.prompt ?? '';
    const docs = (model.documents ?? []).filter(d => d.writer === lead.name && d.path);
    if (!canRead && (/\b(read|inspect|open)\b[^\n.]{0,80}\b(files?|reports?|receipts?|paths?)\b|\b(receipts?)\b/i.test(prompt) || docs.length))
      out.push(`Orchestrator ${lead.name} may need to read files${docs.length ? ` (document paths: ${docs.map(d => d.path).join(', ')})` : ''}, but has no read, bash, or recognizable CLI reader; check its instructions and capabilities.`);
  }
  return out;
}
