import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { ASSET_STATUSES, assetStatusLabel, type AssetStatus } from '../components/AssetStatusBadge';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Select, Textarea } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useToast } from '../components/ui/toast';

export const ASSET_CONDITIONS = ['new', 'excellent', 'good', 'fair', 'poor', 'damaged'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

const CONDITION_LABELS: Record<AssetCondition, string> = {
  new: 'New',
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  damaged: 'Damaged',
};

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
  serialNumber: z.string().trim().max(100, 'Serial numbers are limited to 100 characters.').optional(),
  status: z.enum(ASSET_STATUSES),
  condition: z.enum(ASSET_CONDITIONS),
  notes: z.string().trim().max(2000, 'Notes are limited to 2000 characters.').optional(),
});

type AssetFormField = 'displayName' | 'assetTag' | 'serialNumber' | 'status' | 'condition' | 'notes';
type FieldErrors = Partial<Record<AssetFormField, string>>;

const DEFAULT_VALUES = {
  displayName: '',
  assetTag: '',
  serialNumber: '',
  status: 'available' as AssetStatus,
  condition: 'good' as AssetCondition,
  notes: '',
};

export function AssetForm() {
  const { toast } = useToast();
  const [values, setValues] = useState(DEFAULT_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const setField = <K extends keyof typeof values>(field: K, value: (typeof values)[K]) => {
    setValues((current) => Object.assign({}, current, { [field]: value }));
    setFieldErrors((current) => Object.assign({}, current, { [field]: undefined }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const candidate = {
      ...values,
      serialNumber: values.serialNumber.trim() === '' ? undefined : values.serialNumber,
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
    setFieldErrors({});
    setSubmitting(true);

    // No persistence is claimed: the API ships in Phase 1. Warn, toast, reset.
    console.warn('AssetForm: submitted draft not persisted — API pending (Phase 1)', {
      displayName: parsed.data.displayName,
      assetTag: parsed.data.assetTag.toUpperCase(),
      status: parsed.data.status,
    });
    toast({
      title: 'Saved draft locally — API pending (Phase 1)',
      description: 'Nothing was sent or stored. The registry arrives with the API.',
      variant: 'warning',
    });
    setValues(DEFAULT_VALUES);
    setSubmitting(false);
  };

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
        description="Tag the asset, capture its serial exactly as shown on the label, and set its starting lifecycle state."
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Asset details</CardTitle>
          <CardDescription>
            Fields validated inline. Drafts are not stored until the API ships (Phase 1).
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              <p id="asset-tag-hint" className="text-xs leading-5 text-muted-foreground">
                Unique per workspace. Uppercase letters, digits and hyphens; preserved exactly, including
                leading zeros (e.g. TAG-0007).
              </p>
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
              <p id="serial-number-hint" className="text-xs leading-5 text-muted-foreground">
                Stored exactly as entered — leading zeros and capitalization are kept verbatim.
              </p>
              {fieldErrors.serialNumber !== undefined && (
                <p id="serial-number-error" className="text-sm leading-5 text-danger">
                  {fieldErrors.serialNumber}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="asset-status">Status</Label>
              <Select
                id="asset-status"
                name="status"
                value={values.status}
                onChange={(event) => setField('status', event.target.value as AssetStatus)}
              >
                {ASSET_STATUSES.map((status) => (
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

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="asset-notes">Notes</Label>
              <Textarea
                id="asset-notes"
                name="notes"
                rows={4}
                aria-invalid={fieldErrors.notes !== undefined}
                aria-describedby={fieldErrors.notes !== undefined ? 'asset-notes-error' : undefined}
                value={values.notes}
                onChange={(event) => setField('notes', event.target.value)}
                placeholder="Purchase context, quirks, anything worth remembering…"
              />
              {fieldErrors.notes !== undefined && (
                <p id="asset-notes-error" className="text-sm leading-5 text-danger">
                  {fieldErrors.notes}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:col-span-2 sm:flex-row sm:items-center sm:justify-end">
              <Link
                to="/assets"
                className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Cancel
              </Link>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                Save asset
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
