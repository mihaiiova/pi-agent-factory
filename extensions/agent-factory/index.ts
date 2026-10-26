/** Global development-environment convenience alias; not bundled in agents. */
import { readFileSync } from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function (pi: ExtensionAPI) {
  pi.registerCommand('agent-factory', {
    description: 'Create a standalone Pi agent system from an outcome',
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const skill = readFileSync(new URL('../../skills/agent-factory/SKILL.md', import.meta.url), 'utf8');
      pi.sendUserMessage(`${skill}\n\nFactory skill location: ${new URL('../../skills/agent-factory/', import.meta.url).pathname}\n\nUser request: ${args}`);
    },
  });
}
