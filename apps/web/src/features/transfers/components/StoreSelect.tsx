import type { Store } from '@stockroom/shared';
import type { SelectHTMLAttributes } from 'react';
import { Select } from '@/components/ui';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  stores: Store[] | undefined;
  onChange: (storeId: string) => void;
};

/** A dropdown of the business's stores, shown as "Name (CODE)". */
export function StoreSelect({ stores, onChange, ...props }: Props) {
  return (
    <Select {...props} onChange={(e) => onChange(e.target.value)}>
      {stores?.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.code})
        </option>
      ))}
    </Select>
  );
}
