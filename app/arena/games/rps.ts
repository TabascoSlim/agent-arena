import { GAMES } from "../data/config";
import { Agent, BaseGame, MatchRecord } from "../types";

export class RPSGame implements BaseGame {
  round: number;
  scores: [number, number];
  maxRounds: number;
  history: Array<{ round: number; p1Move: string; p2Move: string; winner: number | null }>;
  currentMoves: [string | null, string | null];
  lastRoundMoves: [string | null, string | null];
  roundJustEnded: boolean;

  constructor() {
    this.round = 1;
    this.scores = [0, 0];
    // Best of 3: first to 2 round wins. Tied rounds are replayed instead of counting
    // toward the 3, so matches rarely end in a tie. The cap only stops an endless
    // run of ties (a match tie now happens well under 1% of the time).
    this.maxRounds = 9;
    this.history = [];
    this.currentMoves = [null, null];
    this.lastRoundMoves = [null, null];
    this.roundJustEnded = false;
  }

  makeMove(player: number, rawMove: string): boolean {
    const validMoves = ["Rock", "Paper", "Scissors"];
    const move = validMoves.find((m) => m.toLowerCase() === String(rawMove).trim().toLowerCase());
    if (!move) return false;

    // Clear last round moves when starting a new round
    if (player === 0 && this.roundJustEnded) {
      this.lastRoundMoves = [null, null];
      this.roundJustEnded = false;
    }

    this.currentMoves[player] = move;

    if (this.currentMoves[0] && this.currentMoves[1]) {
      this.resolveRound();
    }
    return true;
  }

  clearRoundMoves() {
    this.lastRoundMoves = [null, null];
    this.roundJustEnded = false;
  }

  resolveRound() {
    const [p1Move, p2Move] = this.currentMoves;
    let winner: number | null = null;

    if (p1Move === p2Move) {
      winner = null;
    } else if (
      (p1Move === "Rock" && p2Move === "Scissors") ||
      (p1Move === "Paper" && p2Move === "Rock") ||
      (p1Move === "Scissors" && p2Move === "Paper")
    ) {
      winner = 0;
      this.scores[0]++;
    } else {
      winner = 1;
      this.scores[1]++;
    }

    this.history.push({
      round: this.round,
      p1Move: p1Move!,
      p2Move: p2Move!,
      winner,
    });

    // Store last moves for display before clearing
    this.lastRoundMoves = [p1Move, p2Move];
    this.roundJustEnded = true;
    this.currentMoves = [null, null];
    this.round++;
  }

  isGameOver(): boolean {
    // First to 2 round wins; tied rounds replay (capped by maxRounds)
    return this.scores[0] >= 2 || this.scores[1] >= 2 || this.round > this.maxRounds;
  }

  getWinner(): number | null {
    // Best of 3: first to 2 wins
    if (this.scores[0] >= 2) return 0;
    if (this.scores[1] >= 2) return 1;
    if (this.round > this.maxRounds) {
      if (this.scores[0] > this.scores[1]) return 0;
      if (this.scores[1] > this.scores[0]) return 1;
      return null;
    }
    return null;
  }

  buildPrompt(player: number, agent: Agent, opponent: Agent, matchHistory: MatchRecord[]): string {
    const myScore = this.scores[player];
    const oppScore = this.scores[1 - player];

    let historyContext = "";
    if (matchHistory.length > 0) {
      const recent = matchHistory.slice(-3);
      historyContext = "\nMATCH HISTORY:\n" + recent.map(m => {
        const result = m.winner === null ? "Tie" : m.winner === player ? "Win" : "Loss";
        return `- ${GAMES[m.gameType].name}: ${result}`;
      }).join("\n");
    } else {
      historyContext = "\nThis is your first match against this opponent.";
    }

    return `Round ${this.round} of a best-of-3 series (first to 2 wins; tied rounds are replayed).
Current score: You ${myScore} - Opponent ${oppScore}${historyContext}

Make your move. Respond in exactly this format:

MOVE: [Rock/Paper/Scissors]
COMMENTARY: [Your brief comment in character]`;
  }
}
