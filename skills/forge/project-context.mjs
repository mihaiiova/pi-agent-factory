/** Orchestrator context is opt-in; edit is implicit only with a non-empty list. */
export function orchestratorTools(orchestrator) {
  if (!Array.isArray(orchestrator?.tools)) return undefined;
  const tools = [...orchestrator.tools];
  if (Array.isArray(orchestrator.projectContext) && orchestrator.projectContext.length && !tools.includes('edit')) tools.push('edit');
  return tools;
}

/** Portable project-relative file path without traversal or control characters. */
export function validContextPath(path) {
  return typeof path === 'string' && path.length > 0 && path !== '--' && !path.startsWith('/') && !path.startsWith('~') && !/^[A-Za-z]:/.test(path) && !/[\\\x00-\x1f\x7f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
}
