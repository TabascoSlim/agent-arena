import { Agent, BaseGame, MatchRecord } from "../types";

export class MancalaGame implements BaseGame {
  // Board layout: [0-5] = Player 0's pits, [6] = Player 0's store
  //               [7-12] = Player 1's pits, [13] = Player 1's store
  board: number[];
  currentPlayer: number;
  moveHistory: Array<{ player: number; pit: number; captured: number }>;
  lastMove: { player: number; pit: number; extraTurn: boolean } | null;

  constructor() {
    // 6 pits per player with 4 stones each, 2 stores (mancalas) start empty
    this.board = [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0];
    this.currentPlayer = 0;
    this.moveHistory = [];
    this.lastMove = null;
  }

  getPlayerPits(player: number): number[] {
    if (player === 0) return [0, 1, 2, 3, 4, 5];
    return [7, 8, 9, 10, 11, 12];
  }

  getPlayerStore(player: number): number {
    return player === 0 ? 6 : 13;
  }

  getOppositePit(pit: number): number {
    // Pits 0-5 are opposite to pits 12-7
    // Pits 7-12 are opposite to pits 5-0
    return 12 - pit;
  }

  getValidMoves(player: number): number[] {
    const pits = this.getPlayerPits(player);
    return pits.filter(pit => this.board[pit] > 0);
  }

  makeMove(player: number, pitInput: string | number): boolean {
    // Convert pit input - accept 1-6 for the player's pits
    let selectedPit: number;

    if (typeof pitInput === 'string') {
      const pitNum = parseInt(pitInput);
      if (isNaN(pitNum) || pitNum < 1 || pitNum > 6) return false;
      selectedPit = player === 0 ? pitNum - 1 : pitNum + 6;
    } else {
      selectedPit = pitInput;
    }

    // Validate it's the player's pit
    const playerPits = this.getPlayerPits(player);
    if (!playerPits.includes(selectedPit)) return false;

    // Check pit has stones
    if (this.board[selectedPit] === 0) return false;

    // Pick up all stones from selected pit
    let stones = this.board[selectedPit];
    this.board[selectedPit] = 0;
    let currentPit = selectedPit;
    const opponentStore = this.getPlayerStore(1 - player);

    // Distribute stones
    while (stones > 0) {
      currentPit = (currentPit + 1) % 14;

      // Skip opponent's store
      if (currentPit === opponentStore) {
        currentPit = (currentPit + 1) % 14;
      }

      this.board[currentPit]++;
      stones--;
    }

    // Check for capture (last stone lands in empty pit on player's side)
    let captured = 0;
    const playerStore = this.getPlayerStore(player);
    if (playerPits.includes(currentPit) && this.board[currentPit] === 1) {
      const oppositePit = this.getOppositePit(currentPit);
      if (this.board[oppositePit] > 0) {
        captured = this.board[oppositePit] + 1;
        this.board[playerStore] += this.board[oppositePit] + 1;
        this.board[oppositePit] = 0;
        this.board[currentPit] = 0;
      }
    }

    // Check for extra turn (last stone lands in player's store)
    const extraTurn = currentPit === playerStore;

    this.moveHistory.push({ player, pit: selectedPit, captured });
    this.lastMove = { player, pit: selectedPit, extraTurn };

    // Switch player if no extra turn
    if (!extraTurn) {
      this.currentPlayer = 1 - player;
    }

    // Check if game should end (one side empty)
    this.checkEndGame();

    return true;
  }

  checkEndGame(): void {
    for (let player = 0; player < 2; player++) {
      const pits = this.getPlayerPits(player);
      const totalStones = pits.reduce((sum, pit) => sum + this.board[pit], 0);

      if (totalStones === 0) {
        // Move all remaining stones to opponent's store
        const opponent = 1 - player;
        const oppPits = this.getPlayerPits(opponent);
        const oppStore = this.getPlayerStore(opponent);

        for (const pit of oppPits) {
          this.board[oppStore] += this.board[pit];
          this.board[pit] = 0;
        }
      }
    }
  }

  isGameOver(): boolean {
    for (let player = 0; player < 2; player++) {
      const pits = this.getPlayerPits(player);
      const totalStones = pits.reduce((sum, pit) => sum + this.board[pit], 0);
      if (totalStones === 0) return true;
    }
    return false;
  }

  getWinner(): number | null {
    if (!this.isGameOver()) return null;

    const store0 = this.board[6];
    const store1 = this.board[13];

    if (store0 > store1) return 0;
    if (store1 > store0) return 1;
    return null; // Tie
  }

  getScore(player: number): number {
    return this.board[this.getPlayerStore(player)];
  }

  renderBoard(): string {
    // Player 1's pits (top row, displayed right to left)
    const p1Pits = [12, 11, 10, 9, 8, 7].map(i => String(this.board[i]).padStart(2));
    // Player 0's pits (bottom row, displayed left to right)
    const p0Pits = [0, 1, 2, 3, 4, 5].map(i => String(this.board[i]).padStart(2));

    return `
    ┌────────────────────────────┐
    │    ${p1Pits.join('  ')}    │
 ${String(this.board[13]).padStart(2)} │                            │ ${String(this.board[6]).padStart(2)}
    │    ${p0Pits.join('  ')}    │
    └────────────────────────────┘
         1   2   3   4   5   6`;
  }

  buildPrompt(player: number, agent: Agent, opponent: Agent, matchHistory: MatchRecord[]): string {
    const myPits = this.getPlayerPits(player);
    const myPitValues = myPits.map((pit, i) => `Pit ${i + 1}: ${this.board[pit]} stones`);
    const validMoves = this.getValidMoves(player).map(pit => player === 0 ? pit + 1 : pit - 6);

    const myScore = this.getScore(player);
    const oppScore = this.getScore(1 - player);

    let historyContext = "";
    if (this.moveHistory.length > 0) {
      const recentMoves = this.moveHistory.slice(-4);
      historyContext = "\nRECENT MOVES:\n" + recentMoves.map(m => {
        const pitNum = m.player === 0 ? m.pit + 1 : m.pit - 6;
        const who = m.player === player ? "You" : opponent.name;
        const capture = m.captured > 0 ? ` (captured ${m.captured}!)` : "";
        return `- ${who}: Pit ${pitNum}${capture}`;
      }).join("\n");
    }

    return `MANCALA - Capture the most stones!

BOARD STATE:
${this.renderBoard()}

YOUR SIDE (bottom): Pits 1-6, Store on right (${myScore} stones)
OPPONENT'S SIDE (top): Store on left (${oppScore} stones)

Your pits:
${myPitValues.join("\n")}

Valid moves: ${validMoves.join(", ")}${historyContext}

RULES REMINDER:
- Pick a pit to take all stones from, distribute counter-clockwise
- Landing in your store = extra turn
- Landing in empty pit on your side = capture opposite pit

Choose a pit (1-6). Respond in exactly this format:
MOVE: [pit number 1-6]
COMMENTARY: [Your strategy in character]`;
  }
}
