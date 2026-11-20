import type {
  AssetDetail,
  AssetHistory,
  AssetListQuery,
  AssetPage,
  CreateAssetRequest,
} from '@assetnest/sdk';
import { api } from './api';

function encodeId(id: string | undefined): string {
  if (!id || id === '.' || id === '..') throw new TypeError('Invalid AssetNest resource ID');
  return encodeURIComponent(id);
}

const collectionPath = (workspaceId: string | undefined) => `/workspaces/${encodeId(workspaceId)}/assets`;
const assetPath = (workspaceId: string | undefined, assetId: string | undefined) =>
  `${collectionPath(workspaceId)}/${encodeId(assetId)}`;

export const assetsApi = {
  list(workspaceId: string | undefined, query: AssetListQuery) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) search.set(key, String(value));
    }
    return api.get<AssetPage>(`${collectionPath(workspaceId)}?${search}`);
  },
  get: (workspaceId: string | undefined, assetId: string | undefined) =>
    api.get<AssetDetail>(assetPath(workspaceId, assetId)),
  history: (workspaceId: string | undefined, assetId: string | undefined) =>
    api.get<AssetHistory>(`${assetPath(workspaceId, assetId)}/history`),
  create: (workspaceId: string, body: CreateAssetRequest) =>
    api.post<AssetDetail>(collectionPath(workspaceId), body),
  archive: (workspaceId: string | undefined, assetId: string | undefined) =>
    api.post<AssetDetail>(`${assetPath(workspaceId, assetId)}/archive`),
};
