import { useMe } from './auth-api';

/** True for owners. Staff don't see actions the API would refuse them. */
export function useIsOwner() {
  return useMe().data?.role === 'owner';
}
