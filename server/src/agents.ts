export interface AgentPreset {
  id: string;
  name: string;
  icon: string;
  command: string;     // template with {{var}} placeholders
  description: string;
  installed?: boolean; // populated at runtime
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'hermes',
    name: 'Hermes',
    icon: '⚗',
    command: "hermes chat -q '{{title}}. {{description}}'",
    description: 'Nous Research agent — autonomous task execution',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    icon: '◈',
    command: "claude '{{title}}. {{description}}'",
    description: 'Anthropic coding agent — builds and refactors code',
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: '⬡',
    command: "codex '{{title}}. {{description}}'",
    description: 'OpenAI Codex CLI — code generation and editing',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    icon: '✦',
    command: "gemini '{{title}}. {{description}}'",
    description: 'Google Gemini CLI — multimodal AI agent',
  },
  {
    id: 'aider',
    name: 'Aider',
    icon: '⊕',
    command: "aider --message '{{title}}. {{description}}'",
    description: 'AI pair programming in your terminal',
  },
  {
    id: 'shell',
    name: 'Shell',
    icon: '▸',
    command: '',
    description: 'Plain bash — manual agent start',
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙',
    command: '',
    description: 'Enter your own command template',
  },
];

export function getPreset(id: string): AgentPreset | undefined {
  return AGENT_PRESETS.find((p) => p.id === id);
}
