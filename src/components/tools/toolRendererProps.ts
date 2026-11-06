import type { TurnStateQuestionRequest } from "@/api";

export interface ToolRendererProps {
  toolName: string;
  heading: string;
  body: string;
  status?: "pending" | "running" | "completed" | "error";
  toolInput?: string;
  /**
   * Question Tool (Sept 2026) — resolved question entry (latched
   * question text + answers), set by MessageBubble when the pending
   * question was answered via the overlay. Optional so every other
   * tool renderer ignores it.
   */
  resolvedQuestion?: TurnStateQuestionRequest | null;
}
