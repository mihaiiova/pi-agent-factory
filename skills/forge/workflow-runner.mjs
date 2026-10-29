/** Source of the standalone headless runner emitted into generated projects. */
export const workflowRunner = String.raw`#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const [encoded, ...args] = process.argv.slice(2);
const workflows = JSON.parse(Buffer.from(encoded, 'base64').toString());
const separator = args.indexOf('--');
const prompts = args.slice(0, separator);
const options = args.slice(separator + 1);
let name, inputs = [];
for (let i = 0; i < options.length; i++) {
  if (options[i] === '--workflow') name = options[++i];
  else if (options[i] === '--input') inputs.push(options[++i]);
}
const workflow = workflows.find(w => w.name === name);
const runId = randomUUID();
let answer = '';
if (!workflow) {
  console.log(JSON.stringify({ workflow: name, runId, status: 'configuration_error', answer, message: 'Unknown workflow' }));
  process.exit(2);
}
const prompt = (workflow.skill ? '/skill:' + workflow.skill + ' ' : '') +
  'Run workflow ' + workflow.name + '.' +
  (workflow.entry && workflow.entry !== workflow.lead ? ' Delegate to ' + workflow.entry + '.' : '') +
  '\nInputs (JSON): ' + JSON.stringify(inputs);
const child = spawn('pi', ['--approve', '--no-context-files', ...prompts, '--mode', 'json', '-p', prompt], {
  env: { ...process.env, FORGE_WORKFLOW: workflow.name, FORGE_TRIGGER: 'headless', FORGE_RUN_ID: runId },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let output = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => { output += chunk; });
child.on('error', error => { console.error(error.message); });
child.on('close', code => {
  for (const line of output.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        answer = (event.message.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      }
    } catch {}
  }
  const status = code === 0 ? 'ok' : 'error';
  console.log(JSON.stringify({ workflow: name, runId, status, answer }));
  process.exitCode = code === 0 ? 0 : 1;
});
`;
