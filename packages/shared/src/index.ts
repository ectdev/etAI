/**
 * The entry point that is safe to import from anywhere, including the browser.
 *
 * Server-only configuration lives behind `@etai/shared/env` instead. That split
 * exists because the validation schemas here are imported by client components, and
 * a single shared entry point would drag the environment loader, and with it Node's
 * filesystem module, into the browser bundle.
 */
export { HNSW_MAX_DIMENSIONS, VECTOR_DIMENSIONS, RELEVANCE_DISTANCE_LIMIT } from './constants.js';
export { UpstreamServiceError, callUpstream } from './errors.js';
export {
  classifySmallTalk,
  smallTalkReply,
  SMALL_TALK_REPLIES,
  type SmallTalk,
} from './small-talk.js';
export {
  signInSchema,
  roleSchema,
  changePasswordSchema,
  createUserSchema,
  MIN_PASSWORD_LENGTH,
  type SignInInput,
  type Role,
  type ChangePasswordInput,
  type CreateUserInput,
} from './schemas/auth.js';
export {
  coverageSchema,
  isAnswered,
  citationSchema,
  linkedCitationSchema,
  CITATION_MARKER,
  splitOnCitationMarkers,
  citationMarkers,
  removeCitationMarkers,
  quoteAppearsIn,
  normaliseForQuote,
  coherenceRuleSchema,
  coherenceViolationSchema,
  type CitationSegment,
  type CoherenceRule,
  type CoherenceViolation,
  groundedAnswerSchema,
  answerSourceSchema,
  answerResponseSchema,
  askSchema,
  searchInputSchema,
  documentPathSchema,
  type Coverage,
  type Citation,
  type LinkedCitation,
  type GroundedAnswer,
  type AnswerSource,
  type AnswerResponse,
  type AskInput,
  type SearchInput,
  type DocumentPathInput,
} from './schemas/answer.js';
