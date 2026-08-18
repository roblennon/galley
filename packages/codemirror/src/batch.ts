import type { ApplyReport, PatchBatch } from '@galley/core';

export function extractBatchJson(
  input: string,
): { ok: true; batch: PatchBatch } | { ok: false; error: string } {
  let text = input.trim();
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  if (fence) text = fence[1]!.trim();
  if (!text.startsWith('{')) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first < 0 || last <= first) {
      return { ok: false, error: 'no JSON object found' };
    }
    text = text.slice(first, last + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: `input is not valid JSON: ${error instanceof Error ? error.message : error}`,
    };
  }
  const batch = parsed as PatchBatch;
  if (typeof batch !== 'object' || batch === null) {
    return { ok: false, error: 'batch must be a JSON object' };
  }
  if (!Array.isArray(batch.responses) || !Array.isArray(batch.patches)) {
    return {
      ok: false,
      error: 'batch needs "responses" and "patches" arrays (SPEC §8.1)',
    };
  }
  return { ok: true, batch };
}

export interface ReportSummary {
  headline: string;
  sections: { title: string; lines: string[] }[];
}

export function summarizeReport(report: ApplyReport): ReportSummary {
  const sections: ReportSummary['sections'] = [];
  if (report.resolved.length > 0) {
    sections.push({
      title: `Resolved (${report.resolved.length})`,
      lines: report.resolved.map((item) => `[${item.id}] ${item.body}`),
    });
  }
  if (report.rejected.length > 0) {
    sections.push({
      title: `Rejected patches (${report.rejected.length})`,
      lines: report.rejected.map(
        (item) =>
          `#${item.index + 1} ${item.code}: ${item.message}` +
          (item.closest !== undefined ? ` — closest: “${item.closest}”` : ''),
      ),
    });
  }
  if (report.orphaned.length > 0) {
    sections.push({
      title: `Orphaned (${report.orphaned.length})`,
      lines: report.orphaned.map((id) => `[${id}] anchor lost; demoted to block comment`),
    });
  }
  if (report.anchorModified.length > 0) {
    sections.push({
      title: `Anchors clipped (${report.anchorModified.length})`,
      lines: report.anchorModified.map((id) => `[${id}]`),
    });
  }
  if (report.unaddressed.length > 0) {
    sections.push({
      title: `No patch (${report.unaddressed.length})`,
      lines: report.unaddressed.map((id) => `[${id}]`),
    });
  }
  if (report.responseIssues.length > 0) {
    sections.push({
      title: `Response coverage issues (${report.responseIssues.length})`,
      lines: report.responseIssues.map((item) => item.message),
    });
  }
  return {
    headline: `${report.applied.length} patch(es) applied, ${report.rejected.length} rejected, ${report.resolved.length} comment(s) resolved.`,
    sections,
  };
}
