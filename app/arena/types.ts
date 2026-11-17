export type GameType = "rps" | "ttt" | "mancala" | "war" | "blackjack";
export type AgentId = "analyst" | "chaos" | "strategist" | "rookie" | "diva";
export type ThemeId = "amber" | "green" | "white" | "blue";
export type GamePhase = "setup" | "placement" | "playing" | "finished";
export type SpeedMultiplier = 0 | 1 | 2;
export type ApiProvider = "claude" | "offline";
export type GameMode = "bot-vs-bot" | "human-vs-bot";

// Base game interface
export interface BaseGame {
  isGameOver(): boolean;
  getWinner(): number | null;
}

export interface Agent {
  id: AgentId;
  name: string;
  temperature: number;
  color: string;
  description: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  primary: string;
  secondary: string;
  background: string;
  text: string;
  glow: string;
  cursor: string;
}

export interface MatchRecord {
  id: string;
  timestamp: number;
  gameType: GameType;
  agent1: { id: AgentId; name: string };
  agent2: { id: AgentId; name: string };
  winner: 0 | 1 | null;
  rounds: number;
  duration: number;
}

export interface TournamentMatch {
  agent1: AgentId;
  agent2: AgentId;
  winner: AgentId | null;
  completed: boolean;
}

export type TournamentPhase = "idle" | "running" | "finished";

export interface GameState {
  selectedGame: GameType | null;
  agent1: AgentId | null;
  agent2: AgentId | null;
  currentGame: BaseGame | null;
  gamePhase: GamePhase;
  currentPlayer: number;
  moveDelay: number;
  speedMultiplier: SpeedMultiplier;
  isThinking: boolean;
  thinkingAgent: string | null;
  error: string | null;
  agent1Commentary: string;
  agent2Commentary: string;
  matchHistory: MatchRecord[];
  postGameCommentary1: string;
  postGameCommentary2: string;
  soundEnabled: boolean;
  theme: ThemeId;
  isTyping1: boolean;
  isTyping2: boolean;
  gameLog: string[];
  apiProvider: ApiProvider;
  // Game mode (bot vs bot or human vs bot)
  gameMode: GameMode;
  waitingForHuman: boolean;
  humanMove: string | null;
  // Tournament mode
  tournamentMode: boolean;
  tournamentPhase: TournamentPhase;
  tournamentMatches: TournamentMatch[];
  tournamentCurrentMatch: number;
  tournamentScores: Record<AgentId, { wins: number; losses: number; ties: number; points: number }>;
  tournamentStopped: boolean;
}
