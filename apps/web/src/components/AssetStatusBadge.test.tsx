import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ASSET_STATUSES, AssetStatusBadge, assetStatusLabel } from './AssetStatusBadge';

describe('AssetStatusBadge', () => {
  it('renders a badge for every domain status', () => {
    for (const status of ASSET_STATUSES) {
      const { unmount } = render(<AssetStatusBadge status={status} />);
      expect(screen.getByText(assetStatusLabel(status))).toBeInTheDocument();
      unmount();
    }
  });

  it('maps all eight lifecycle statuses with distinct labels', () => {
    expect(ASSET_STATUSES).toHaveLength(8);
    const labels = ASSET_STATUSES.map((status) => assetStatusLabel(status));
    expect(new Set(labels).size).toBe(8);
  });
});
