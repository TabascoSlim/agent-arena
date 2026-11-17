import { Card, createDeck, shuffleDeck } from "./cards";
import { Agent, BaseGame, MatchRecord } from "../types";

export class WarGame implements BaseGame {
  decks: [Card[], Card[]];
  currentCards: [Card | null, Card | null];
  scores: [number, number];
  round: number;
  maxRounds: number;
  history: Array<{ round: number; p1Card: Card; p2Card: Card; winner: number | null }>;
  lastRoundCards: [Card | null, Card | null];

  constructor() {
    const fullDeck = shuffleDeck(createDeck());
    this.decks = [fullDeck.slice(0, 26), fullDeck.slice(26)];
    this.currentCards = [null, null];
    this.lastRoundCards = [null, null];
    this.scores = [0, 0];
    this.round = 1;
    // Best of 5: first to 3 round wins. Tied rounds (same rank) are replayed;
    // the cap only stops an extreme run of ties (each player has 26 cards).
    this.maxRounds = 13;
    this.history = [];
  }

  drawCard(player: number): Card | null {
    if (this.decks[player].length === 0) return null;
    return this.decks[player].shift()!;
  }

  makeMove(player: number, move: string): boolean {
    // In War, the move is always "Draw" - agents just comment on it
    if (move.toLowerCase() !== "draw") return false;

    const card = this.drawCard(player);
    if (!card) return false;

    this.currentCards[player] = card;

    if (this.currentCards[0] && this.currentCards[1]) {
      this.resolveRound();
    }
    return true;
  }

  resolveRound() {
    const [p1Card, p2Card] = this.currentCards;
    if (!p1Card || !p2Card) return;

    let winner: number | null = null;
    if (p1Card.value > p2Card.value) {
      winner = 0;
      this.scores[0]++;
    } else if (p2Card.value > p1Card.value) {
      winner = 1;
      this.scores[1]++;
    }
    // Tie = no points

    this.history.push({
      round: this.round,
      p1Card,
      p2Card,
      winner
    });

    this.lastRoundCards = [p1Card, p2Card];
    this.currentCards = [null, null];
    this.round++;
  }

  isGameOver(): boolean {
    return this.scores[0] >= 3 || this.scores[1] >= 3 || this.round > this.maxRounds;
  }

  getWinner(): number | null {
    if (this.scores[0] >= 3) return 0;
    if (this.scores[1] >= 3) return 1;
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
    if (this.history.length > 0) {
      historyContext = "\nROUND HISTORY:\n" + this.history.map(h => {
        const myCard = player === 0 ? h.p1Card : h.p2Card;
        const oppCard = player === 0 ? h.p2Card : h.p1Card;
        const result = h.winner === null ? "Tie" : h.winner === player ? "Won" : "Lost";
        return `- R${h.round}: You: ${myCard.rank}${myCard.suit} vs Opponent: ${oppCard.rank}${oppCard.suit} → ${result}`;
      }).join("\n");
    }

    return `WAR - Round ${this.round} of a best-of-5 (first to 3 wins; tied rounds are replayed)
Current score: You ${myScore} - Opponent ${oppScore}${historyContext}

It's time to draw your card! In War, you have no control over what card you draw - it's pure luck!

Respond in exactly this format:
MOVE: Draw
COMMENTARY: [Your reaction/prediction in character - you can trash talk, analyze odds, or just have fun!]`;
  }
}
