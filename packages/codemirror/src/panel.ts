import { cleanToRaw, cpSlice, cpToUtf16, parse } from '@galley/core';

export interface PanelItem {
  id: string | null;
  scope: string;
  body: string;
  snippet: string;
  /** Raw UTF-16 range to select on jump, or null without source ranges. */
  jump: { from: number; to: number } | null;
}

/** Build the DOM-independent comments-panel model. */
export function buildPanelModel(text: string): {
  items: PanelItem[];
  errorCount: number;
} {
  const parsed = parse(text);
  const items: PanelItem[] = [];
  for (const comment of parsed.comments) {
    if (comment.carrier) continue;
    let snippet: string;
    if (comment.scope === 'document') {
      snippet = 'whole document';
    } else if (comment.scope === 'point') {
      const from = Math.max(0, comment.anchor.start - 20);
      snippet = `…${cpSlice(parsed.cleanText, from, comment.anchor.start)}▸`;
    } else {
      const anchorText = cpSlice(
        parsed.cleanText,
        comment.anchor.start,
        comment.anchor.end,
      );
      const cps = [...anchorText];
      snippet = cps.length > 60 ? `${cps.slice(0, 60).join('')}…` : anchorText;
    }
    let jump: PanelItem['jump'] = null;
    if (comment.source) {
      if (comment.scope === 'span' && comment.source.anchorRaw) {
        jump = {
          from: comment.source.anchorRaw.start,
          to: comment.source.anchorRaw.end,
        };
      } else if (comment.scope === 'point') {
        const raw = cleanToRaw(
          parsed.sourceMap,
          cpToUtf16(parsed.cleanText, comment.anchor.start),
        );
        jump = { from: raw, to: raw };
      } else {
        jump = {
          from: comment.source.extent.start,
          to: comment.source.extent.end,
        };
      }
    }
    items.push({
      id: comment.id,
      scope: comment.scope,
      body: comment.body,
      snippet,
      jump,
    });
  }
  return {
    items,
    errorCount: parsed.issues.filter((issue) => issue.severity === 'error').length,
  };
}
