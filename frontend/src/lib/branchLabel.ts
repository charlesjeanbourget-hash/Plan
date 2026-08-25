import { Branch } from '@/types';

export const branchLabel = (b: Pick<Branch, 'name' | 'address'>): string =>
  (b.address ?? '').trim() ? `${b.name} — ${b.address}` : b.name;
