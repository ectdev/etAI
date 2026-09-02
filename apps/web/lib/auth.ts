import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { getDb, schema } from '@etai/db';
import { MIN_PASSWORD_LENGTH, roleSchema, type Role } from '@etai/shared';
import { getEnv } from '@etai/shared/env';

const env = getEnv();

export type { Role };

/**
 * `role` is stored as text rather than a database enum so that more roles can be
 * added later without a migration. That means the column can hold anything, so it is
 * narrowed here before it is trusted.
 */
export function isRole(value: unknown): value is Role {
  return roleSchema.safeParse(value).success;
}

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema,
  }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  emailAndPassword: {
    enabled: true,
    // Declared in @etai/shared so the change-password form refuses the same lengths
    // this does. A form with its own number sends requests the server rejects.
    minPasswordLength: MIN_PASSWORD_LENGTH,
    // There is no mail server in this project, so a verification step would lock
    // every account out. Accounts are created by the seed script or by an admin.
    requireEmailVerification: false,
  },

  // Sign-up is closed. Handing out an account is an administrative act here, which
  // also means the public surface of the app has no way to create one.
  signUp: {
    enabled: false,
  },

  user: {
    additionalFields: {
      /**
       * `input: false` matters. Without it the role would be writable through the
       * sign-up and update endpoints, which would let a user hand themselves the
       * admin role with a crafted request.
       */
      role: {
        type: 'string',
        required: false,
        defaultValue: 'user',
        input: false,
      },

      /**
       * Declared so that a suspended account can be rejected while reading the
       * session, without a second query. The column is also what the admin plugin
       * will use when user management arrives.
       */
      banned: {
        type: 'boolean',
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },

  advanced: {
    useSecureCookies: env.NODE_ENV === 'production',
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
    },
  },

  /**
   * Rate limiting is aimed at the endpoint that can be attacked rather than at the
   * whole auth path.
   *
   * A single limit across everything looked stricter but was worse in both
   * directions. It throttled session reads, which happen on ordinary page loads, so
   * a user browsing normally could be turned away. And it spent that budget on
   * harmless traffic, which is exactly what an attacker guessing passwords would
   * rather it did.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
    },
  },

  // Keeps the session cookie in step with Next.js server actions.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
