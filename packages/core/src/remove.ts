import { parse } from './parse.js';
import { recompose } from './recompose.js';

/**
 * Remove a comment (and its highlight, for span comments) from an annotated
 * document. An edit mark referencing the removed identifier keeps its edit
 * and loses only the reference.
 */
export function removeComment(
  text: string,
  options: { id: string },
): { text: string; removed: boolean } {
  const parsed = parse(text);
  if (!parsed.comments.some((c) => c.id === options.id)) {
    return { text, removed: false };
  }
  const { text: out } = recompose({
    cleanText: parsed.cleanText,
    frontmatter: parsed.frontmatter,
    comments: parsed.comments.filter((c) => c.id !== options.id),
    editMarks: parsed.editMarks.map((m) =>
      m.commentId === options.id ? { ...m, commentId: null } : m,
    ),
  });
  return { text: out, removed: true };
}
