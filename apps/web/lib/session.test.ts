import { describe, expect, it } from 'vitest';
import { decideAccess } from './session';

/**
 * The authorisation rule on its own.
 *
 * Both the page guard and the API guard call this, so these cases describe what the
 * whole application allows. They are cheap to run because the rule takes a user rather
 * than reaching for the request, which is the reason it was pulled out of both callers.
 */
describe('decideAccess', () => {
  it('lets an admin into an admin only area', () => {
    expect(decideAccess({ role: 'admin' }, ['admin'])).toBe('allow');
  });

  it('lets either role into an area open to both', () => {
    expect(decideAccess({ role: 'user' }, ['admin', 'user'])).toBe('allow');
    expect(decideAccess({ role: 'admin' }, ['admin', 'user'])).toBe('allow');
  });

  it('turns away an ordinary user from an admin only area', () => {
    expect(decideAccess({ role: 'user' }, ['admin'])).toBe('wrong-role');
  });

  it.each([null, undefined])('treats %s as signed out', (subject) => {
    expect(decideAccess(subject, ['admin'])).toBe('signed-out');
  });

  it('turns away a suspended account before its role is considered', () => {
    // Otherwise a suspended admin would keep full access until the session expired.
    expect(decideAccess({ role: 'admin', banned: true }, ['admin'])).toBe('suspended');
  });

  it.each([
    ['a role that does not exist', 'superuser'],
    ['the right role in the wrong case', 'Admin'],
    ['an empty role', ''],
    ['no role at all', null],
  ])('refuses %s, because the column is text and can hold anything', (_label, role) => {
    expect(decideAccess({ role }, ['admin'])).toBe('wrong-role');
  });

  it('refuses everyone when no role is allowed', () => {
    expect(decideAccess({ role: 'admin' }, [])).toBe('wrong-role');
  });
});
