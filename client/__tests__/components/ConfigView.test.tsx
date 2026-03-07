import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigView } from '../../src/components/ConfigView';

describe('ConfigView', () => {
  it('renders the configuration heading', () => {
    render(<ConfigView />);
    expect(screen.getByText('CONFIGURATION')).toBeInTheDocument();
  });

  it('renders the About section', () => {
    render(<ConfigView />);
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('renders the Links section', () => {
    render(<ConfigView />);
    expect(screen.getByText('Links')).toBeInTheDocument();
  });

  it('renders GitHub link with correct href', () => {
    render(<ConfigView />);
    const link = screen.getByText(/GitHub Repository/);
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://github.com/dmahan93/hermes-monitor');
  });

  it('opens GitHub link in new tab', () => {
    render(<ConfigView />);
    const link = screen.getByText(/GitHub Repository/);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
