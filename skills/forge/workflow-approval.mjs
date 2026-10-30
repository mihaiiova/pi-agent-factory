import { writeFileSync } from 'node:fs';

/** Signal the enclosing workflow runner; ordinary headless Pi sessions are unchanged. */
export function blockWorkflowApproval(call) {
  const path = process.env.FORGE_APPROVAL_FILE;
  if (!path) return false;
  writeFileSync(path, `${call} needs approval`);
  return true;
}
