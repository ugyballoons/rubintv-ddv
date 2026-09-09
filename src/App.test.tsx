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
  it('renders the toolbar with a disabled instrument selector while disconnected', () => {
    render(<App />);
    expect(screen.getByText('RubinTV DDV')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'connection closed');
    expect(screen.getByLabelText('Instrument')).toBeDisabled();
    expect(screen.getByText(/Select an instrument/)).toBeInTheDocument();
  });
});
