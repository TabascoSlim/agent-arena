import { AgentId, ApiProvider, BaseGame, GameMode, GamePhase, GameState, GameType, MatchRecord, SpeedMultiplier, ThemeId, TournamentMatch, TournamentPhase } from "./types";

export const initialState: GameState = {
  selectedGame: null,
  agent1: null,
  agent2: null,
  currentGame: null,
  gamePhase: "setup",
  currentPlayer: 0,
  moveDelay: 1500,
  speedMultiplier: 1,
  isThinking: false,
  thinkingAgent: null,
  error: null,
  agent1Commentary: "",
  agent2Commentary: "",
  matchHistory: [],
  postGameCommentary1: "",
  postGameCommentary2: "",
  soundEnabled: true,
  theme: "amber",
  isTyping1: false,
  isTyping2: false,
  gameLog: [],
  apiProvider: "offline",
  // Game mode
  gameMode: "bot-vs-bot",
  waitingForHuman: false,
  humanMove: null,
  // Tournament mode
  tournamentMode: false,
  tournamentPhase: "idle",
  tournamentMatches: [],
  tournamentCurrentMatch: 0,
  tournamentScores: {
    analyst: { wins: 0, losses: 0, ties: 0, points: 0 },
    chaos: { wins: 0, losses: 0, ties: 0, points: 0 },
    strategist: { wins: 0, losses: 0, ties: 0, points: 0 },
    rookie: { wins: 0, losses: 0, ties: 0, points: 0 },
    diva: { wins: 0, losses: 0, ties: 0, points: 0 },
  },
  tournamentStopped: false,
};


export type Action =
  | { type: "SELECT_GAME"; game: GameType }
  | { type: "SELECT_AGENT1"; agent: AgentId }
  | { type: "SELECT_AGENT2"; agent: AgentId }
  | { type: "START_GAME" }
  | { type: "SET_GAME_PHASE"; phase: GamePhase }
  | { type: "SET_CURRENT_PLAYER"; player: number }
  | { type: "SET_CURRENT_GAME"; game: BaseGame }
  | { type: "SET_THINKING"; isThinking: boolean; agent: string | null }
  | { type: "SET_COMMENTARY"; player: number; commentary: string; isTyping: boolean }
  | { type: "SET_TYPING_COMPLETE"; player: number }
  | { type: "EXECUTE_MOVE"; move: string }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "ADD_MATCH"; match: MatchRecord }
  | { type: "SET_POST_GAME_COMMENTARY"; player: number; commentary: string }
  | { type: "SET_SPEED"; speed: SpeedMultiplier }
  | { type: "TOGGLE_SOUND" }
  | { type: "SET_THEME"; theme: ThemeId }
  | { type: "SET_API_PROVIDER"; provider: ApiProvider }
  | { type: "ADD_LOG"; message: string }
  | { type: "RESET_GAME" }
  | { type: "CLEAR_ERROR" }
  // Game mode actions
  | { type: "SET_GAME_MODE"; mode: GameMode }
  | { type: "SET_WAITING_FOR_HUMAN"; waiting: boolean }
  | { type: "SET_HUMAN_MOVE"; move: string | null }
  // Tournament actions
  | { type: "START_TOURNAMENT"; matches: TournamentMatch[] }
  | { type: "SET_TOURNAMENT_PHASE"; phase: TournamentPhase }
  | { type: "NEXT_TOURNAMENT_MATCH" }
  | { type: "UPDATE_TOURNAMENT_MATCH"; matchIndex: number; winner: AgentId | null }
  | { type: "UPDATE_TOURNAMENT_SCORES"; agent: AgentId; result: "win" | "loss" | "tie" }
  | { type: "END_TOURNAMENT" }
  | { type: "STOP_TOURNAMENT" };

export function gameReducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "SELECT_GAME":
      return { ...state, selectedGame: action.game };
    case "SELECT_AGENT1":
      return { ...state, agent1: action.agent };
    case "SELECT_AGENT2":
      return { ...state, agent2: action.agent };
    case "START_GAME":
      return { ...state, gamePhase: "placement", currentPlayer: 0, gameLog: [] };
    case "SET_GAME_PHASE":
      return { ...state, gamePhase: action.phase };
    case "SET_CURRENT_PLAYER":
      return { ...state, currentPlayer: action.player };
    case "SET_CURRENT_GAME":
      return { ...state, currentGame: action.game };
    case "SET_THINKING":
      return { ...state, isThinking: action.isThinking, thinkingAgent: action.agent };
    case "SET_COMMENTARY":
      if (action.player === 0) {
        return { ...state, agent1Commentary: action.commentary, isTyping1: action.isTyping };
      }
      return { ...state, agent2Commentary: action.commentary, isTyping2: action.isTyping };
    case "SET_TYPING_COMPLETE":
      if (action.player === 0) {
        return { ...state, isTyping1: false };
      }
      return { ...state, isTyping2: false };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "ADD_MATCH":
      return { ...state, matchHistory: [...state.matchHistory, action.match] };
    case "SET_POST_GAME_COMMENTARY":
      if (action.player === 0) {
        return { ...state, postGameCommentary1: action.commentary };
      }
      return { ...state, postGameCommentary2: action.commentary };
    case "SET_SPEED":
      return { ...state, speedMultiplier: action.speed };
    case "TOGGLE_SOUND":
      return { ...state, soundEnabled: !state.soundEnabled };
    case "SET_THEME":
      return { ...state, theme: action.theme };
    case "SET_API_PROVIDER":
      return { ...state, apiProvider: action.provider };
    case "ADD_LOG":
      return { ...state, gameLog: [...state.gameLog, action.message] };
    case "RESET_GAME":
      return {
        ...state,
        currentGame: null,
        gamePhase: "setup",
        currentPlayer: 0,
        isThinking: false,
        thinkingAgent: null,
        error: null,
        agent1Commentary: "",
        agent2Commentary: "",
        postGameCommentary1: "",
        postGameCommentary2: "",
        isTyping1: false,
        isTyping2: false,
        gameLog: [],
        waitingForHuman: false,
        humanMove: null,
      };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    // Game mode actions
    case "SET_GAME_MODE":
      return { ...state, gameMode: action.mode, agent1: null, agent2: null };
    case "SET_WAITING_FOR_HUMAN":
      return { ...state, waitingForHuman: action.waiting };
    case "SET_HUMAN_MOVE":
      return { ...state, humanMove: action.move, waitingForHuman: false };
    // Tournament actions
    case "START_TOURNAMENT":
      return {
        ...state,
        tournamentMode: true,
        tournamentPhase: "running",
        tournamentMatches: action.matches,
        tournamentCurrentMatch: 0,
        tournamentStopped: false,
        tournamentScores: {
          analyst: { wins: 0, losses: 0, ties: 0, points: 0 },
          chaos: { wins: 0, losses: 0, ties: 0, points: 0 },
          strategist: { wins: 0, losses: 0, ties: 0, points: 0 },
          rookie: { wins: 0, losses: 0, ties: 0, points: 0 },
          diva: { wins: 0, losses: 0, ties: 0, points: 0 },
        },
        gameLog: [],
      };
    case "SET_TOURNAMENT_PHASE":
      return { ...state, tournamentPhase: action.phase };
    case "NEXT_TOURNAMENT_MATCH":
      return { ...state, tournamentCurrentMatch: state.tournamentCurrentMatch + 1 };
    case "UPDATE_TOURNAMENT_MATCH": {
      const updatedMatches = [...state.tournamentMatches];
      updatedMatches[action.matchIndex] = {
        ...updatedMatches[action.matchIndex],
        winner: action.winner,
        completed: true,
      };
      return { ...state, tournamentMatches: updatedMatches };
    }
    case "UPDATE_TOURNAMENT_SCORES": {
      const updatedScores = { ...state.tournamentScores };
      const agentScore = { ...updatedScores[action.agent] };
      if (action.result === "win") {
        agentScore.wins++;
        agentScore.points += 3;
      } else if (action.result === "loss") {
        agentScore.losses++;
      } else {
        agentScore.ties++;
        agentScore.points += 1;
      }
      updatedScores[action.agent] = agentScore;
      return { ...state, tournamentScores: updatedScores };
    }
    case "END_TOURNAMENT":
      return {
        ...state,
        tournamentPhase: "idle",
        tournamentStopped: false,
        tournamentMode: false,
        agent1: null,
        agent2: null,
        currentGame: null,
        gamePhase: "setup",
      };
    case "STOP_TOURNAMENT": {
      const completedMatches = state.tournamentMatches.filter((m) => m.completed).length;
      return {
        ...state,
        // Show partial standings if at least one match finished; otherwise go straight back to setup
        tournamentPhase: completedMatches > 0 ? "finished" : "idle",
        tournamentStopped: completedMatches > 0,
        tournamentMode: false,
        agent1: null,
        agent2: null,
        currentGame: null,
        gamePhase: "setup",
        currentPlayer: 0,
        isThinking: false,
        thinkingAgent: null,
        agent1Commentary: "",
        agent2Commentary: "",
        postGameCommentary1: "",
        postGameCommentary2: "",
        isTyping1: false,
        isTyping2: false,
      };
    }
    default:
      return state;
  }
}
