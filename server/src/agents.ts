// Re-export shared type so existing server imports continue to work.
export type { AgentPreset } from '@hermes-monitor/shared/types';
import type { AgentPreset } from '@hermes-monitor/shared/types';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'templates');

/** Load a command template from the templates/ directory. */
export function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, name), 'utf-8').trim();
}

/** Replace {{var}} placeholders in a template string. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'hermes',
    name: 'Hermes',
    icon: '⚗',
    command: loadTemplate('hermes-agent.txt'),
    planningCommand: loadTemplate('hermes-planning.txt'),
    description: 'Nous Research agent — autonomous task execution',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    icon: '◈',
    command: loadTemplate('claude-agent.txt'),
    planningCommand: 'claude',
    description: 'Anthropic coding agent — builds and refactors code',
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: '⬡',
    command: loadTemplate('codex-agent.txt'),
    planningCommand: 'codex',
    description: 'OpenAI Codex CLI — code generation and editing',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    icon: '✦',
    command: loadTemplate('gemini-agent.txt'),
    planningCommand: 'gemini',
    description: 'Google Gemini CLI — multimodal AI agent',
  },
  {
    id: 'aider',
    name: 'Aider',
    icon: '⊕',
    command: loadTemplate('aider-agent.txt'),
    planningCommand: 'aider',
    description: 'AI pair programming in your terminal',
  },
  {
    id: 'shell',
    name: 'Shell',
    icon: '▸',
    command: '',
    planningCommand: '',
    description: 'Plain bash — manual agent start',
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙',
    command: '',
    planningCommand: '',
    description: 'Enter your own command template',
  },
];

export function getPreset(id: string): AgentPreset | undefined {
  return AGENT_PRESETS.find((p) => p.id === id);
}
