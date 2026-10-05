// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnswerBoundary, DocumentBoundary } from './render-boundary';

/**
 * A rendering failure costs the one answer it happened in, not the conversation.
 *
 * Rendered into a real DOM, because an error boundary only does anything when React is
 * rendering on the client, and the server renderer used elsewhere in these tests would
 * simply throw.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // React logs a caught render error; that log is the expected outcome here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function Throws(): ReactNode {
  throw new Error('the renderer could not cope with this input');
}

const render = (node: ReactNode) => act(() => root.render(node));

describe('the answer boundary', () => {
  it('shows the answer as plain text when formatting it throws', () => {
    render(
      createElement(
        AnswerBoundary,
        { text: 'Every release passes four checks.' },
        createElement(Throws),
      ),
    );

    expect(container.textContent).toContain('could not be formatted');
    expect(container.textContent).toContain('Every release passes four checks.');
    expect(container.querySelector('button')?.textContent).toContain('Try formatting it again');
  });

  it('keeps the answers around it on screen', () => {
    render(
      createElement(
        'div',
        null,
        createElement(
          AnswerBoundary,
          { key: 'a', text: 'first' },
          createElement('p', null, 'formatted first'),
        ),
        createElement(AnswerBoundary, { key: 'b', text: 'second, plain' }, createElement(Throws)),
        createElement(
          AnswerBoundary,
          { key: 'c', text: 'third' },
          createElement('p', null, 'formatted third'),
        ),
      ),
    );

    expect(container.textContent).toContain('formatted first');
    expect(container.textContent).toContain('second, plain');
    expect(container.textContent).toContain('formatted third');
  });

  it('renders its children untouched when nothing goes wrong', () => {
    render(
      createElement(AnswerBoundary, { text: 'unused' }, createElement('p', null, 'formatted')),
    );

    expect(container.textContent).toBe('formatted');
  });
});

describe('the document boundary', () => {
  it('names the document rather than an answer in its note', () => {
    render(createElement(DocumentBoundary, { text: '# Release gate' }, createElement(Throws)));

    expect(container.textContent).toContain('This document could not be formatted');
    expect(container.textContent).toContain('# Release gate');
  });
});
