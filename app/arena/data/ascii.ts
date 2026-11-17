import { Card } from "../games/cards";
import { AgentId } from "../types";

export const AGENT_ASCII: Record<AgentId, string[]> = {
  analyst: [
    "  ┌───────┐  ",
    "  │ ◉   ◉ │  ",
    "  │  ═══  │  ",
    "  │ ├───┤ │  ",
    "  └───┬───┘  ",
    "    ╔═╩═╗    ",
    "   ╔╝   ╚╗   ",
    "   ║ CPU ║   ",
    "   ╚═════╝   ",
  ],
  chaos: [
    "    \\│/      ",
    "   ──●──     ",
    "  ╱ ⊙ ⊙ ╲    ",
    " │  ~~~  │   ",
    "  ╲ ╰─╯ ╱    ",
    "   ╲ ▼ ╱     ",
    "  ╔═╧═══╗    ",
    " ╱ CHAOS ╲   ",
    " ~~*~*~*~~   ",
  ],
  strategist: [
    "     ♟       ",
    "   ╔═══╗     ",
    "   ║▓▓▓║     ",
    "   ╠═══╣     ",
    "  ╔╝   ╚╗    ",
    "  ║ ─ ─ ║    ",
    "  ║  ▽  ║    ",
    "  ╚═════╝    ",
    "   THINK     ",
  ],
  rookie: [
    "    ★        ",
    "  ╭───╮      ",
    "  │◕ ◕│      ",
    "  │ ▽ │      ",
    "  ╰─┬─╯      ",
    "  ╭─┴─╮      ",
    "  │ ? │      ",
    "  ╰───╯      ",
    "   ∩∩∩       ",
  ],
  diva: [
    "    ✧･ﾟ      ",
    "   ╭━━━╮     ",
    "  ╭┫♡ ♡┣╮    ",
    "  │╰━┳━╯│    ",
    "   ╲ ♡ ╱     ",
    "  ╭─╰┳╯─╮    ",
    "  │FABUL│    ",
    "  │ OUS │    ",
    "   ✧ ✧ ✧     ",
  ],
};

export const RPS_ASCII: Record<string, string[]> = {
  Rock: [
    "    _______    ",
    "---'   ____)   ",
    "      (_____)  ",
    "      (_____)  ",
    "      (____)   ",
    "---.__(___)    ",
  ],
  Paper: [
    "     _______      ",
    "---'    ____)____ ",
    "           ______)",
    "          _______)",
    "         _______) ",
    "---.__________)   ",
  ],
  Scissors: [
    "    _______      ",
    "---'   ____)____ ",
    "          ______)",
    "       __________)",
    "      (____)     ",
    "---.__(___)      ",
  ],
  "?": [
    "    _______    ",
    "   /       \\   ",
    "  |   ???   |  ",
    "  |         |  ",
    "   \\_______/   ",
    "               ",
  ],
};

export const CARD_ASCII: Record<string, string[]> = {
  "back": [
    "┌─────────┐",
    "│░░░░░░░░░│",
    "│░░░░░░░░░│",
    "│░░░░░░░░░│",
    "│░░░░░░░░░│",
    "│░░░░░░░░░│",
    "└─────────┘"
  ],
  "empty": [
    "┌─────────┐",
    "│         │",
    "│         │",
    "│    ?    │",
    "│         │",
    "│         │",
    "└─────────┘"
  ]
};

export function getCardAscii(card: Card | null): string[] {
  if (!card) return CARD_ASCII["empty"];
  const isRed = card.suit === '♥' || card.suit === '♦';
  const rank = card.rank.padEnd(2, ' ');
  const rankRight = card.rank.padStart(2, ' ');
  return [
    "┌─────────┐",
    `│${rank}       │`,
    "│         │",
    `│    ${card.suit}    │`,
    "│         │",
    `│       ${rankRight}│`,
    "└─────────┘"
  ];
}
