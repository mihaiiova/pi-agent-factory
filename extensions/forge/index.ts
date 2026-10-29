/** Design command globally; trusted generated projects also load their runtime. */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Type } from 'typebox';
import { registerMaintenance } from '../../skills/forge/maintenance-extension.mjs';
import { registerAgent } from '../../skills/forge/agent-extension.mjs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function (pi: ExtensionAPI) {
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.isProjectTrusted() || !existsSync(join(ctx.cwd, '.pi/system.yaml'))) return;
    if (process.env.PI_SUBAGENT_CHILD === '1') registerAgent(pi, Type, ctx.cwd);
    else registerMaintenance(pi, Type, ctx.cwd);
  });
  pi.registerCommand('forge', {
    description: 'Create a standalone Pi agent system from an outcome',
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const skill = readFileSync(new URL('../../skills/forge/SKILL.md', import.meta.url), 'utf8');
      pi.sendUserMessage(`${skill}\n\nForge skill location: ${new URL('../../skills/forge/', import.meta.url).pathname}\n\nUser request: ${(args ?? '').trim() || '(none: continue from this conversation)'}`);
    },
  });
}
