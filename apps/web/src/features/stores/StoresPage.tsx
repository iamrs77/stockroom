import { PageHeader } from '@/components/ui';
import { useIsOwner } from '@/features/auth/useIsOwner';
import { NewStoreForm } from './components/NewStoreForm';
import { StoreList } from './components/StoreList';

export function StoresPage() {
  const isOwner = useIsOwner();
  return (
    <>
      <PageHeader title="Stores" description="Each store keeps its own stock of every product." />
      <div className="grid gap-6 lg:grid-cols-5">
        <StoreList />
        {isOwner && <NewStoreForm />}
      </div>
    </>
  );
}
