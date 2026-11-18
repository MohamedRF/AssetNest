import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui/toast';
import { AssetForm } from './AssetForm';

function renderForm() {
  return render(
    <MemoryRouter initialEntries={['/assets/new']}>
      <ToastProvider>
        <AssetForm />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('AssetForm', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('shows an inline error when the asset tag is invalid', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), 'Docking station');
    await user.type(screen.getByLabelText(/asset tag/i), 'bad tag!');
    await user.click(screen.getByRole('button', { name: /save asset/i }));

    expect(screen.getByText(/use uppercase letters/i)).toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/saved draft locally/i)).not.toBeInTheDocument();
  });

  it('shows an inline error when the display name is too short', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), 'A');
    await user.type(screen.getByLabelText(/asset tag/i), 'TAG-0007');
    await user.click(screen.getByRole('button', { name: /save asset/i }));

    expect(screen.getByText(/at least 2 characters/i)).toBeInTheDocument();
  });

  it('shows a toast (not a fake save) when the form is valid', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/display name/i), 'Label printer');
    await user.type(screen.getByLabelText(/asset tag/i), 'tag-0042');
    await user.type(screen.getByLabelText(/serial number/i), '0042-XK-9917');
    await user.click(screen.getByRole('button', { name: /save asset/i }));

    expect(await screen.findByText(/saved draft locally/i)).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('API pending (Phase 1)'),
      expect.objectContaining({ assetTag: 'TAG-0042' }),
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('marks invalid fields with aria-invalid for assistive technology', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole('button', { name: /save asset/i }));

    expect(screen.getByLabelText(/display name/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/asset tag/i)).toHaveAttribute('aria-invalid', 'true');
  });
});
