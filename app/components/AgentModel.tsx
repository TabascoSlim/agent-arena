"use client";

import React, { useEffect, useRef, useState } from "react";
import { mountAgentModel, type AgentMood } from "../lib/agentModels";

interface AgentModelProps {
  agentId: string;
  mood?: AgentMood;
  /** Height in CSS pixels; the model is 4:5 (width is 80% of the height) and shrinks to fit narrow boxes. */
  size: number;
  /** Shown instead when the browser can't draw 3D: the agent's original ASCII art. */
  ascii: string[];
  color: string;
  label: string;
  opacity?: number;
}

// One of the low-poly 3D agents, sized to sit where its ASCII art used to be.
export default function AgentModel({ agentId, mood = "neutral", size, ascii, color, label, opacity = 1 }: AgentModelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stop = mountAgentModel(canvas, agentId, mood, { zoom: 0.78 });
    if (!stop) {
      // no WebGL2 here: fall back to the ASCII art (deferred so it isn't a state update during the effect)
      const id = requestAnimationFrame(() => setFailed(true));
      return () => cancelAnimationFrame(id);
    }
    return stop;
  }, [agentId, mood]);

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
      width={Math.round(size * 0.8)}
      height={size}
      style={{
        display: "block",
        width: `${Math.round(size * 0.8)}px`,
        maxWidth: "100%",
        aspectRatio: "4 / 5",
        height: "auto",
        imageRendering: "pixelated",
        cursor: "grab",
        touchAction: "pan-y",
        opacity,
        transition: "opacity 0.3s",
        margin: "0 auto",
      }}
    />
  );
}
