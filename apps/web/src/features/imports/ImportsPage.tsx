import { Card, PageHeader } from '@/components/ui';
import { useIsOwner } from '@/features/auth/useIsOwner';
import { ImportGuide } from './components/ImportGuide';
import { ImportUploadCard } from './components/ImportUploadCard';
import { RecentImports } from './components/RecentImports';

export function ImportsPage() {
  const isOwner = useIsOwner();
  return (
    <>
      <PageHeader
        title="Imports"
        description="Add or update many products and stock counts at once from a spreadsheet."
      />
      <div className="mb-8 grid gap-6 lg:grid-cols-5">
        {isOwner ? (
          <ImportUploadCard />
        ) : (
          <Card className="p-5 text-sm text-muted lg:col-span-3">Only owners can run imports. Here you can follow imports and their results.</Card>
        )}
        <ImportGuide />
      </div>
      <RecentImports />
    </>
  );
}
