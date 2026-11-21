import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssetDetail, CreateAssetRequest, OperationResult, UpdateAssetRequest } from '@assetnest/sdk';
import { z } from 'zod';
import { ASSET_STATUSES, assetStatusLabel, type AssetStatus } from '../components/AssetStatusBadge';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Select, Textarea } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useToast } from '../components/ui/toast';
import { api, isApiError } from '../lib/api';
import { useSelectedWorkspace } from '../lib/use-selected-workspace';
import { assetsApi } from '../lib/assets-api';
import { purchaseCurrencies } from '../lib/purchase-currency';

export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged', 'unknown'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

const CONDITION_LABELS: Record<AssetCondition, string> = {
  new: 'New',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  damaged: 'Damaged',
  unknown: 'Unknown',
};

// Creation targets: assets enter the registry available; other states are reached via the lifecycle API.
const CREATION_STATUSES = ['available', 'in_repair', 'lost'] as const satisfies ReadonlyArray<AssetStatus>;

const ASSET_TAG_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,63}$/;

const assetFormSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Enter a display name.')
    .max(200, 'Display names are limited to 200 characters.'),
  assetTag: z
    .string()
    .trim()
    .min(1, 'Enter an asset tag.')
    .max(64, 'Asset tags are limited to 64 characters.')
    .refine(
      (value) => ASSET_TAG_PATTERN.test(value.toUpperCase()),
      'Use uppercase letters, digits and hyphens, starting with a letter or digit (e.g. TAG-0007).',
    ),
  serialNumber: z.string().trim().max(120, 'Serial numbers are limited to 120 characters.').optional(),
  categoryId: z.string().optional(),
  locationId: z.string().optional(),
  status: z.enum(ASSET_STATUSES),
  condition: z.enum(ASSET_CONDITIONS),
  purchasedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  amount: z
    .string()
    .regex(/^\d{1,16}(\.\d{1,2})?$/, 'Digits with at most 2 decimals.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'ISO 4217, e.g. INR, USD, EUR.')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  notes: z.string().trim().max(5000, 'Notes are limited to 5000 characters.').optional(),
});

const createAssetFormSchema = assetFormSchema.extend({
  displayName: assetFormSchema.shape.displayName.min(2, 'Enter a display name of at least 2 characters.'),
});

type AssetFormField =
  | 'displayName'
  | 'assetTag'
  | 'serialNumber'
  | 'categoryId'
  | 'locationId'
  | 'status'
  | 'condition'
  | 'purchasedAt'
  | 'amount'
  | 'currency'
  | 'notes';
type FieldErrors = Partial<Record<AssetFormField, string>>;

const DEFAULT_VALUES = {
  displayName: '',
  assetTag: '',
  serialNumber: '',
  categoryId: '',
  locationId: '',
  status: 'available' as AssetStatus,
  condition: 'good' as AssetCondition,
  purchasedAt: '',
  amount: '',
  currency: '',
  notes: '',
};

type FormValues = typeof DEFAULT_VALUES;

function valuesFromAsset(asset: AssetDetail): FormValues {
  return {
    displayName: asset.displayName,
    assetTag: asset.assetTag,
    serialNumber: asset.serialNumber ?? '',
    categoryId: asset.categoryId ?? '',
    locationId: asset.locationId ?? '',
    status: asset.status,
    condition: asset.condition,
    purchasedAt: asset.purchasedAt ?? '',
    amount: asset.amount ?? '',
    currency: asset.currency ?? '',
    notes: asset.notes ?? '',
  };
}

function assetChanges(
  values: FormValues,
  before: FormValues,
  validated: CreateAssetRequest,
): Omit<UpdateAssetRequest, 'expectedVersion'> {
  return {
    assetTag: values.assetTag !== before.assetTag ? validated.assetTag : undefined,
    displayName: values.displayName !== before.displayName ? validated.displayName : undefined,
    serialNumber: values.serialNumber !== before.serialNumber ? (validated.serialNumber ?? null) : undefined,
    categoryId: values.categoryId !== before.categoryId ? (validated.categoryId ?? null) : undefined,
    locationId: values.locationId !== before.locationId ? (validated.locationId ?? null) : undefined,
    condition: values.condition !== before.condition ? validated.condition : undefined,
    purchasedAt: values.purchasedAt !== before.purchasedAt ? (validated.purchasedAt ?? null) : undefined,
    amount: values.amount !== before.amount ? (validated.amount ?? null) : undefined,
    currency: values.currency !== before.currency ? (validated.currency ?? null) : undefined,
    notes: values.notes !== before.notes ? (validated.notes ?? null) : undefined,
  };
}

export function AssetForm() {
  const { assetId } = useParams<{ assetId: string }>();
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;
  const canManage =
    workspace?.role === 'owner' || workspace?.role === 'admin' || workspace?.role === 'manager';
  const assetQuery = useQuery({
    queryKey: ['asset', workspaceId, assetId],
    enabled: canManage && workspaceId !== undefined && assetId !== undefined,
    queryFn: () => assetsApi.get(workspaceId, assetId),
  });

  if (!workspaceId || !canManage) {
    return (
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{workspaceId ? 'Asset write access required' : 'Select a workspace'}</CardTitle>
          <CardDescription>
            {workspaceId
              ? 'Ask a manager, admin or owner for help with this asset.'
              : 'Choose a workspace before adding or editing assets.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link className="text-accent hover:underline" to="/assets">
            Back to assets
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (assetId && !assetQuery.data) {
    return (
      <div className="space-y-3">
        <Link className="text-accent hover:underline" to="/assets">
          Back to assets
        </Link>
        <p role={assetQuery.isError ? 'alert' : 'status'}>
          {assetQuery.isError ? 'Could not load the asset in this workspace.' : 'Loading asset…'}
        </p>
        {assetQuery.isError && (
          <Button variant="outline" onClick={() => void assetQuery.refetch()}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <AssetEditor
      key={`${workspaceId}:${assetId ?? 'new'}`}
      workspaceId={workspaceId}
      asset={assetQuery.data}
    />
  );
}

function AssetEditor({ workspaceId, asset }: { workspaceId: string; asset: AssetDetail | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [baseline, setBaseline] = useState(() =>
    asset ? { version: asset.version, values: valuesFromAsset(asset) } : undefined,
  );
  const [values, setValues] = useState(() => baseline?.values ?? DEFAULT_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<'detected' | 'loaded'>();
  const backPath = asset ? `/assets/${asset.id}` : '/assets';
  const savedCurrency = baseline?.values.currency;
  const legacyCurrency =
    savedCurrency && !purchaseCurrencies.some(({ code }) => code === savedCurrency)
      ? savedCurrency
      : undefined;

  const categoriesQuery = useQuery({
    queryKey: ['categories', workspaceId],
    queryFn: () => api.get<OperationResult<'listCategories'>>(`/workspaces/${workspaceId}/categories`),
  });
  const locationsQuery = useQuery({
    queryKey: ['locations', workspaceId],
    queryFn: () => api.get<OperationResult<'listLocations'>>(`/workspaces/${workspaceId}/locations`),
  });

  const save = useMutation({
    mutationFn: (
      request: { create: CreateAssetRequest } | { assetId: string; update: UpdateAssetRequest },
    ) =>
      'update' in request
        ? assetsApi.update(workspaceId, request.assetId, request.update)
        : assetsApi.create(workspaceId, request.create),
    onSuccess: (savedAsset) => {
      queryClient.setQueryData(['asset', workspaceId, savedAsset.id], savedAsset);
      void queryClient.invalidateQueries({ queryKey: ['asset', workspaceId, savedAsset.id] });
      void queryClient.invalidateQueries({ queryKey: ['asset-history', workspaceId, savedAsset.id] });
      void queryClient.invalidateQueries({ queryKey: ['assets', workspaceId] });
    },
  });

  const refresh = useMutation({
    mutationFn: (assetId: string) => assetsApi.get(workspaceId, assetId),
  });

  const loadLatest = () => {
    if (!asset || !baseline) return;
    refresh.mutate(asset.id, {
      onSuccess: (latest) => {
        const updatedValues = valuesFromAsset(latest);
        setValues((draft) => {
          const merged = { ...updatedValues };
          for (const field of Object.keys(draft) as AssetFormField[]) {
            if (field !== 'status' && draft[field] !== baseline.values[field]) {
              Object.assign(merged, { [field]: draft[field] });
            }
          }
          return merged;
        });
        setBaseline({ version: latest.version, values: updatedValues });
        setConflict('loaded');
      },
    });
  };

  const setField = <K extends keyof typeof values>(field: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (save.isPending || refresh.isPending || conflict === 'detected') return;
    if (
      baseline &&
      Object.keys(values).every(
        (field) => values[field as AssetFormField] === baseline.values[field as AssetFormField],
      )
    ) {
      navigate(backPath);
      return;
    }
    setFieldErrors({});

    const candidate = {
      ...values,
      assetTag: values.assetTag.toUpperCase(),
      serialNumber: values.serialNumber.trim() === '' ? undefined : values.serialNumber,
      categoryId: values.categoryId === '' ? undefined : values.categoryId,
      locationId: values.locationId === '' ? undefined : values.locationId,
      purchasedAt: values.purchasedAt === '' ? undefined : values.purchasedAt,
      amount: values.amount === '' ? undefined : values.amount,
      currency: values.currency === '' ? undefined : values.currency.toUpperCase(),
      notes: values.notes.trim() === '' ? undefined : values.notes,
    };
    const parsed = (asset ? assetFormSchema : createAssetFormSchema).safeParse(candidate);
    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && nextErrors[field as AssetFormField] === undefined) {
          nextErrors[field as AssetFormField] = issue.message;
        }
      }
      setFieldErrors(nextErrors);
      return;
    }
    save.mutate(
      asset && baseline
        ? {
            assetId: asset.id,
            update: {
              ...assetChanges(values, baseline.values, parsed.data),
              expectedVersion: baseline.version,
            },
          }
        : { create: parsed.data },
      {
        onSuccess: (savedAsset) => {
          toast({
            title: asset ? 'Asset updated' : 'Asset created',
            description: asset
              ? undefined
              : `${savedAsset.assetTag ?? parsed.data.assetTag} is in your registry.`,
            variant: 'success',
          });
          navigate(`/assets/${savedAsset.id}`);
        },
        onError: (error) => {
          if (isApiError(error) && error.status === 409) {
            if (error.code === 'ASSET_TAG_EXISTS') {
              setFieldErrors({ assetTag: 'This tag is already used in this workspace.' });
              return;
            }
            if (error.code === 'ASSET_VERSION_CONFLICT') {
              setConflict('detected');
              return;
            }
          }
          toast({
            title: 'Could not save asset',
            description: isApiError(error) ? error.detail : 'Please try again.',
            variant: 'warning',
          });
        },
      },
    );
  };

  const inputHint = (id: string, text: string) => (
    <p id={id} className="text-xs leading-5 text-muted-foreground">
      {text}
    </p>
  );

  return (
    <div className="flex flex-col">
      <Link
        to={backPath}
        className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        {asset ? 'Back to asset' : 'Back to assets'}
      </Link>

      <PageHeader
        title={asset ? 'Edit asset' : 'New asset'}
        description={asset?.assetTag ?? 'Give the asset a name and a unique tag.'}
      />

      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          {conflict && (
            <div className="mb-4 space-y-2 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground">
              <p role={conflict === 'detected' ? 'alert' : 'status'}>
                {conflict === 'detected'
                  ? 'This asset changed while you were editing. Load the latest values before you save.'
                  : 'Latest values loaded. Review your edits before saving. Your edits will replace any changes to the same fields.'}
              </p>
              {conflict === 'detected' && (
                <Button type="button" variant="outline" disabled={refresh.isPending} onClick={loadLatest}>
                  {refresh.isPending ? 'Loading latest values…' : 'Load latest and keep my edits'}
                </Button>
              )}
              {refresh.isError && <p role="alert">Could not load the latest asset. Try again.</p>}
            </div>
          )}
          <form onSubmit={onSubmit} noValidate aria-busy={save.isPending || refresh.isPending}>
            <fieldset
              disabled={save.isPending || refresh.isPending}
              className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2"
            >
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="asset-display-name">Display name *</Label>
                <Input
                  id="asset-display-name"
                  name="displayName"
                  required
                  autoFocus
                  aria-invalid={fieldErrors.displayName !== undefined}
                  aria-describedby={
                    fieldErrors.displayName !== undefined ? 'asset-display-name-error' : undefined
                  }
                  value={values.displayName}
                  onChange={(event) => setField('displayName', event.target.value)}
                  placeholder="e.g. Dell docking station, kitchen fridge"
                />
                {fieldErrors.displayName !== undefined && (
                  <p id="asset-display-name-error" className="text-sm leading-5 text-danger">
                    {fieldErrors.displayName}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="asset-tag">Asset tag *</Label>
                <Input
                  id="asset-tag"
                  name="assetTag"
                  required
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={fieldErrors.assetTag !== undefined}
                  aria-describedby={fieldErrors.assetTag !== undefined ? 'asset-tag-error' : 'asset-tag-hint'}
                  value={values.assetTag}
                  onChange={(event) => setField('assetTag', event.target.value)}
                  placeholder="TAG-0007"
                />
                {inputHint('asset-tag-hint', 'Unique per workspace. Uppercase letters, digits and hyphens.')}
                {fieldErrors.assetTag !== undefined && (
                  <p id="asset-tag-error" className="text-sm leading-5 text-danger">
                    {fieldErrors.assetTag}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="serial-number">Serial number</Label>
                <Input
                  id="serial-number"
                  name="serialNumber"
                  spellCheck={false}
                  autoCapitalize="none"
                  aria-invalid={fieldErrors.serialNumber !== undefined}
                  aria-describedby={
                    fieldErrors.serialNumber !== undefined ? 'serial-number-error' : 'serial-number-hint'
                  }
                  value={values.serialNumber}
                  onChange={(event) => setField('serialNumber', event.target.value)}
                  placeholder="e.g. 0042-XK-9917"
                />
                {inputHint('serial-number-hint', 'Stored exactly as entered — leading zeros are kept.')}
                {fieldErrors.serialNumber !== undefined && (
                  <p id="serial-number-error" className="text-sm leading-5 text-danger">
                    {fieldErrors.serialNumber}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="asset-category">Category</Label>
                <Select
                  id="asset-category"
                  name="categoryId"
                  disabled={!categoriesQuery.data}
                  aria-describedby={categoriesQuery.isError ? 'asset-category-error' : undefined}
                  value={values.categoryId}
                  onChange={(event) => setField('categoryId', event.target.value)}
                >
                  <option value="">No category</option>
                  {values.categoryId &&
                    !categoriesQuery.data?.categories.some(({ id }) => id === values.categoryId) && (
                      <option value={values.categoryId}>Current category</option>
                    )}
                  {(categoriesQuery.data?.categories ?? []).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
                {categoriesQuery.isError && (
                  <p id="asset-category-error" className="text-sm text-danger">
                    Could not load categories.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="asset-location">Location</Label>
                <Select
                  id="asset-location"
                  name="locationId"
                  disabled={!locationsQuery.data}
                  aria-describedby={locationsQuery.isError ? 'asset-location-error' : undefined}
                  value={values.locationId}
                  onChange={(event) => setField('locationId', event.target.value)}
                >
                  <option value="">No location</option>
                  {values.locationId &&
                    !locationsQuery.data?.locations.some(({ id }) => id === values.locationId) && (
                      <option value={values.locationId}>Current location</option>
                    )}
                  {(locationsQuery.data?.locations ?? []).map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
                {locationsQuery.isError && (
                  <p id="asset-location-error" className="text-sm text-danger">
                    Could not load locations.
                  </p>
                )}
              </div>

              {!asset && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="asset-status">Status</Label>
                  <Select
                    id="asset-status"
                    name="status"
                    value={values.status}
                    onChange={(event) => setField('status', event.target.value as AssetStatus)}
                  >
                    {CREATION_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {assetStatusLabel(status)}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="asset-condition">Condition</Label>
                <Select
                  id="asset-condition"
                  name="condition"
                  value={values.condition}
                  onChange={(event) => setField('condition', event.target.value as AssetCondition)}
                >
                  {ASSET_CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {CONDITION_LABELS[condition]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="asset-purchased">Purchase date</Label>
                <Input
                  id="asset-purchased"
                  name="purchasedAt"
                  type="date"
                  aria-invalid={fieldErrors.purchasedAt !== undefined}
                  aria-describedby={
                    fieldErrors.purchasedAt !== undefined ? 'asset-purchased-error' : undefined
                  }
                  value={values.purchasedAt}
                  onChange={(event) => setField('purchasedAt', event.target.value)}
                />
                {fieldErrors.purchasedAt !== undefined && (
                  <p id="asset-purchased-error" className="text-sm leading-5 text-danger">
                    {fieldErrors.purchasedAt}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="asset-amount">Purchase amount</Label>
                <Input
                  id="asset-amount"
                  name="amount"
                  inputMode="decimal"
                  spellCheck={false}
                  aria-invalid={fieldErrors.amount !== undefined}
                  aria-describedby={fieldErrors.amount !== undefined ? 'asset-amount-error' : undefined}
                  value={values.amount}
                  onChange={(event) => setField('amount', event.target.value)}
                  placeholder="62999.00"
                />
                {fieldErrors.amount !== undefined && (
                  <p id="asset-amount-error" className="text-sm leading-5 text-danger">
                    {fieldErrors.amount}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="asset-currency">Purchase currency</Label>
                <Select
                  id="asset-currency"
                  name="currency"
                  aria-invalid={fieldErrors.currency !== undefined}
                  aria-describedby={fieldErrors.currency ? 'asset-currency-error' : undefined}
                  value={values.currency}
                  onChange={(event) => setField('currency', event.target.value)}
                >
                  <option value="">No currency specified</option>
                  {legacyCurrency && (
                    <option value={legacyCurrency}>{legacyCurrency} (saved currency)</option>
                  )}
                  {purchaseCurrencies.map(({ code, label }) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </Select>
                {fieldErrors.currency !== undefined && (
                  <p id="asset-currency-error" className="text-sm leading-5 text-danger">
                    {fieldErrors.currency}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="asset-notes">Notes</Label>
                <Textarea
                  id="asset-notes"
                  name="notes"
                  rows={3}
                  maxLength={5000}
                  value={values.notes}
                  onChange={(event) => setField('notes', event.target.value)}
                  placeholder="Purchase context, quirks, anything worth remembering…"
                />
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:col-span-2 sm:flex-row sm:items-center sm:justify-end">
                <Link
                  to={backPath}
                  className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Cancel
                </Link>
                <Button
                  type="submit"
                  disabled={save.isPending || refresh.isPending || conflict === 'detected'}
                >
                  {save.isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                  {asset ? 'Save changes' : 'Create asset'}
                </Button>
              </div>
            </fieldset>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
