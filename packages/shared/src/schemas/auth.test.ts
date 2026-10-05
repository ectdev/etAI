import { describe, expect, it } from 'vitest';
import { roleSchema, signInSchema } from './auth.js';

describe('signInSchema', () => {
  it('accepts a normal credential pair', () => {
    const result = signInSchema.safeParse({
      email: 'admin@etai.local',
      password: 'demo-admin-password',
    });

    expect(result.success).toBe(true);
  });

  it('trims surrounding whitespace, which is what a paste usually brings with it', () => {
    const result = signInSchema.safeParse({
      email: '  admin@etai.local  ',
      password: 'demo-admin-password',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('admin@etai.local');
    }
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['no at sign', 'adminetai.local'],
    ['no domain', 'admin@'],
  ])('rejects an email that is %s', (_label, email) => {
    expect(signInSchema.safeParse({ email, password: 'demo-admin-password' }).success).toBe(false);
  });

  it('rejects a missing password without silently treating it as empty', () => {
    expect(signInSchema.safeParse({ email: 'admin@etai.local' }).success).toBe(false);
    expect(signInSchema.safeParse({ email: 'admin@etai.local', password: '' }).success).toBe(false);
  });

  it('does not enforce a password shape, because that belongs where passwords are set', () => {
    // The sign-in form should not reject an old password for failing a newer rule.
    // Length requirements live in the auth configuration, on the way in.
    expect(signInSchema.safeParse({ email: 'admin@etai.local', password: 'a' }).success).toBe(true);
  });

  it('ignores fields that were not asked for, so a crafted body cannot smuggle a role', () => {
    const result = signInSchema.safeParse({
      email: 'user@etai.local',
      password: 'demo-user-password',
      role: 'admin',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('role');
    }
  });
});

describe('roleSchema', () => {
  it('accepts the two roles the application ships with', () => {
    expect(roleSchema.safeParse('admin').success).toBe(true);
    expect(roleSchema.safeParse('user').success).toBe(true);
  });

  it.each(['superuser', 'ADMIN', 'Admin', '', 'admin ', null, undefined, 42])(
    'rejects %o, since the column is text and can hold anything',
    (value) => {
      expect(roleSchema.safeParse(value).success).toBe(false);
    },
  );
});
