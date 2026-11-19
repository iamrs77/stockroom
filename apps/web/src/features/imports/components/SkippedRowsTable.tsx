import type { ImportRowError } from '@stockroom/shared';

/** Each skipped row: its row number in the file, SKU, the column at fault and what was wrong. */
export function SkippedRowsTable({ errors }: { errors: ImportRowError[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-line bg-surface-2 text-left text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Row</th>
            <th scope="col" className="px-4 py-2 font-medium">SKU</th>
            <th scope="col" className="px-4 py-2 font-medium">Column</th>
            <th scope="col" className="px-4 py-2 font-medium">Problem</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {errors.map((e, i) => (
            <tr key={`${e.rowNumber}-${i}`}>
              <td className="px-4 py-2.5 tabular-nums">{e.rowNumber}</td>
              <td className="px-4 py-2.5 font-mono text-xs">{e.sku ?? '—'}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-muted">{e.column ?? '—'}</td>
              <td className="px-4 py-2.5">{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
