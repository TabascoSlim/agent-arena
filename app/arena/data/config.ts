import { Agent, AgentId, GameType, Theme, ThemeId } from "../types";

export const AGENTS: Record<AgentId, Agent> = {
  analyst: {
    id: "analyst",
    name: "The Analyst",
    temperature: 0.4,
    color: "#00ffff",
    description: "Methodical, data-driven, analytical. Speaks in measured, academic tone.",
  },
  chaos: {
    id: "chaos",
    name: "The Chaos Agent",
    temperature: 0.95,
    color: "#ff3333",
    description: "Unpredictable, risk-taking, thrives on randomness and psychological warfare. Loves to trash-talk.",
  },
  strategist: {
    id: "strategist",
    name: "The Strategist",
    temperature: 0.5,
    color: "#33ff00",
    description: "Calm, calculating, plays the long game. Thinks several moves ahead.",
  },
  rookie: {
    id: "rookie",
    name: "The Rookie",
    temperature: 0.8,
    color: "#ffff00",
    description: "Enthusiastic, earnest, still learning. Makes beginner mistakes but eager to improve.",
  },
  diva: {
    id: "diva",
    name: "The Diva",
    temperature: 0.75,
    color: "#ff69b4",
    description: "Dramatic, confident, fabulous. Loves the spotlight and always makes an entrance.",
  },
};

export const THEMES: Record<ThemeId, Theme> = {
  amber: {
    id: "amber",
    name: "Amber",
    primary: "#ffb000",
    secondary: "#ff8c00",
    background: "#1a0f00",
    text: "#ffb000",
    glow: "0 0 10px #ffb000, 0 0 20px #ffb000",
    cursor: "#ffb000",
  },
  green: {
    id: "green",
    name: "Green (Phosphor)",
    primary: "#33ff00",
    secondary: "#00ff00",
    background: "#001a00",
    text: "#33ff00",
    glow: "0 0 10px #33ff00, 0 0 20px #33ff00",
    cursor: "#33ff00",
  },
  white: {
    id: "white",
    name: "White",
    primary: "#ffffff",
    secondary: "#cccccc",
    background: "#0a0a0a",
    text: "#ffffff",
    glow: "0 0 10px #ffffff, 0 0 20px #ffffff",
    cursor: "#ffffff",
  },
  blue: {
    id: "blue",
    name: "Blue",
    primary: "#00bfff",
    secondary: "#0099cc",
    background: "#000a1a",
    text: "#00bfff",
    glow: "0 0 10px #00bfff, 0 0 20px #00bfff",
    cursor: "#00bfff",
  },
};

export const GAMES: Record<GameType, { name: string; description: string }> = {
  rps: { name: "Rock-Paper-Scissors", description: "Best of 3 (tied rounds replay)" },
  ttt: { name: "Tic-Tac-Toe", description: "Classic 3x3 grid" },
  mancala: { name: "Mancala", description: "Capture the most stones" },
  war: { name: "War", description: "Best of 5 card battles (ties replay)" },
  blackjack: { name: "Blackjack", description: "Best of 3 hands, closest to 21 (pushes replay)" },
};

// Colours you can pick for yourself in YOU vs BOT
export const HUMAN_COLORS: { id: string; name: string; hex: string }[] = [
  { id: "pink", name: "Pink", hex: "#ff69b4" },
  { id: "violet", name: "Violet", hex: "#b388ff" },
  { id: "orange", name: "Orange", hex: "#ff8c1a" },
  { id: "sky", name: "Sky Blue", hex: "#4db8ff" },
  { id: "lime", name: "Lime", hex: "#a6ff00" },
  { id: "gold", name: "Gold", hex: "#ffd700" },
  { id: "mint", name: "Mint", hex: "#3dffc5" },
  { id: "white", name: "White", hex: "#f2f2f2" },
];
export const HUMAN_COLOR_KEY = "agentArena.humanColor";
