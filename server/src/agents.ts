// Re-export shared type so existing server imports continue to work.
export type { AgentPreset } from '@hermes-monitor/shared/types';
import type { AgentPreset } from '@hermes-monitor/shared/types';

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'hermes',
    name: 'Hermes',
    icon: '⚗',
    command: "hermes chat -q 'You are an autonomous coding agent. If a summarization step occurs, always continue working afterward — do not treat it as a stopping point. First run: curl -s http://localhost:4000/agent/{{id}}/info to get your task details, worktree path, branch, and any previous review feedback. You should already be in your git worktree — verify with `git branch --show-current` that you are on the correct branch. If not, cd into the worktree directory from the /info response. Complete the task fully — write code, make changes, run tests, git add and git commit your work. When you are completely done, run: curl -s -X POST http://localhost:4000/agent/{{id}}/review to submit for review. Do not stop until you have committed your changes and submitted for review.'",
    planningCommand: "hermes chat -q 'You are helping plan a task: \"{{title}}\". Description: {{description}}. Help the user explore approaches, research the problem, prototype ideas, and flesh out implementation details. This is a planning session — focus on understanding requirements, exploring the codebase, and preparing a clear plan.'",
    description: 'Nous Research agent — autonomous task execution',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    icon: '◈',
    command: "claude 'You are an autonomous coding agent. If a summarization step occurs, always continue working afterward — do not treat it as a stopping point. First run: curl -s http://localhost:4000/agent/{{id}}/info to get your task details, worktree path, branch, and any previous review feedback. You should already be in your git worktree — verify with `git branch --show-current` that you are on the correct branch. If not, cd into the worktree directory from the /info response. Complete the task fully — write code, make changes, run tests, git add and git commit your work. When you are completely done, run: curl -s -X POST http://localhost:4000/agent/{{id}}/review to submit for review. Do not stop until you have committed your changes and submitted for review.'",
    planningCommand: 'claude',
    description: 'Anthropic coding agent — builds and refactors code',
  },
  {
    id: 'codex',
    name: 'Codex',
    icon: '⬡',
    command: "codex 'You are an autonomous coding agent. If a summarization step occurs, always continue working afterward. First run: curl -s http://localhost:4000/agent/{{id}}/info to get task details, worktree path, branch, and any previous review feedback. You should already be in your git worktree — verify with `git branch --show-current` that you are on the correct branch. If not, cd into the worktree directory from the /info response. Complete the task, git commit, then: curl -s -X POST http://localhost:4000/agent/{{id}}/review'",
    planningCommand: 'codex',
    description: 'OpenAI Codex CLI — code generation and editing',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    icon: '✦',
    command: "gemini 'You are an autonomous coding agent. If a summarization step occurs, always continue working afterward. First run: curl -s http://localhost:4000/agent/{{id}}/info to get task details, worktree path, branch, and any previous review feedback. You should already be in your git worktree — verify with `git branch --show-current` that you are on the correct branch. If not, cd into the worktree directory from the /info response. Complete the task, git commit, then: curl -s -X POST http://localhost:4000/agent/{{id}}/review'",
    planningCommand: 'gemini',
    description: 'Google Gemini CLI — multimodal AI agent',
  },
  {
    id: 'aider',
    name: 'Aider',
    icon: '⊕',
    command: "aider --message '{{title}}. {{description}}'",
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
