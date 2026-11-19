import type { AppConfig } from '@assetnest/config';
import type { MailMessage } from './email.js';

export interface OutboxEventLike {
  id: string;
  workspaceId: string;
  kind: string;
  aggregateId: string;
  payloadJson: Record<string, unknown>;
}

function str(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Text-only templates by design — no HTML, so no escaping bugs and no
 * tracking pixels. A deep link into the app is included when configured.
 * Reminder producers (warranty/maintenance, Phase 2+/6) reuse this map.
 */
export function renderOutboxEvent(event: OutboxEventLike, config: AppConfig): MailMessage {
  const deepLink = `${config.PUBLIC_APP_URL}/assets/${event.aggregateId}`;
  const assetTag = str(event.payloadJson, 'assetTag') ?? str(event.payloadJson, 'tag');

  switch (event.kind) {
    case 'asset.created':
      return {
        to: '',
        subject: `Asset created${assetTag ? `: ${assetTag}` : ''}`,
        text: `A new asset was added to your workspace.\n\nAsset: ${assetTag ?? event.aggregateId}\n${deepLink}\n`,
      };
    case 'asset.assigned':
      return {
        to: '',
        subject: `Asset assigned${assetTag ? `: ${assetTag}` : ''}`,
        text: `An asset was assigned to a workspace member.\n\nAsset: ${assetTag ?? event.aggregateId}\n${deepLink}\n`,
      };
    case 'asset.returned':
      return {
        to: '',
        subject: `Asset returned${assetTag ? `: ${assetTag}` : ''}`,
        text: `An asset was returned to the pool.\n\nAsset: ${assetTag ?? event.aggregateId}\n${deepLink}\n`,
      };
    case 'asset.transferred':
      return {
        to: '',
        subject: `Asset transferred${assetTag ? `: ${assetTag}` : ''}`,
        text: `An asset moved to a new location.\n\nAsset: ${assetTag ?? event.aggregateId}\n${deepLink}\n`,
      };
    case 'asset.status_changed': {
      const from = str(event.payloadJson, 'from');
      const to = str(event.payloadJson, 'to');
      return {
        to: '',
        subject: `Asset status changed${assetTag ? `: ${assetTag}` : ''}`,
        text: `An asset changed status${from && to ? ` from ${from} to ${to}` : ''}.\n\nAsset: ${assetTag ?? event.aggregateId}\n${deepLink}\n`,
      };
    }
    case 'asset.archived':
      return {
        to: '',
        subject: `Asset archived${assetTag ? `: ${assetTag}` : ''}`,
        text: `An asset was archived. History is retained.\n\nAsset: ${assetTag ?? event.aggregateId}\n${deepLink}\n`,
      };
    default:
      return {
        to: '',
        subject: `AssetNest: ${event.kind}`,
        text: `Workspace event ${event.kind}.\n\nResource: ${event.aggregateId}\n${deepLink}\n`,
      };
  }
}
