import { Package } from 'lucide-react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(
      <MemoryRouter>
        <EmptyState icon={Package} title="No assets yet" description="Create your first asset." />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'No assets yet' })).toBeInTheDocument();
    expect(screen.getByText('Create your first asset.')).toBeInTheDocument();
  });

  it('renders a CTA link when actionHref is provided', () => {
    render(
      <MemoryRouter>
        <EmptyState
          icon={Package}
          title="No assets yet"
          description="Create your first asset."
          actionLabel="Add your first asset"
          actionHref="/assets/new"
        />
      </MemoryRouter>,
    );
    const cta = screen.getByRole('link', { name: 'Add your first asset' });
    expect(cta).toHaveAttribute('href', '/assets/new');
  });

  it('renders a CTA button wired to onAction when no href is given', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EmptyState
          icon={Package}
          title="No assets yet"
          description="Create your first asset."
          actionLabel="Add"
          onAction={onAction}
        />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders no CTA when neither action prop is provided', () => {
    render(
      <MemoryRouter>
        <EmptyState icon={Package} title="Nothing" description="Empty on purpose." />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
