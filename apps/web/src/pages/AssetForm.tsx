import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
    .min(2, 'Enter a display name of at least 2 characters.')
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

interface CategoryOption {
  id: string;
  name: string;
}

interface LocationOption {
  id: string;
  name: string;
  path: string;
}

export function AssetForm() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { workspace } = useSelectedWorkspace();
  const workspaceId = workspace?.id;

  const [values, setValues] = useState(DEFAULT_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const canManage =
    workspace?.role === 'owner' || workspace?.role === 'admin' || workspace?.role === 'manager';

  const categoriesQuery = useQuery({
    queryKey: ['categories', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ categories: CategoryOption[] }>(`/workspaces/${workspaceId}/categories`),
  });
  const locationsQuery = useQuery({
    queryKey: ['locations', workspaceId],
    enabled: workspaceId !== undefined,
    queryFn: () => api.get<{ locations: LocationOption[] }>(`/workspaces/${workspaceId}/locations`),
  });

  const setField = <K extends keyof typeof values>(field: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    const parsed = assetFormSchema.safeParse(candidate);
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
    if (!workspaceId) {
      toast({
        title: 'No workspace selected',
        description: 'Pick a workspace in the top bar first.',
        variant: 'warning',
      });
      return;
    }

    setSubmitting(true);
    try {
      const created = await assetsApi.create(workspaceId, {
        assetTag: parsed.data.assetTag,
        displayName: parsed.data.displayName,
        serialNumber: parsed.data.serialNumber,
        categoryId: parsed.data.categoryId,
        locationId: parsed.data.locationId,
        status: parsed.data.status,
        condition: parsed.data.condition,
        purchasedAt: parsed.data.purchasedAt,
        amount: parsed.data.amount,
        currency: parsed.data.currency,
        notes: parsed.data.notes,
      });
      toast({
        title: 'Asset created',
        description: `${parsed.data.assetTag} is in your registry.`,
        variant: 'success',
      });
      navigate(`/assets/${created.id}`);
    } catch (error) {
      if (isApiError(error) && error.status === 409 && error.code === 'ASSET_TAG_EXISTS') {
        setFieldErrors({ assetTag: 'This tag is already used in this workspace.' });
        toast({
          title: 'Tag already in use',
          description: 'Tags are unique per workspace.',
          variant: 'warning',
        });
      } else if (isApiError(error)) {
        toast({ title: 'Could not save asset', description: error.detail, variant: 'warning' });
      } else {
        toast({ title: 'Could not save asset', description: 'Please try again.', variant: 'warning' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const inputHint = (id: string, text: string) => (
    <p id={id} className="text-xs leading-5 text-muted-foreground">
      {text}
    </p>
  );

  return (
    <div className="flex flex-col">
      <Link
        to="/assets"
        className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to assets
      </Link>

      <PageHeader
        title="New asset"
        description="Tag the asset, capture its serial exactly as shown on the label, and file it into a category and location if you have them."
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Asset details</CardTitle>
          <CardDescription>
            Saved straight to your registry. Tags are unique per workspace; serials are stored exactly as
            entered.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canManage && (
            <p
              role="status"
              className="mb-4 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-foreground"
            >
              Your role can view assets but not create them. Ask a manager, admin or owner.
            </p>
          )}
          <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
                value={values.categoryId}
                onChange={(event) => setField('categoryId', event.target.value)}
              >
                <option value="">No category</option>
                {(categoriesQuery.data?.categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="asset-location">Location</Label>
              <Select
                id="asset-location"
                name="locationId"
                value={values.locationId}
                onChange={(event) => setField('locationId', event.target.value)}
              >
                <option value="">No location</option>
                {(locationsQuery.data?.locations ?? []).map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </div>

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
                aria-describedby={fieldErrors.purchasedAt !== undefined ? 'asset-purchased-error' : undefined}
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
              <div className="flex gap-2">
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
                <Input
                  id="asset-currency"
                  name="currency"
                  aria-label="Currency"
                  className="w-24 uppercase"
                  maxLength={3}
                  spellCheck={false}
                  aria-invalid={fieldErrors.currency !== undefined}
                  value={values.currency}
                  onChange={(event) => setField('currency', event.target.value)}
                  placeholder="INR"
                />
              </div>
              {fieldErrors.amount !== undefined && (
                <p id="asset-amount-error" className="text-sm leading-5 text-danger">
                  {fieldErrors.amount}
                </p>
              )}
              {fieldErrors.currency !== undefined && (
                <p className="text-sm leading-5 text-danger">{fieldErrors.currency}</p>
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
                to="/assets"
                className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Cancel
              </Link>
              <Button type="submit" disabled={submitting || !canManage}>
                {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                Create asset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
