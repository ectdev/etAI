import { MEASURED_FIGURES, MEASURED_QUESTIONS } from '@/lib/measured';

/**
 * What sits below the example answer: how a question is answered, what was measured,
 * what is refused, and what it is built with.
 *
 * Every sentence describes something the code does, and the figures come from the one
 * document that owns them (see `measured.ts`). A landing page is where a project is most
 * tempted to describe the system it would like to be, and this one has already been
 * caught doing that once.
 */

const REPOSITORY = 'https://github.com/ectdev/etAI';

const STEPS = [
  {
    name: 'Index',
    text: 'Each document is split at its own headings and embedded once. A rerun embeds only what changed, and every vector records which model made it.',
    detail: 'pgvector, HNSW, 1536 dimensions',
  },
  {
    name: 'Retrieve',
    text: 'Meaning and keywords are searched side by side and fused by rank, then reordered by what is known about each document: a version that was replaced moves down.',
    detail: 'cosine and full text, fused by RRF',
  },
  {
    name: 'Answer',
    text: 'A model writes from the retrieved passages alone, cites each claim, and says what is missing when they do not cover the question.',
    detail: 'structured output, four kinds of coverage',
  },
  {
    name: 'Check',
    text: 'Every citation must name a document that was retrieved and every quote must appear in it. Anything else is dropped before the answer is sent, and counted.',
    detail: 'a gate the model cannot talk past',
  },
];

const REFUSALS = [
  {
    title: 'Untrusted text stays text',
    text: 'Answers and source documents are rendered from Markdown with raw HTML escaped, images dropped and links shown rather than followed, because both come from text nobody here controls.',
  },
  {
    title: 'A strict page policy',
    text: 'Every page is served under a Content Security Policy with a fresh nonce for each request. No inline code runs, and nothing can frame it.',
  },
  {
    title: 'Roles decided on the server',
    text: 'Every handler checks the role itself. A field meant for administrators is left out of the response rather than hidden in the browser.',
  },
];

const STACK = [
  'Next.js 16',
  'React 19',
  'PostgreSQL 17',
  'pgvector',
  'Drizzle ORM',
  'Better Auth',
  'Vercel AI SDK',
  'Gemini',
  'Model Context Protocol',
  'Vitest',
];

export function LandingSections() {
  return (
    <>
      <section className="et-landing-section" aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="et-landing-section-title">
          How a question is answered
        </h2>
        <ol className="et-landing-steps">
          {STEPS.map((step, index) => (
            <li key={step.name} className="et-landing-step">
              <span className="et-landing-step-number">{index + 1}</span>
              <h3 className="et-landing-step-name">{step.name}</h3>
              <p className="et-landing-step-text">{step.text}</p>
              <p className="et-landing-step-detail et-mono">{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="et-landing-section" aria-labelledby="measured">
        <h2 id="measured" className="et-landing-section-title">
          Measured, not claimed
        </h2>
        <dl className="et-landing-figures">
          {MEASURED_FIGURES.map((figure) => (
            <div key={figure.label} className="et-landing-figure">
              <dt className="et-landing-figure-label">{figure.label}</dt>
              <dd className="et-landing-figure-value">{figure.value}</dd>
            </div>
          ))}
        </dl>
        <p className="et-landing-footnote text-muted">
          {MEASURED_QUESTIONS} questions written for this collection, including the ones it should
          refuse.{' '}
          <a
            className="et-landing-link"
            href={`${REPOSITORY}/blob/main/docs/evaluation.md`}
            rel="noopener noreferrer"
          >
            How they were measured
          </a>
          .
        </p>
      </section>

      <section className="et-landing-section" aria-labelledby="refused">
        <h2 id="refused" className="et-landing-section-title">
          Built for text it cannot trust
        </h2>
        <ul className="et-landing-refusals">
          {REFUSALS.map((item) => (
            <li key={item.title} className="et-landing-refusal">
              <h3 className="et-landing-refusal-title">{item.title}</h3>
              <p className="et-landing-refusal-text">{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="et-landing-section" aria-labelledby="stack">
        <h2 id="stack" className="et-landing-section-title">
          Built with
        </h2>
        <ul className="et-landing-stack">
          {STACK.map((name) => (
            <li key={name} className="tag tag-outline">
              {name}
            </li>
          ))}
        </ul>
      </section>

      <footer className="et-landing-footer text-muted">
        <span>etAI, MIT licence.</span>
        <span>
          The sample documents describe Halcyon, a company that does not exist.{' '}
          <a className="et-landing-link" href={REPOSITORY} rel="noopener noreferrer">
            Source on GitHub
          </a>
        </span>
      </footer>
    </>
  );
}
