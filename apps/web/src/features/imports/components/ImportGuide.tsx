import { Download } from 'lucide-react';
import { Card } from '@/components/ui';

/** "How it works": the spreadsheet format in short, and a template with the business's store codes. */
export function ImportGuide() {
  return (
    <Card className="p-5 text-sm lg:col-span-2">
      <h2 className="mb-3 font-semibold">How it works</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-muted">
        <li>
          One row per product. <span className="font-mono text-ink">sku</span> is required; other columns are optional.
        </li>
        <li>Rows with a new SKU create a product, so they need a name and a price.</li>
        <li>An empty cell leaves that value as it is.</li>
        <li>
          <span className="font-mono text-ink">stock:QSW</span> columns are counted quantities for each store. The
          difference is recorded in each product&rsquo;s history.
        </li>
        <li>Rows with a problem are skipped and listed in a report. The rest are still imported.</li>
      </ul>
      <a
        href="/api/imports/template.csv"
        className="mt-4 inline-flex items-center gap-2 font-medium text-accent hover:underline"
      >
        <Download className="size-4" aria-hidden />
        Download a template with your store codes
      </a>
    </Card>
  );
}
