// Types for agentModels.js (the low-poly agent models and their shared WebGL renderer).

export type AgentMood = "neutral" | "win" | "lose";

export interface AgentModelOptions {
  /** Starting turn of the model, in radians. */
  turn?: number;
  /** Let people drag the model to turn it (default true). */
  draggable?: boolean;
  /** Camera distance: 1 frames the whole scene, smaller is closer (default 1). */
  zoom?: number;
}

/** Shows an agent in a mood inside a canvas. Returns a function that stops it, or null when WebGL2 isn't available. */
export function mountAgentModel(
  canvas: HTMLCanvasElement,
  agentId: string,
  mood?: AgentMood,
  options?: AgentModelOptions,
): (() => void) | null;

export const AGENT_MODEL_IDS: string[];

/** How many models are currently showing (for tests). */
export function activeAgentModelCount(): number;
