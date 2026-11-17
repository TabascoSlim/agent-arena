import { Agent, BaseGame, MatchRecord } from "../types";

export class TTTGame implements BaseGame {
  board: Array<string | null>;
  currentPlayer: number;
  moves: Array<{ player: number; position: number }>;
  symbols: [string, string];

  constructor() {
    this.board = Array(9).fill(null);
    this.currentPlayer = 0;
    this.moves = [];
    this.symbols = ["X", "O"];
  }

  makeMove(player: number, position: number): boolean {
    if (position < 1 || position > 9) return false;
    if (this.board[position - 1] !== null) return false;
    
    this.board[position - 1] = this.symbols[player];
    this.moves.push({ player, position });
    return true;
  }

  checkWinner(): number | null {
    const winningCombos = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];

    for (const combo of winningCombos) {
      const [a, b, c] = combo;
      if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) {
        return this.symbols[0] === this.board[a] ? 0 : 1;
      }
    }
    return null;
  }

  isDraw(): boolean {
    return this.board.every(cell => cell !== null) && !this.checkWinner();
  }

  isGameOver(): boolean {
    return this.checkWinner() !== null || this.isDraw();
  }

  getWinner(): number | null {
    return this.checkWinner();
  }

  getAvailableMoves(): number[] {
    return this.board
      .map((cell, idx) => (cell === null ? idx + 1 : null))
      .filter((pos): pos is number => pos !== null);
  }

  buildPrompt(player: number, agent: Agent, opponent: Agent, matchHistory: MatchRecord[]): string {
    const symbol = this.symbols[player];
    const boardDisplay = this.renderBoard();
    const availableMoves = this.getAvailableMoves();

    let historyContext = "";
    if (matchHistory.length > 0) {
      const relevant = matchHistory.filter(m => m.gameType === "ttt").slice(-3);
      if (relevant.length > 0) {
        historyContext = "\nMATCH HISTORY (Tic-Tac-Toe):\n" + relevant.map(m => {
          const result = m.winner === null ? "Tie" : m.winner === player ? "Win" : "Loss";
          return `- vs ${m.agent1.id === agent.id ? m.agent2.name : m.agent1.name}: ${result}`;
        }).join("\n");
      }
    }
    if (!historyContext) {
      historyContext = "\nThis is your first Tic-Tac-Toe match against this opponent.";
    }

    return `You are playing as ${symbol}.

Current board (positions 1-9):
${boardDisplay}

Available moves: ${availableMoves.join(", ")}${historyContext}

Make your move. Respond in exactly this format:

MOVE: [position number 1-9]
COMMENTARY: [Your brief comment in character]`;
  }

  renderBoard(): string {
    const rows = [];
    for (let i = 0; i < 3; i++) {
      const row = [];
      for (let j = 0; j < 3; j++) {
        const idx = i * 3 + j;
        const cell = this.board[idx];
        // Pad all cells to same width for alignment
        const displayCell = cell ? ` ${cell}` : ` ${idx + 1}`;
        row.push(displayCell);
      }
      rows.push("│" + row.join(" │") + " │");
    }
    return "┌───┬───┬───┐\n" + rows.join("\n├───┼───┼───┤\n") + "\n└───┴───┴───┘";
  }
}
