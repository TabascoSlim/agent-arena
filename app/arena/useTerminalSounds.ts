import { useEffect, useRef, useCallback } from "react";

export const useTerminalSounds = (enabled: boolean) => {
  const audioContext = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (enabled && typeof window !== "undefined") {
      audioContext.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return () => {
      audioContext.current?.close();
    };
  }, [enabled]);

  const playSound = useCallback((type: "type" | "move" | "win" | "error" | "cheer") => {
    if (!enabled || !audioContext.current) return;

    const ctx = audioContext.current;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    switch (type) {
      case "type":
        oscillator.frequency.value = 800 + Math.random() * 200;
        gainNode.gain.setValueAtTime(0.03, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.03);
        break;
      case "move":
        oscillator.frequency.value = 600;
        gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.08);
        break;
      case "win":
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.05, ctx.currentTime + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.12);
          osc.start(ctx.currentTime + i * 0.08);
          osc.stop(ctx.currentTime + i * 0.08 + 0.12);
        });
        break;
      case "cheer":
        // 8-bit crowd cheer - multiple rapid notes with noise
        const cheerFreqs = [392, 523, 659, 784, 880, 988, 1047, 1175, 1319];
        cheerFreqs.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "square";
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq + (Math.random() * 50 - 25);
          const startTime = ctx.currentTime + i * 0.04;
          gain.gain.setValueAtTime(0.03, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);
          osc.start(startTime);
          osc.stop(startTime + 0.08);
        });
        // Add some noise bursts for crowd effect
        for (let i = 0; i < 5; i++) {
          const noiseOsc = ctx.createOscillator();
          const noiseGain = ctx.createGain();
          noiseOsc.type = "sawtooth";
          noiseOsc.connect(noiseGain);
          noiseGain.connect(ctx.destination);
          noiseOsc.frequency.value = 200 + Math.random() * 400;
          const startTime = ctx.currentTime + i * 0.08;
          noiseGain.gain.setValueAtTime(0.02, startTime);
          noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);
          noiseOsc.start(startTime);
          noiseOsc.stop(startTime + 0.1);
        }
        break;
      case "error":
        oscillator.frequency.value = 120;
        oscillator.type = "sawtooth";
        gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.2);
        break;
    }
  }, [enabled]);

  return { playSound };
};
