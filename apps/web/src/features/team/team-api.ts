import type { AcceptInviteInput, InviteCreated, InvitePreview, Role, SessionUser, Team } from '@stockroom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { queryKeys } from '@/api/query-keys';

/** The business's members and its pending invites. */
export function useTeam() {
  return useQuery({ queryKey: queryKeys.team, queryFn: () => api<Team>('/team') });
}

export function useCreateInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (role: Role) => api<InviteCreated>('/team/invites', { method: 'POST', body: { role } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.team }),
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/team/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.team }),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/team/members/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.team }),
  });
}

/** Which business an invite link is for, and the role it gives. Fails if the link is used or expired. */
export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: queryKeys.invites.preview(token),
    queryFn: () => api<InvitePreview>(`/invites/${token}`),
    retry: false,
  });
}

export function useAcceptInvite(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AcceptInviteInput) => api<{ user: SessionUser }>(`/invites/${token}/accept`, { method: 'POST', body: input }),
    onSuccess: ({ user }) => {
      // A different person is now signed in: drop cached data, but keep this invite's preview,
      // which would otherwise refetch and find the invite already used.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.invites.all[0] });
      queryClient.setQueryData(queryKeys.me, user);
    },
  });
}
