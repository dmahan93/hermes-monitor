import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewIssueModal } from '../../src/components/NewIssueModal';
import type { AgentPreset } from '../../src/types';

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', planningCommand: 'hermes chat', description: 'Hermes agent', installed: true },
  { id: 'custom', name: 'Custom', icon: '⚙', command: '', planningCommand: '', description: 'Custom command', installed: true },
];

const renderModal = (overrides: Partial<React.ComponentProps<typeof NewIssueModal>> = {}) => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <NewIssueModal
      agents={mockAgents}
      agentsLoading={false}
      agentsError={null}
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onSubmit, onClose, ...result };
};

describe('NewIssueModal', () => {
  it('renders the modal with title, description, agent, and branch fields', () => {
    renderModal();
    expect(screen.getByText('NEW ISSUE')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('What needs to be done?')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Details, context, acceptance criteria...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. fix/login-bug')).toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on other key presses', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when clicking the overlay', () => {
    const { onClose } = renderModal();
    const overlay = screen.getByText('NEW ISSUE').closest('.modal-overlay');
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the modal', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByPlaceholderText('What needs to be done?'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('auto-focuses the title input', () => {
    renderModal();
    const titleInput = screen.getByPlaceholderText('What needs to be done?');
    expect(document.activeElement).toBe(titleInput);
  });

  it('disables CREATE button when title is empty', () => {
    renderModal();
    const createBtn = screen.getByText('[CREATE]');
    expect(createBtn).toBeDisabled();
  });

  it('enables CREATE button when title is entered', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('What needs to be done?'), {
      target: { value: 'My issue' },
    });
    const createBtn = screen.getByText('[CREATE]');
    expect(createBtn).not.toBeDisabled();
  });

  it('calls onSubmit with form data when submitted', () => {
    const { onSubmit } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('What needs to be done?'), {
      target: { value: 'Fix the bug' },
    });
    fireEvent.change(screen.getByPlaceholderText('Details, context, acceptance criteria...'), {
      target: { value: 'Some details' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. fix/login-bug'), {
      target: { value: 'fix/my-branch' },
    });
    fireEvent.click(screen.getByText('[CREATE]'));
    expect(onSubmit).toHaveBeenCalledWith('Fix the bug', 'Some details', 'hermes', '', 'fix/my-branch', undefined);
  });

  it('calls onClose when CANCEL is clicked', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('[CANCEL]'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cleans up Escape key listener on unmount', () => {
    const { onClose, unmount } = renderModal();
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows loading placeholder and disables dropdown when agentsLoading is true', () => {
    renderModal({ agentsLoading: true, agents: [] });
    const selects = screen.getAllByRole('combobox');
    // The agent dropdown should be disabled
    const agentSelect = selects.find((s) => s.querySelector('option[value=""]')?.textContent === 'Loading agents...');
    expect(agentSelect).toBeTruthy();
    expect(agentSelect).toBeDisabled();
    expect(screen.getByText('Loading agents...')).toBeInTheDocument();
  });

  it('shows error message when agentsError is set', () => {
    renderModal({ agentsError: 'Network error', agents: [] });
    expect(screen.getByText(/Failed to load agents: Network error/)).toBeInTheDocument();
    // The agent select dropdown should not be present when there's an error
    // but the reviewer model select still is (it's independent)
    const selects = screen.queryAllByRole('combobox');
    const agentSelect = selects.find((s) => s.querySelector('option[value="hermes"]'));
    expect(agentSelect).toBeUndefined();
  });

  it('disables CREATE button when agentsLoading is true even if title is entered', () => {
    renderModal({ agentsLoading: true, agents: [] });
    fireEvent.change(screen.getByPlaceholderText('What needs to be done?'), {
      target: { value: 'My issue' },
    });
    const createBtn = screen.getByText('[CREATE]');
    expect(createBtn).toBeDisabled();
  });

  it('disables CREATE button when agentsError is set even if title is entered', () => {
    renderModal({ agentsError: 'Network error', agents: [] });
    fireEvent.change(screen.getByPlaceholderText('What needs to be done?'), {
      target: { value: 'My issue' },
    });
    const createBtn = screen.getByText('[CREATE]');
    expect(createBtn).toBeDisabled();
  });

  it('does not submit form when agents are loading', () => {
    const { onSubmit } = renderModal({ agentsLoading: true, agents: [] });
    fireEvent.change(screen.getByPlaceholderText('What needs to be done?'), {
      target: { value: 'My issue' },
    });
    fireEvent.click(screen.getByText('[CREATE]'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit form when agents have an error', () => {
    const { onSubmit } = renderModal({ agentsError: 'Connection refused', agents: [] });
    fireEvent.change(screen.getByPlaceholderText('What needs to be done?'), {
      target: { value: 'My issue' },
    });
    fireEvent.click(screen.getByText('[CREATE]'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows agent dropdown normally when not loading and no error', () => {
    renderModal({ agentsLoading: false, agentsError: null });
    const selects = screen.getAllByRole('combobox');
    // Find the agent select (has agent options like 'hermes')
    const agentSelect = selects.find((s) => s.querySelector('option[value="hermes"]'));
    expect(agentSelect).toBeTruthy();
    expect(agentSelect).not.toBeDisabled();
    expect(screen.queryByText('Loading agents...')).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed to load agents/)).not.toBeInTheDocument();
  });
});
