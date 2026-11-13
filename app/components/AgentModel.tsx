"use client";

import React, { useEffect, useRef, useState } from "react";
import { mountAgentModel, type AgentMood } from "../lib/agentModels";

interface AgentModelProps {
  agentId: string;
  mood?: AgentMood;
  /** Height in CSS pixels; the box shrinks to fit narrow spaces. */
  size: number;
  /** Width as a share of the height (default 0.8, a 4:5 box). */
  ratio?: number;
  /** Camera distance: 1 frames the whole scene with its props, smaller is closer (default 0.78). */
  zoom?: number;
  /** Let people drag the model to turn it (default true). The model always keeps its own animation. */
  draggable?: boolean;
  /** Shown instead when the browser can't draw 3D: the agent's original ASCII art. */
  ascii: string[];
  color: string;
  label: string;
  opacity?: number;
}

// One of the low-poly 3D agents, sized to sit where its ASCII art used to be.
export default function AgentModel({ agentId, mood = "neutral", size, ratio = 0.8, zoom = 0.78, draggable = true, ascii, color, label, opacity = 1 }: AgentModelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stop = mountAgentModel(canvas, agentId, mood, { zoom, draggable });
    if (!stop) {
      // no WebGL2 here: fall back to the ASCII art (deferred so it isn't a state update during the effect)
      const id = requestAnimationFrame(() => setFailed(true));
      return () => cancelAnimationFrame(id);
    }
    return stop;
  }, [agentId, mood, zoom, draggable]);

  if (failed) {
    return (
      <pre style={{ color, fontSize: `${Math.max(9, Math.round(size / 11))}px`, lineHeight: "1.05", opacity }} aria-label={label}>
        {ascii.join("\n")}
      </pre>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      width={Math.round(size * ratio)}
      height={size}
      style={{
        display: "block",
        width: `${Math.round(size * ratio)}px`,
        maxWidth: "100%",
        aspectRatio: `${ratio}`,
        height: "auto",
        imageRendering: "pixelated",
        cursor: draggable ? "grab" : "default",
        touchAction: "pan-y",
        opacity,
        transition: "opacity 0.3s",
        margin: "0 auto",
      }}
    />
  );
}
