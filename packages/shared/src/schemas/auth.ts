import { z } from 'zod';

/**
 * Validation shared by the sign-in form and the endpoint behind it.
 *
 * The form uses it so a typo is caught without a round trip, and the server uses it
 * because anything arriving over HTTP has to be checked regardless of what the form
 * did. Importing one schema in both places is what keeps those two checks from
 * drifting apart.
 */
export const signInSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Password is required'),
});

export type SignInInput = z.infer<typeof signInSchema>;

/**
 * The shortest password this project accepts.
 *
 * The same number is configured in Better Auth as `minPasswordLength`, which is what
 * enforces it on the sign-in and change-password endpoints. It is declared here because
 * three other places need to agree with it: the seed that creates the demo accounts, the
 * change-password form, and the test that checks a short password is refused. A form that
 * allowed eleven characters would send a request the server rejects with a message the
 * user cannot act on.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Changing your own password.
 *
 * The current password is required, so a session someone else has taken over cannot be
 * used to lock its owner out. That check happens on the server, where the stored hash is;
 * this schema only makes sure the field was sent.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`),
    confirmPassword: z.string().min(1, 'Repeat the new password'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two new passwords are different',
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    // Better Auth accepts this and reports success, which would be a change that
    // changed nothing while telling the user it worked.
    message: 'The new password is the same as the current one',
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** The roles this project ships with. Stored as text, so this is the list that is checked. */
export const roleSchema = z.enum(['admin', 'user']);
export type Role = z.infer<typeof roleSchema>;

/**
 * Creating an account, which only an administrator can do.
 *
 * There is no sign-up form, so without this the only way to add a colleague is to edit
 * the seed script and run it. The role is chosen here and fixed at creation: nothing in
 * the application lets an account change its own role, which is what keeps a regular user
 * from promoting themselves.
 */
export const createUserSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').pipe(z.email('Enter a valid email address')),
  name: z.string().trim().min(1, 'Name is required').max(80, 'Keep the name under 80 characters'),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`),
  role: roleSchema,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
