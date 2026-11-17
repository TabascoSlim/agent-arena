import { Card, createDeck, shuffleDeck } from "./cards";
import { Agent, BaseGame, MatchRecord } from "../types";

export class BlackjackGame implements BaseGame {
  deck: Card[];
  hands: [Card[], Card[]];
  scores: [number, number]; // Running score across rounds
  round: number;
  maxRounds: number;
  currentBets: [number, number];
  playerStood: [boolean, boolean];
  roundOver: boolean;
  history: Array<{ round: number; p1Hand: Card[]; p2Hand: Card[]; p1Total: number; p2Total: number; winner: number | null }>;

  constructor() {
    this.deck = shuffleDeck(createDeck());
    this.hands = [[], []];
    this.scores = [0, 0];
    this.round = 1;
    // Best of 3: first to 2 round wins. Pushes (equal totals or both bust) are replayed;
    // the cap only stops an extreme run of pushes.
    this.maxRounds = 9;
    this.currentBets = [0, 0];
    this.playerStood = [false, false];
    this.roundOver = false;
    this.history = [];
    this.dealInitialCards();
  }

  dealInitialCards() {
    // Deal 2 cards to each player
    for (let i = 0; i < 2; i++) {
      this.hands[0].push(this.deck.shift()!);
      this.hands[1].push(this.deck.shift()!);
    }
    this.playerStood = [false, false];
    this.roundOver = false;
  }

  calculateHandValue(hand: Card[]): number {
    let value = 0;
    let aces = 0;

    for (const card of hand) {
      if (card.rank === 'A') {
        aces++;
        value += 11;
      } else if (['K', 'Q', 'J'].includes(card.rank)) {
        value += 10;
      } else {
        value += parseInt(card.rank);
      }
    }

    // Adjust for aces
    while (value > 21 && aces > 0) {
      value -= 10;
      aces--;
    }

    return value;
  }

  makeMove(player: number, move: string): boolean {
    const normalizedMove = move.toLowerCase().trim();

    if (this.playerStood[player]) return false;
    if (this.roundOver) return false;

    if (normalizedMove === "hit") {
      if (this.deck.length === 0) {
        this.deck = shuffleDeck(createDeck());
      }
      this.hands[player].push(this.deck.shift()!);

      // Check for bust
      if (this.calculateHandValue(this.hands[player]) > 21) {
        this.playerStood[player] = true;
      }
    } else if (normalizedMove === "stand") {
      this.playerStood[player] = true;
    } else {
      return false;
    }

    // Check if round is over
    if (this.playerStood[0] && this.playerStood[1]) {
      this.resolveRound();
    }

    return true;
  }

  resolveRound() {
    const p1Total = this.calculateHandValue(this.hands[0]);
    const p2Total = this.calculateHandValue(this.hands[1]);

    let winner: number | null = null;

    const p1Bust = p1Total > 21;
    const p2Bust = p2Total > 21;

    if (p1Bust && p2Bust) {
      winner = null; // Both bust = tie
    } else if (p1Bust) {
      winner = 1;
      this.scores[1]++;
    } else if (p2Bust) {
      winner = 0;
      this.scores[0]++;
    } else if (p1Total > p2Total) {
      winner = 0;
      this.scores[0]++;
    } else if (p2Total > p1Total) {
      winner = 1;
      this.scores[1]++;
    }
    // Equal = tie, no points

    this.history.push({
      round: this.round,
      p1Hand: [...this.hands[0]],
      p2Hand: [...this.hands[1]],
      p1Total,
      p2Total,
      winner
    });

    this.roundOver = true;
    this.round++;

    // Set up next round if game not over
    if (!this.isGameOver()) {
      this.hands = [[], []];
      if (this.deck.length < 10) {
        this.deck = shuffleDeck(createDeck());
      }
      this.dealInitialCards();
    }
  }

  isGameOver(): boolean {
    return this.scores[0] >= 2 || this.scores[1] >= 2 || this.round > this.maxRounds;
  }

  getWinner(): number | null {
    if (this.scores[0] >= 2) return 0;
    if (this.scores[1] >= 2) return 1;
    if (this.round > this.maxRounds) {
      if (this.scores[0] > this.scores[1]) return 0;
      if (this.scores[1] > this.scores[0]) return 1;
      return null;
    }
    return null;
  }

  getHandString(hand: Card[]): string {
    return hand.map(c => `${c.rank}${c.suit}`).join(' ');
  }

  buildPrompt(player: number, agent: Agent, opponent: Agent, matchHistory: MatchRecord[]): string {
    const myHand = this.hands[player];
    const oppHand = this.hands[1 - player];
    const myTotal = this.calculateHandValue(myHand);
    const myScore = this.scores[player];
    const oppScore = this.scores[1 - player];

    // Show opponent's first card only (face up card)
    const oppVisibleCard = oppHand.length > 0 ? `${oppHand[0].rank}${oppHand[0].suit}` : "None";

    let historyContext = "";
    if (this.history.length > 0) {
      historyContext = "\nROUND HISTORY:\n" + this.history.map(h => {
        const myT = player === 0 ? h.p1Total : h.p2Total;
        const oppT = player === 0 ? h.p2Total : h.p1Total;
        const result = h.winner === null ? "Tie" : h.winner === player ? "Won" : "Lost";
        return `- R${h.round}: You: ${myT} vs Opponent: ${oppT} → ${result}`;
      }).join("\n");
    }

    return `BLACKJACK - Round ${this.round} of a best-of-3 (first to 2 wins; pushes are replayed)
Current match score: You ${myScore} - Opponent ${oppScore}${historyContext}

YOUR HAND: ${this.getHandString(myHand)} (Total: ${myTotal})
OPPONENT'S VISIBLE CARD: ${oppVisibleCard} (other card face down)

${myTotal > 21 ? "YOU BUSTED!" : myTotal === 21 ? "BLACKJACK!" : ""}

Choose your action:
- HIT: Draw another card (risk busting if you go over 21)
- STAND: Keep your current hand

Respond in exactly this format:
MOVE: [Hit/Stand]
COMMENTARY: [Your reasoning in character]`;
  }
}
