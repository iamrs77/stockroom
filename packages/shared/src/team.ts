import type { z } from 'zod';
import { registerSchema, type Role } from './auth';

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  isYou: boolean;
};

export type PendingInvite = {
  id: string;
  role: Role;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
};

export type Team = {
  members: TeamMember[];
  invites: PendingInvite[];
};

export type InviteCreated = {
  invite: PendingInvite;
  /** The secret part of the invite link. Only returned once. */
  token: string;
};

/** What someone sees when they open an invite link, before signing up. */
export type InvitePreview = {
  businessName: string;
  role: Role;
  expiresAt: string;
};

export const acceptInviteSchema = registerSchema.pick({ name: true, email: true, password: true });
export type AcceptInviteInput = z.input<typeof acceptInviteSchema>;
