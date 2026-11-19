import type { ProductCreateInput, ProductDetail } from '@stockroom/shared';
import { useState, type FormEvent } from 'react';
import { getFormErrors } from '@/api/form-errors';
import { Alert, Button, Field, Input } from '@/components/ui';
import { parseMoney } from '@/lib/parse-money';

type Props = {
  /** The product being edited; leave out to create a new one. */
  initial?: ProductDetail;
  submitLabel: string;
  pending: boolean;
  error: Error | null;
  onSubmit: (input: ProductCreateInput) => void;
  onCancel: () => void;
};

/** The product fields, used both to create a product and to edit one. */
export function ProductForm({ initial, submitLabel, pending, error, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState({
    sku: initial?.sku ?? '',
    name: initial?.name ?? '',
    category: initial?.category ?? '',
    price: initial ? (initial.priceCents / 100).toFixed(2) : '',
    reorderPoint: String(initial?.reorderPoint ?? 0),
  });
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { fieldErrors, formError } = getFormErrors(error);
  const errors = { ...fieldErrors, ...localErrors };
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  function submit(event: FormEvent) {
    event.preventDefault();
    const priceCents = parseMoney(form.price);
    const reorderPoint = Number(form.reorderPoint);
    const problems: Record<string, string> = {};
    if (Number.isNaN(priceCents)) problems.priceCents = 'Enter a price like 12.50';
    if (!Number.isInteger(reorderPoint) || reorderPoint < 0) problems.reorderPoint = 'Enter a whole number, 0 or more';
    setLocalErrors(problems);
    if (Object.keys(problems).length) return;
    onSubmit({ sku: form.sku, name: form.name, category: form.category || null, priceCents, reorderPoint });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      {formError && (
        <div className="sm:col-span-2">
          <Alert>{formError}</Alert>
        </div>
      )}
      <Field label="Name" error={errors.name} className="sm:col-span-2">
        {(p) => <Input {...p} value={form.name} onChange={set('name')} />}
      </Field>
      <Field label="SKU" error={errors.sku}>
        {(p) => <Input {...p} value={form.sku} onChange={set('sku')} className="font-mono" />}
      </Field>
      <Field label="Category" error={errors.category} hint="Optional">
        {(p) => <Input {...p} value={form.category} onChange={set('category')} />}
      </Field>
      <Field label="Price (CAD)" error={errors.priceCents}>
        {(p) => <Input {...p} inputMode="decimal" placeholder="0.00" value={form.price} onChange={set('price')} />}
      </Field>
      <Field label="Reorder point" error={errors.reorderPoint} hint="Flag as low stock at or below this total. 0 turns it off.">
        {(p) => <Input {...p} inputMode="numeric" value={form.reorderPoint} onChange={set('reorderPoint')} />}
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
