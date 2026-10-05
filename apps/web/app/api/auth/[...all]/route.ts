import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

// Sign-in, sign-out and session reads all hang off this one route.
export const { GET, POST } = toNextJsHandler(auth);
