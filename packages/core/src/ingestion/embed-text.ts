export interface EmbeddableChunk {
  headingPath: string | null;
  content: string;
}

/**
 * Builds the text that actually gets embedded for a chunk.
 *
 * A chunk taken from the middle of a document can read as though it belongs to nothing
 * in particular. The title and the headings above it are the context a person would
 * have while reading, so they are put in front of the text before it is embedded. The
 * usual name for this is a contextual header, and it costs a handful of tokens.
 *
 * The heading is only prepended when the text does not already begin with it, which for
 * this collection is most of the time: every document here comes out as a single chunk
 * that starts with its own title, so adding the title again would only repeat it.
 */
export function buildEmbeddingText(title: string, chunk: EmbeddableChunk): string {
  const parts: string[] = [];
  const content = chunk.content.trim();

  const heading = chunk.headingPath ?? title;
  const alreadyPresent = content
    .slice(0, heading.length + 8)
    .includes(heading.split(' > ')[0] ?? '');

  if (!alreadyPresent) {
    parts.push(heading === title ? title : `${title} > ${chunk.headingPath}`);
  }

  parts.push(content);
  return parts.join('\n\n');
}
