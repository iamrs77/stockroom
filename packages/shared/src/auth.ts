import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Enter a valid email address'));

export const registerSchema = z.object({
  businessName: z.string().trim().min(1, 'Enter your business name').max(100),
  name: z.string().trim().min(1, 'Enter your name').max(100),
  email: emailSchema,
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});

export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;

export type Role = 'owner' | 'staff';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenant: {
    id: string;
    name: string;
    /** Set for a demo sandbox: when it will be deleted. */
    demoExpiresAt: string | null;
  };
};

/** What the sign-in page needs to know before anyone signs in. */
export type PublicConfig = {
  signupsEnabled: boolean;
  demoEnabled: boolean;
  /** Most rows an import may have, for real businesses and for demo sandboxes. */
  importMaxRows: number;
  demoImportMaxRows: number;
  /** How long a demo sandbox lasts. */
  demoHours: number;
};
