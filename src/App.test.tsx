import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./protocol/client', () => ({
  DdvClient: class {
    url = 'ws://test/ws/client';
    status = 'closed';
    connect() {}
    close() {}
    onStatus() {
      return () => {};
    }
    onError() {
      return () => {};
    }
  },
}));

describe('App', () => {
  it('renders the shell with a connection indicator', () => {
    render(<App />);
    expect(screen.getByText('RubinTV DDV')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'connection closed');
  });
});
