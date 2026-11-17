import { BlackjackGame } from "./blackjack";
import { MancalaGame } from "./mancala";
import { RPSGame } from "./rps";
import { TTTGame } from "./ttt";
import { WarGame } from "./war";

export type AnyGame = RPSGame | TTTGame | MancalaGame | WarGame | BlackjackGame;

// Validate and apply a move in any game. Returns false if the move is illegal.
export const applyMove = (game: AnyGame, player: number, move: string): boolean => {
  if (game instanceof TTTGame) {
    const pos = parseInt(move);
    return !isNaN(pos) && game.makeMove(player, pos);
  }
  return game.makeMove(player, move);
};

// A guaranteed-legal move, used if an agent fails to produce a legal one 3 times in a row
// (so a confused AI reply can't crash the match).
export const getFallbackMove = (game: AnyGame, player: number): string => {
  const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
  if (game instanceof RPSGame) return pick(["Rock", "Paper", "Scissors"]);
  if (game instanceof TTTGame) return String(pick(game.getAvailableMoves()));
  if (game instanceof MancalaGame) {
    return String(pick(game.getValidMoves(player).map((pit) => (player === 0 ? pit + 1 : pit - 6))));
  }
  if (game instanceof WarGame) return "Draw";
  return "Stand";
};

// Who moves next. Mancala rule: if your last stone lands in your own store, you go again.
export const nextPlayerAfter = (game: AnyGame, player: number): number =>
  game instanceof MancalaGame && game.lastMove?.player === player && game.lastMove.extraTurn
    ? player
    : 1 - player;
