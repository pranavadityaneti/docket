import { Injectable } from "@nestjs/common";

/**
 * Who is mid-classification right now.
 *
 * The DB claim (`classified_at`) is set at the START of a run, so it cannot
 * tell the UI "still thinking" apart from "finished with no type". This
 * process-local set bridges that gap for the checklist poll: a document id
 * lives here for the whole OpenAI round-trip, and the dashboard paints a
 * progress state from it. Single-instance is fine for Docket today; a shared
 * store would be the follow-up if we scale out.
 */
@Injectable()
export class ClassificationProgress {
  private readonly inFlight = new Set<string>();

  mark(documentId: string): void {
    this.inFlight.add(documentId);
  }

  clear(documentId: string): void {
    this.inFlight.delete(documentId);
  }

  isAnalyzing(documentId: string): boolean {
    return this.inFlight.has(documentId);
  }
}
