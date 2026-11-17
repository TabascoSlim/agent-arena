import React, { useState, useEffect, useRef } from "react";
import { Theme } from "./types";

export const TypewriterText: React.FC<{
  text: string;
  speed?: number;
  onComplete?: () => void;
  playSound: (type: "type") => void;
  theme: Theme;
}> = ({ text, speed = 25, onComplete, playSound, theme }) => {
  // Progress is tied to the text it belongs to. When a new line arrives, the count
  // starts over at 0 instead of continuing from where the previous line stopped
  // (which used to splice the tail of the new line onto the old one).
  const [progress, setProgress] = useState<{ text: string; count: number }>({ text, count: 0 });
  const instant = speed <= 0;
  const count = instant ? text.length : progress.text === text ? progress.count : 0;
  const displayText = text.slice(0, count);
  const onCompleteRef = useRef(onComplete);
  const playSoundRef = useRef(playSound);
  
  // Keep refs updated without triggering re-renders
  useEffect(() => {
    onCompleteRef.current = onComplete;
    playSoundRef.current = playSound;
  }, [onComplete, playSound]);

  useEffect(() => {
    if (count < text.length) {
      const timer = setTimeout(() => {
        setProgress({ text, count: count + 1 });
        if (count % 2 === 0) {
          playSoundRef.current("type");
        }
      }, speed);
      return () => clearTimeout(timer);
    }
    onCompleteRef.current?.();
  }, [count, text, speed]); // onComplete and playSound are read through refs

  return (
    <span style={{ color: theme.text }}>
      {displayText}
      <span
        className="cursor-blink"
        style={{ color: theme.cursor }}
      >
        █
      </span>
    </span>
  );
};
