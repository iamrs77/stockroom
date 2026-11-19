import { Boxes } from 'lucide-react';

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-md bg-accent text-accent-ink">
        <Boxes className="size-4" aria-hidden />
      </span>
      Stockroom
    </span>
  );
}
