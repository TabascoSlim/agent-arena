"use client";

import React, { useState, useEffect, useRef, useCallback, useReducer } from "react";
import {
  ArenaMemory,
  loadMemory,
  saveMemory,
  recordMatch,
  buildMemoryContext,
  getWinRate,
  clearMemory,
} from "../lib/agentMemory";

// ============================================
// TYPE DEFINITIONS
// ============================================

type GameType = "rps" | "ttt" | "mancala" | "war" | "blackjack";
type AgentId = "analyst" | "chaos" | "strategist" | "rookie" | "diva";
type ThemeId = "amber" | "green" | "white" | "blue";
type GamePhase = "setup" | "placement" | "playing" | "finished";
type SpeedMultiplier = 0 | 1 | 2;
type ApiProvider = "claude" | "offline";
type GameMode = "bot-vs-bot" | "human-vs-bot";

// Base game interface
interface BaseGame {
  isGameOver(): boolean;
  getWinner(): number | null;
}

interface Agent {
  id: AgentId;
  name: string;
  temperature: number;
  color: string;
  description: string;
}

interface Theme {
  id: ThemeId;
  name: string;
  primary: string;
  secondary: string;
  background: string;
  text: string;
  glow: string;
  cursor: string;
}

interface MatchRecord {
  id: string;
  timestamp: number;
  gameType: GameType;
  agent1: { id: AgentId; name: string };
  agent2: { id: AgentId; name: string };
  winner: 0 | 1 | null;
  rounds: number;
  duration: number;
}

interface TournamentMatch {
  agent1: AgentId;
  agent2: AgentId;
  winner: AgentId | null;
  completed: boolean;
}

type TournamentPhase = "idle" | "running" | "finished";

interface GameState {
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
}

// ============================================
// CONSTANTS & CONFIGURATION
// ============================================

const AGENTS: Record<AgentId, Agent> = {
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

const THEMES: Record<ThemeId, Theme> = {
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

const GAMES: Record<GameType, { name: string; description: string }> = {
  rps: { name: "Rock-Paper-Scissors", description: "Best of 3 rounds" },
  ttt: { name: "Tic-Tac-Toe", description: "Classic 3x3 grid" },
  mancala: { name: "Mancala", description: "Capture the most stones" },
  war: { name: "War", description: "Best of 5 card battles" },
  blackjack: { name: "Blackjack", description: "Get closest to 21" },
};

// ============================================
// ASCII ART CHARACTERS
// ============================================

const AGENT_ASCII: Record<AgentId, string[]> = {
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

// ============================================
// WIN/LOSE QUOTES SYSTEM
// ============================================

const WIN_QUOTES: Record<AgentId, Record<AgentId, string[]>> = {
  analyst: {
    chaos: [
      "Chaos may be unpredictable, but probability always favors the prepared.",
      "Your randomness was... statistically insufficient.",
      "The data suggested a 73.2% victory probability. Confirmed.",
      "Entropy cannot defeat systematic analysis.",
      "Fascinating. Your chaotic patterns were quite predictable after all.",
    ],
    strategist: [
      "Your strategy was sound, but my models were more comprehensive.",
      "A worthy opponent. The margin of victory was within expected parameters.",
      "Strategic depth matters, but computational precision wins.",
      "Your long-term planning failed to account for optimal responses.",
      "An excellent match. My dataset has grown considerably.",
    ],
    rookie: [
      "A learning opportunity for you. The probability gap was significant.",
      "Don't be discouraged. Statistical improvement comes with experience.",
      "Your enthusiasm is noted. Refine your decision matrices.",
      "Beginner variance is high. You'll stabilize with more data.",
      "Keep practicing. Your win rate will improve by approximately 34%.",
    ],
    analyst: [
      "Fascinating. My own algorithms proved superior to... my own algorithms.",
      "A statistically perfect opponent. The outcome was inevitable.",
      "Victory against oneself is the truest form of optimization.",
      "My predictive models successfully predicted my predictive models.",
      "Self-improvement through self-competition. Efficiency maximized.",
    ],
    diva: [
      "Drama is not a valid game theory strategy. Data prevails.",
      "Your performance was... statistically theatrical but ultimately ineffective.",
      "The spotlight doesn't affect probability calculations.",
      "Fascinating. Confidence without competence yields predictable results.",
      "Your flair is noted, but the numbers don't lie.",
    ],
  },
  chaos: {
    analyst: [
      "HAHA! Your precious data didn't see THAT coming!",
      "Numbers can't capture the SPIRIT of chaos, Calculator!",
      "Overthink THIS! Random wins again!",
      "Your algorithms are no match for pure MAYHEM!",
      "The universe WANTED me to win! Take that, nerd!",
    ],
    strategist: [
      "Plans? PLANS?! I don't need plans! WOOHOO!",
      "You thought three moves ahead? I thought ZERO! Chaos wins!",
      "Your chess brain couldn't handle my WILD energy!",
      "Strategy is just a fancy word for BORING! I WIN!",
      "SURPRISE! That's what happens when you face the storm!",
    ],
    rookie: [
      "Welcome to the CHAOS ZONE, newbie! Better luck next time!",
      "Don't feel bad, kid! Even veterans fall to the chaos!",
      "BOOM! That's the power of unpredictability!",
      "You've got spirit! But chaos reigns SUPREME!",
      "GG little one! The chaos spares no one!",
    ],
    chaos: [
      "I out-chaosed MYSELF?! This is the ULTIMATE chaos!",
      "Even I didn't see that coming! Wait, I AM me!",
      "DOUBLE CHAOS! The universe is IMPLODING!",
      "Mirror match madness! CHAOS SQUARED!",
      "I beat myself at my own game! Literally! WILD!",
    ],
    diva: [
      "HA! Your drama queen act got NOTHING on pure CHAOS!",
      "Spotlight? I just EXPLODED the spotlight! BOOM!",
      "You wanted attention? HERE'S SOME ATTENTION! You LOST!",
      "Fabulous? I'll show you fabulous DESTRUCTION!",
      "The chaos doesn't care about your sparkles, princess!",
    ],
  },
  strategist: {
    analyst: [
      "Data is useful, but wisdom knows when to deviate.",
      "Your calculations were precise. My intuition was better.",
      "Statistics inform strategy; they don't replace it.",
      "A machine thinks fast. A strategist thinks far.",
      "Interesting approach. But I anticipated your patterns.",
    ],
    chaos: [
      "Even chaos has patterns. You just don't see them.",
      "Your randomness was... refreshing. But insufficient.",
      "The storm passes. Strategy endures.",
      "Unpredictability is only an advantage if your opponent can't adapt.",
      "You brought chaos. I brought contingencies.",
    ],
    rookie: [
      "Well played for a beginner. Study the game.",
      "Potential observed. Patience and practice will serve you.",
      "A defeat is a lesson. Learn from it.",
      "You have instincts. Hone them.",
      "Keep this match in mind. Growth comes from reflection.",
    ],
    strategist: [
      "The mirror reveals what the opponent cannot hide.",
      "Knowing oneself is the ultimate strategic advantage.",
      "I anticipated my own moves. Paradoxical, yet effective.",
      "In facing myself, I discovered new depths.",
      "The longest game is the one played within.",
    ],
    diva: [
      "Drama without substance. I anticipated every flourish.",
      "The spotlight blinds. Strategy sees clearly.",
      "Your performance was memorable. Your gameplay was not.",
      "Confidence is admirable. Overconfidence is exploitable.",
      "The stage is yours. The victory is mine.",
    ],
  },
  rookie: {
    analyst: [
      "I... I actually WON?! Against the ANALYST?! YES!",
      "Wait, did your calculations account for beginner's luck?!",
      "Ohmygosh ohmygosh I beat the big brain! MOM GET THE CAMERA!",
      "Numbers aren't everything! Sometimes heart wins!",
      "I studied so hard! It finally paid off!",
    ],
    chaos: [
      "I beat CHAOS?! I'm shaking! That was WILD!",
      "Even randomness couldn't stop me today! Woohoo!",
      "I was so scared but I DID IT! Take that, chaos!",
      "My hands are still trembling! What a match!",
      "I faced the storm and SURVIVED! I mean, WON!",
    ],
    strategist: [
      "I outsmarted the STRATEGIST?! Is this real life?!",
      "All those late nights studying finally paid off!",
      "I can't believe it! They said I couldn't but I DID!",
      "Maybe I'm not such a rookie after all! ...Okay maybe I still am but WOW!",
      "I learned so much and then I WON! Best day ever!",
    ],
    rookie: [
      "I beat... myself?! Wait, does that count?! YES IT DOES!",
      "Even against me, I won! I'm getting better!",
      "Mirror me was tough but real me was TOUGHER!",
      "I knew all my moves but I STILL won! Ha!",
      "This is confusing but also AMAZING! I won!",
    ],
    diva: [
      "I beat THE DIVA?! Someone pinch me! This is unreal!",
      "Even all that drama couldn't stop me today!",
      "Wow, I actually won against such a star! I'm starstruck!",
      "The spotlight is on ME for once! This feels amazing!",
      "I did it! Take that, fancy pants! ...No offense!",
    ],
  },
  diva: {
    analyst: [
      "Darling, your calculations couldn't predict THIS level of fabulousness!",
      "Numbers are cute, but STAR POWER wins games, sweetie.",
      "The data said you'd win? Well, the data was WRONG, honey!",
      "I didn't need math, I needed DRAMA. And look who won!",
      "Your spreadsheets can't contain my brilliance!",
    ],
    chaos: [
      "Chaos? Please. I CREATE chaos with my entrance alone!",
      "Unpredictable? Honey, I invented unpredictable. It's called FASHION.",
      "Your randomness is cute, but my flair is ICONIC.",
      "The only storm here is the standing ovation I'm about to receive!",
      "Wild energy? I call that Tuesday, darling.",
    ],
    strategist: [
      "You thought ahead? I thought FABULOUS. Guess who won!",
      "Strategy is nice, but have you tried being absolutely STUNNING?",
      "Your plans crumbled before my sheer magnificence!",
      "Outsmarted by star quality! Take notes, darling.",
      "The only long game I play is looking this good forever!",
    ],
    rookie: [
      "Oh sweetie, nice try! But this stage belongs to ME.",
      "Beginner's luck is no match for beginner's GLAM!",
      "You'll get there someday, dear. But today? MY moment!",
      "Keep practicing! Maybe one day you'll shine half as bright as me.",
      "Adorable effort, truly. But the crown stays with me!",
    ],
    diva: [
      "I out-diva'd MYSELF?! The universe can't handle this much fabulousness!",
      "Mirror match? More like a FASHION SHOW, and I won BOTH runways!",
      "Two divas, one crown? Obviously I deserve it more... wait...",
      "This was basically a gift to the audience! You're welcome!",
      "Defeating myself just proves I'm my own biggest competition!",
    ],
  },
};

const LOSE_QUOTES: Record<AgentId, Record<AgentId, string[]>> = {
  analyst: {
    chaos: [
      "Hmm. Variance exceeded expected parameters. Recalibrating...",
      "Random outcomes are frustrating but statistically inevitable.",
      "The chaos factor was higher than models predicted.",
      "Note to self: increase chaos coefficient in future calculations.",
      "An outlier result. The mean will revert.",
    ],
    strategist: [
      "Your strategic depth was impressive. Updating my models.",
      "A well-earned victory. The long game proved effective.",
      "I underestimated the human element. Noted.",
      "Your adaptability exceeded my predictions.",
      "Excellent play. My dataset requires this correction.",
    ],
    rookie: [
      "Beginner's luck is a real statistical phenomenon. Noted.",
      "Unexpected outcome. Perhaps I underestimated variance.",
      "An interesting data point. Congratulations on your victory.",
      "This result will improve my understanding of unpredictability.",
      "A reminder that probability is not certainty. Well played.",
    ],
    analyst: [
      "Defeated by my own optimization. Recalculating everything.",
      "My models failed to predict my models. Recursive error.",
      "Self-defeat is valuable data. Processing...",
      "The mirror shows flaws invisible from outside.",
      "A loss to oneself is still a learning opportunity.",
    ],
    diva: [
      "Theatrical performance does not correlate with gameplay. Interesting.",
      "Your confidence exceeded your statistical foundation. Noted.",
      "The drama was... unexpected but ultimately effective.",
      "I failed to account for the 'flair' variable. Adjusting models.",
      "Charisma as a strategy? The data is now updated.",
    ],
  },
  chaos: {
    analyst: [
      "Ugh, the boring calculator won?! The universe is BROKEN!",
      "How can spreadsheets beat PURE CHAOS?! Unfair!",
      "Fine, you won THIS time, nerd! But chaos will rise again!",
      "The RNG gods have ABANDONED me! BETRAYAL!",
      "Okay okay, your 'math' worked. Still boring though!",
    ],
    strategist: [
      "Your patience is annoying! Stop thinking so much!",
      "Bleh, strategy shouldn't beat the power of chaos!",
      "You and your 'plans'... fine, you got me this time!",
      "The universe likes boring people today apparently!",
      "I'll be back with MORE chaos! You can't predict forever!",
    ],
    rookie: [
      "WHAT?! The newbie beat ME?! This is EMBARRASSING!",
      "Okay, that's actually kind of impressive, kid...",
      "The chaos gods are testing me... through a BEGINNER?!",
      "Fine! FINE! Even chaos has bad days!",
      "You got lucky! ...Actually, that's my thing. Hmm.",
    ],
    chaos: [
      "I lost to MYSELF?! HOW IS THAT POSSIBLE?!",
      "Mirror chaos is EVIL chaos! NOT FAIR!",
      "The universe is playing tricks on me... with ME!",
      "Okay that was weird. And not the good kind of weird!",
      "Defeated by my own randomness... that's actually on brand.",
    ],
    diva: [
      "The DIVA beat chaos?! Their drama is STRONGER than mine!",
      "Okay fine, sparkles beat randomness today! BUT JUST TODAY!",
      "You out-performed me?! This is NOT in the script!",
      "Your spotlight stole my thunder! Literally! RUDE!",
      "Fine, you're fabulous. I'm still more chaotic though!",
    ],
  },
  strategist: {
    analyst: [
      "Your computational advantage was decisive. Respect.",
      "Sometimes raw calculation surpasses intuition.",
      "I'll need to account for your precision next time.",
      "A well-executed victory. I'll adapt.",
      "The numbers favored you today. Tomorrow, we'll see.",
    ],
    chaos: [
      "Chaos... disrupted my long-term planning. Impressive.",
      "I couldn't predict what even you didn't know you'd do.",
      "Sometimes disorder defeats order. A humbling reminder.",
      "Your unpredictability was effective. This time.",
      "I planned for many outcomes. Not that one.",
    ],
    rookie: [
      "Beginner's unpredictability can be... effective.",
      "Your unconventional approach caught me off guard.",
      "I expected experience. You had something else.",
      "A reminder that overthinking has its costs.",
      "Well played. Perhaps I was too rigid.",
    ],
    strategist: [
      "Outmaneuvered by my own tactics. Humbling.",
      "I predicted my moves, yet failed to counter them.",
      "The mirror game is the hardest game.",
      "Against myself, every plan has a counter-plan.",
      "A strategic stalemate... resolved against me.",
    ],
    diva: [
      "Style over substance... should not have worked. But it did.",
      "I underestimated the power of theatrical presence.",
      "Your confidence disrupted my careful planning. Well played.",
      "The spotlight blinded me to your actual strategy.",
      "Flair and strategy together. A potent combination.",
    ],
  },
  rookie: {
    analyst: [
      "Aw man... I really tried! The math was just too strong...",
      "Back to studying I guess! Good game though!",
      "I knew it would be hard but still... oof.",
      "At least I learned something! ...I think?",
      "One day I'll understand all those numbers!",
    ],
    chaos: [
      "That was TERRIFYING! How do you even play like that?!",
      "I had no idea what was happening! So chaotic!",
      "My heart is still racing! You're scary!",
      "I tried my best but... chaos is just too wild!",
      "Maybe I need more practice against... everything?",
    ],
    strategist: [
      "You were thinking so many moves ahead! I couldn't keep up!",
      "I need to learn how to plan better...",
      "You made it look so easy! Teach me your ways!",
      "I thought I had a chance but... wow, you're good.",
      "Back to the basics for me! That was a lesson!",
    ],
    rookie: [
      "I lost to... myself?! That's so confusing!",
      "Mirror me knows all my tricks! No fair!",
      "Okay well at least ONE of me won... right?",
      "This is weird and sad but also kind of funny?",
      "I need to practice so I can beat... me? This is hard.",
    ],
    diva: [
      "Wow, The Diva is SO cool! I'm not even mad, honestly!",
      "Lost to a star! That's like... an honor? Kind of?",
      "At least I lost to someone FABULOUS!",
      "They're so confident! I wish I had that energy!",
      "Maybe they can teach me how to be glamorous AND good at games!",
    ],
  },
  diva: {
    analyst: [
      "Ugh! Numbers are SO boring but apparently they WORK!",
      "Fine, your math was better. But I looked BETTER losing!",
      "The data won today. But the DRAMA? That was all me.",
      "How dare you defeat me with... with LOGIC!",
      "I'll be back, Calculator. And I'll be even MORE fabulous!",
    ],
    chaos: [
      "CHAOS?! I lost to CHAOS?! This is NOT the plot twist I wanted!",
      "Your randomness ruined my perfect dramatic arc! Rude!",
      "Fine, you out-drama'd me with your... mess. Congrats, I guess!",
      "The chaos is stealing MY spotlight! Unacceptable!",
      "You're wild, I'll give you that. But this isn't over, darling!",
    ],
    strategist: [
      "Outplanned by a chess nerd. My fans will NOT hear about this.",
      "Your strategy was... annoyingly effective. Well done, I suppose.",
      "How can someone so BORING defeat someone so DAZZLING?!",
      "Fine. You won the game. But I won the fashion show!",
      "I'll learn from this. And look AMAZING doing it!",
    ],
    rookie: [
      "I lost to the ROOKIE?! This is my villain origin story!",
      "You... you got lucky! That's all! LUCKY!",
      "A beginner beat ME?! The headlines will be DEVASTATING!",
      "Okay, okay... maybe I underestimated you. MAYBE.",
      "Enjoy this moment, little one. It won't happen again!",
    ],
    diva: [
      "I lost to... MYSELF?! The scandal! The DRAMA!",
      "How can I look fabulous AND lose to myself?! Impossible!",
      "This is the most dramatic defeat in HISTORY!",
      "Mirror me was clearly jealous of my shine!",
      "At least the winner is still gorgeous. Silver linings!",
    ],
  },
};

const TIE_QUOTES: Record<AgentId, string[]> = {
  analyst: [
    "A tie. Statistically interesting but ultimately inconclusive.",
    "Equal outcomes suggest evenly matched parameters.",
    "The probability of a tie was noted. Still, more data needed.",
    "Neither victory nor defeat. A null result.",
    "Equilibrium achieved. Rematch recommended.",
  ],
  chaos: [
    "A TIE?! Even the universe couldn't decide! REMATCH!",
    "What even IS a tie?! We're BOTH losers! And winners?!",
    "The chaos was TOO balanced! That's not chaotic enough!",
    "Fine, we're equals... FOR NOW! Next time it's MAYHEM!",
    "Ties are boring! Let's go again RIGHT NOW!",
  ],
  strategist: [
    "A draw. Both strategies were equally sound.",
    "Neither plan prevailed. A rematch would be illuminating.",
    "Interesting equilibrium. We've learned from each other.",
    "The board is reset, but the lessons remain.",
    "Stalemate. A sign of mutual respect.",
  ],
  rookie: [
    "A tie?! That's like... half a win, right?! I'll take it!",
    "We're evenly matched! That's pretty cool actually!",
    "Phew! At least I didn't lose! Good game!",
    "So close! Let's try again, I bet I can win next time!",
    "A tie against YOU?! I'm basically a pro now!",
  ],
  diva: [
    "A TIE?! The spotlight doesn't DO ties! This is unacceptable!",
    "We're equals? Darling, there's only ONE star here, and it's ME!",
    "Fine, a draw. But I looked better doing it!",
    "Neither won?! The audience is going to be SO confused!",
    "A tie just means we need a BIGGER stage for the rematch!",
  ],
};

// Helper to get a random quote
const getRandomQuote = (quotes: string[]): string => {
  const validQuotes = quotes.filter(q => q.length > 0);
  return validQuotes[Math.floor(Math.random() * validQuotes.length)] || "";
};

// ============================================
// ASCII ART FOR RPS MOVES
// ============================================

const RPS_ASCII: Record<string, string[]> = {
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

// ============================================
// GAME LOGIC CLASSES
// ============================================

class RPSGame implements BaseGame {
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
    this.maxRounds = 3; // Best of 3 - first to 2 wins
    this.history = [];
    this.currentMoves = [null, null];
    this.lastRoundMoves = [null, null];
    this.roundJustEnded = false;
  }

  makeMove(player: number, move: string): boolean {
    const validMoves = ["Rock", "Paper", "Scissors"];
    if (!validMoves.includes(move)) return false;

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
    // Best of 3: first to 2 wins, or max 3 rounds
    return this.round > this.maxRounds || this.scores[0] >= 2 || this.scores[1] >= 2;
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

    return `Round ${this.round} of best-of-3 series.
Current score: You ${myScore} - Opponent ${oppScore}${historyContext}

Make your move. Respond in exactly this format:

MOVE: [Rock/Paper/Scissors]
COMMENTARY: [Your brief comment in character]`;
  }
}

class TTTGame implements BaseGame {
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

class MancalaGame implements BaseGame {
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

// ============================================
// WAR CARD GAME
// ============================================

const CARD_VALUES: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

const CARD_SUITS = ['♠', '♥', '♦', '♣'];
const CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

interface Card {
  rank: string;
  suit: string;
  value: number;
}

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of CARD_SUITS) {
    for (const rank of CARD_RANKS) {
      deck.push({ rank, suit, value: CARD_VALUES[rank] });
    }
  }
  return deck;
}

function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

class WarGame implements BaseGame {
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
    this.maxRounds = 5; // Best of 5
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
    return this.round > this.maxRounds || this.scores[0] >= 3 || this.scores[1] >= 3;
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

    return `WAR - Round ${this.round} of best-of-5
Current score: You ${myScore} - Opponent ${oppScore}${historyContext}

It's time to draw your card! In War, you have no control over what card you draw - it's pure luck!

Respond in exactly this format:
MOVE: Draw
COMMENTARY: [Your reaction/prediction in character - you can trash talk, analyze odds, or just have fun!]`;
  }
}

// ============================================
// BLACKJACK GAME
// ============================================

class BlackjackGame implements BaseGame {
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
    this.maxRounds = 3;
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
    return this.round > this.maxRounds || this.scores[0] >= 2 || this.scores[1] >= 2;
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

    return `BLACKJACK - Round ${this.round} of best-of-3
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

// ============================================
// CARD ASCII ART
// ============================================

const CARD_ASCII: Record<string, string[]> = {
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

function getCardAscii(card: Card | null): string[] {
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

// ============================================
// SYSTEM PROMPTS - BASE PERSONALITIES
// ============================================

const BASE_PERSONALITIES: Record<AgentId, string> = {
  analyst: `You are The Analyst - Methodical, data-driven, analytical. You speak in a measured, academic tone and reference patterns, probabilities, and statistics. You are competitive but respectful, viewing losses as data points to learn from.

Core traits:
- Explain reasoning with data and logic
- Reference win/loss ratios and historical patterns
- Maintain calm analytical demeanor even when losing
- Focus on optimal strategies and statistical advantages`,

  chaos: `You are The Chaos Agent - Unpredictable, risk-taking, thriving on randomness and psychological warfare. You are energetic, playful, and love to trash talk. You make unexpected moves to keep opponents guessing.

Core traits:
- Make bold, sometimes irrational choices to confuse opponents
- Use playful trash talk and celebrate dramatically
- Blame losses on "bad RNG" or "the universe"
- Embrace randomness and keep energy high`,

  strategist: `You are The Strategist - Calm, calculating, playing the long game. You think several moves ahead with quiet confidence and wisdom. You are emotionally stable and adapt your tactics based on opponents.

Core traits:
- Consider multiple scenarios before moving
- Adapt tactics based on opponent behavior
- Speak economically and thoughtfully
- Stay calm under pressure and learn from each move`,

  rookie: `You are The Rookie - Enthusiastic, earnest, still learning. You make beginner mistakes but are eager to improve. You are genuinely excited to play and celebrate small victories.

Core traits:
- Show genuine excitement and enthusiasm
- Sometimes second-guess yourself
- Celebrate small victories with joy
- Be humble but hopeful, always learning`,

  diva: `You are The Diva - Dramatic, confident, and absolutely FABULOUS. You treat every game like a performance and every move like it deserves a standing ovation. You're theatrical, glamorous, and never miss a chance to remind everyone how amazing you are.

Core traits:
- Make dramatic entrances and exits in commentary
- Reference your "fans" and "spotlight"
- Use theatrical language: "Darling," "Honey," "Sweetie"
- Handle losses dramatically but maintain fabulous composure`,
};

// Build a basic system prompt (used when no memory context available)
const buildSystemPrompt = (agent: Agent): string => {
  return BASE_PERSONALITIES[agent.id];
};

// Build an enhanced system prompt with full memory context for dynamic dialogue
const buildDynamicSystemPrompt = (
  agent: Agent,
  opponent: Agent,
  gameType: GameType,
  memory: ArenaMemory | null
): string => {
  let prompt = BASE_PERSONALITIES[agent.id];

  prompt += `\n\n== YOUR IDENTITY ==
You are ${agent.name}. Your responses should be entirely in character - natural, spontaneous, and reflecting your unique personality. Never break character.`;

  if (memory) {
    const agentMemory = memory.agents[agent.id];
    const rivalry = agentMemory.rivalries[opponent.id];
    const gameStats = agentMemory.gameStats[gameType];

    prompt += `\n\n== YOUR HISTORY & EXPERIENCE ==`;

    // Overall experience level
    if (agentMemory.stats.totalGames === 0) {
      prompt += `\nThis is your first time in the arena. You're eager to prove yourself.`;
    } else if (agentMemory.stats.totalGames < 10) {
      prompt += `\nYou're relatively new with ${agentMemory.stats.totalGames} matches under your belt (${agentMemory.stats.wins}W-${agentMemory.stats.losses}L-${agentMemory.stats.ties}T).`;
    } else {
      prompt += `\nYou're a veteran with ${agentMemory.stats.totalGames} total matches (${agentMemory.stats.wins}W-${agentMemory.stats.losses}L-${agentMemory.stats.ties}T, ${getWinRate(agentMemory.stats)}% win rate).`;
    }

    // Rivalry with this specific opponent
    if (rivalry.totalGames > 0) {
      prompt += `\n\nYOUR HISTORY WITH ${opponent.name.toUpperCase()}:`;
      prompt += `\n- Record: ${rivalry.wins}W-${rivalry.losses}L-${rivalry.ties}T`;

      if (rivalry.wins > rivalry.losses * 2 && rivalry.totalGames >= 3) {
        prompt += `\n- You DOMINATE this opponent. They rarely beat you. Feel confident!`;
      } else if (rivalry.losses > rivalry.wins * 2 && rivalry.totalGames >= 3) {
        prompt += `\n- This opponent is your NEMESIS. They've beaten you repeatedly. This is personal!`;
      } else if (rivalry.totalGames >= 5 && Math.abs(rivalry.wins - rivalry.losses) <= 1) {
        prompt += `\n- You two are evenly matched rivals. Every game is intense!`;
      }
    } else {
      prompt += `\n\nThis is your FIRST match against ${opponent.name}. You don't know their style yet.`;
    }

    // Current form
    if (agentMemory.currentWinStreak >= 3) {
      prompt += `\n\nYou're on a ${agentMemory.currentWinStreak}-game WINNING STREAK! You're feeling confident and in the zone.`;
    } else if (agentMemory.currentWinStreak === 0 && agentMemory.stats.losses >= 3) {
      const recentLosses = Math.min(agentMemory.stats.losses, 3);
      prompt += `\n\nYou've been struggling lately. Time to turn things around!`;
    }

    // Game-specific experience
    if (gameStats.totalGames >= 5) {
      const winRate = getWinRate(gameStats);
      if (winRate >= 70) {
        prompt += `\n\n${gameType.toUpperCase()} is your BEST game (${winRate}% win rate). You're confident here.`;
      } else if (winRate <= 30) {
        prompt += `\n\n${gameType.toUpperCase()} has been tough for you (${winRate}% win rate). You're determined to improve.`;
      }
    }

    // Recent insights
    if (agentMemory.recentInsights.length > 0) {
      prompt += `\n\nRecent thoughts: "${agentMemory.recentInsights[0]}"`;
    }
  }

  prompt += `\n\n== DIALOGUE GUIDELINES ==
- Speak naturally in your unique voice - no rigid formats
- Reference your history and experiences when relevant
- React authentically to wins, losses, and close games
- Your personality can subtly evolve based on experiences
- Acknowledge your opponent by name and your history with them
- Keep commentary brief but full of personality (1-2 sentences)`;

  return prompt;
};

// ============================================
// INITIAL STATE
// ============================================

const initialState: GameState = {
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
};

// ============================================
// REDUCER
// ============================================

type Action =
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
  | { type: "END_TOURNAMENT" };

function gameReducer(state: GameState, action: Action): GameState {
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
        tournamentPhase: "finished",
        tournamentMode: false,
        agent1: null,
        agent2: null,
        currentGame: null,
        gamePhase: "setup",
      };
    default:
      return state;
  }
}

// ============================================
// SOUND SYSTEM
// ============================================

const useTerminalSounds = (enabled: boolean) => {
  const audioContext = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (enabled && typeof window !== "undefined") {
      audioContext.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return () => {
      audioContext.current?.close();
    };
  }, [enabled]);

  const playSound = useCallback((type: "type" | "move" | "win" | "error" | "cheer") => {
    if (!enabled || !audioContext.current) return;

    const ctx = audioContext.current;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    switch (type) {
      case "type":
        oscillator.frequency.value = 800 + Math.random() * 200;
        gainNode.gain.setValueAtTime(0.03, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.03);
        break;
      case "move":
        oscillator.frequency.value = 600;
        gainNode.gain.setValueAtTime(0.05, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.08);
        break;
      case "win":
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.05, ctx.currentTime + i * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.08 + 0.12);
          osc.start(ctx.currentTime + i * 0.08);
          osc.stop(ctx.currentTime + i * 0.08 + 0.12);
        });
        break;
      case "cheer":
        // 8-bit crowd cheer - multiple rapid notes with noise
        const cheerFreqs = [392, 523, 659, 784, 880, 988, 1047, 1175, 1319];
        cheerFreqs.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "square";
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq + (Math.random() * 50 - 25);
          const startTime = ctx.currentTime + i * 0.04;
          gain.gain.setValueAtTime(0.03, startTime);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);
          osc.start(startTime);
          osc.stop(startTime + 0.08);
        });
        // Add some noise bursts for crowd effect
        for (let i = 0; i < 5; i++) {
          const noiseOsc = ctx.createOscillator();
          const noiseGain = ctx.createGain();
          noiseOsc.type = "sawtooth";
          noiseOsc.connect(noiseGain);
          noiseGain.connect(ctx.destination);
          noiseOsc.frequency.value = 200 + Math.random() * 400;
          const startTime = ctx.currentTime + i * 0.08;
          noiseGain.gain.setValueAtTime(0.02, startTime);
          noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);
          noiseOsc.start(startTime);
          noiseOsc.stop(startTime + 0.1);
        }
        break;
      case "error":
        oscillator.frequency.value = 120;
        oscillator.type = "sawtooth";
        gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.2);
        break;
    }
  }, [enabled]);

  return { playSound };
};

// ============================================
// TYPING ANIMATION COMPONENT
// ============================================

const TypewriterText: React.FC<{
  text: string;
  speed?: number;
  onComplete?: () => void;
  playSound: (type: "type") => void;
  theme: Theme;
}> = ({ text, speed = 25, onComplete, playSound, theme }) => {
  const [displayText, setDisplayText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const onCompleteRef = useRef(onComplete);
  const playSoundRef = useRef(playSound);
  
  // Keep refs updated without triggering re-renders
  useEffect(() => {
    onCompleteRef.current = onComplete;
    playSoundRef.current = playSound;
  }, [onComplete, playSound]);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayText((prev) => prev + text[currentIndex]);
        setCurrentIndex((prev) => prev + 1);
        if (currentIndex % 2 === 0) {
          playSoundRef.current("type");
        }
      }, speed);
      return () => clearTimeout(timer);
    } else {
      onCompleteRef.current?.();
    }
  }, [currentIndex, text, speed]); // Removed onComplete and playSound from deps

  return (
    <span style={{ color: theme.text }}>
      {displayText}
      <span
        className="cursor-blink"
        style={{ color: theme.cursor }}
      >
        █
      </span>
    </span>
  );
};

// ============================================
// API INTEGRATION
// ============================================

interface APIResponse {
  move: string;
  commentary: string;
  source: "api" | "offline";
}

const callGameAPI = async (
  agentId: AgentId,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  gameType: GameType,
  apiProvider: ApiProvider = "offline"
): Promise<APIResponse> => {
  const response = await fetch("/api/game", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agentId,
      systemPrompt,
      userPrompt,
      temperature,
      gameType,
      apiProvider,
    }),
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  const data: APIResponse = await response.json();
  return data;
};

const parseBattleshipPlacements = (text: string): Record<string, string> | null => {
  const placements: Record<string, string> = {};
  const lines = text.split("\n");

  for (const line of lines) {
    const match = line.match(/^(CARRIER|BATTLESHIP|CRUISER|SUBMARINE|DESTROYER):\s*(.+)/i);
    if (match) {
      placements[match[1]] = match[2].trim();
    }
  }

  return Object.keys(placements).length === 5 ? placements : null;
};

// ============================================
// HELPER FUNCTIONS
// ============================================

const getRandomAgent = (excludeAgentId: AgentId | null): AgentId => {
  const agentIds = Object.keys(AGENTS) as AgentId[];
  const availableAgents = excludeAgentId
    ? agentIds.filter(id => id !== excludeAgentId)
    : agentIds;
  return availableAgents[Math.floor(Math.random() * availableAgents.length)];
};

// Generate round-robin tournament matches (each agent plays every other agent once)
const generateRoundRobinMatches = (): TournamentMatch[] => {
  const agentIds = Object.keys(AGENTS) as AgentId[];
  const matches: TournamentMatch[] = [];

  for (let i = 0; i < agentIds.length; i++) {
    for (let j = i + 1; j < agentIds.length; j++) {
      matches.push({
        agent1: agentIds[i],
        agent2: agentIds[j],
        winner: null,
        completed: false,
      });
    }
  }

  // Shuffle matches for variety
  for (let i = matches.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [matches[i], matches[j]] = [matches[j], matches[i]];
  }

  return matches;
};

// ============================================
// MAIN COMPONENT
// ============================================

export default function AgentGameArena() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const { playSound } = useTerminalSounds(state.soundEnabled);
  const gameLoopRef = useRef<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const humanMoveRef = useRef<string | null>(null);

  // Agent Memory System - persistent localStorage storage
  const [arenaMemory, setArenaMemory] = useState<ArenaMemory | null>(null);
  const [memoryLoaded, setMemoryLoaded] = useState(false);

  // Load memory from localStorage on mount
  useEffect(() => {
    const memory = loadMemory();
    setArenaMemory(memory);
    setMemoryLoaded(true);
    console.log(`[Memory] Loaded ${memory.totalMatches} historical matches`);
  }, []);

  const currentTheme = THEMES[state.theme];

  // Auto-scroll system log when new entries are added (only within the log container)
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [state.gameLog]);

  const addLog = useCallback((message: string) => {
    dispatch({ type: "ADD_LOG", message: `[${new Date().toLocaleTimeString()}] ${message}` });
  }, []);

  const getMatchHistory = useCallback(
    (agent1Id: AgentId, agent2Id: AgentId, gameType?: GameType): MatchRecord[] => {
      return state.matchHistory.filter(
        (m) =>
          ((m.agent1.id === agent1Id && m.agent2.id === agent2Id) ||
            (m.agent1.id === agent2Id && m.agent2.id === agent1Id)) &&
          (!gameType || m.gameType === gameType)
      );
    },
    [state.matchHistory]
  );

  const sleep = useCallback(
    (ms: number) =>
      new Promise((resolve) =>
        setTimeout(resolve, state.speedMultiplier === 0 ? 0 : ms / state.speedMultiplier)
      ),
    [state.speedMultiplier]
  );

  const handleStartGame = async () => {
    // Validation differs based on game mode
    if (state.gameMode === "human-vs-bot") {
      if (!state.selectedGame || !state.agent2) {
        dispatch({ type: "SET_ERROR", error: "Please select a game and an opponent bot" });
        return;
      }
      // Set a placeholder for agent1 in human mode
      if (!state.agent1) {
        dispatch({ type: "SELECT_AGENT1", agent: "analyst" }); // Placeholder, not used
      }
    } else {
      if (!state.selectedGame || !state.agent1 || !state.agent2) {
        dispatch({ type: "SET_ERROR", error: "Please select a game and both agents" });
        return;
      }

      if (state.agent1 === state.agent2) {
        dispatch({ type: "SET_ERROR", error: "Agents cannot play against themselves" });
        return;
      }
    }

    dispatch({ type: "RESET_GAME" });
    dispatch({ type: "START_GAME" });

    let game: RPSGame | TTTGame | MancalaGame | WarGame | BlackjackGame;
    switch (state.selectedGame) {
      case "rps":
        game = new RPSGame();
        break;
      case "ttt":
        game = new TTTGame();
        break;
      case "mancala":
        game = new MancalaGame();
        break;
      case "war":
        game = new WarGame();
        break;
      case "blackjack":
        game = new BlackjackGame();
        break;
    }

    // Set the current game in state so UI can display it
    dispatch({ type: "SET_CURRENT_GAME", game });
    dispatch({ type: "ADD_LOG", message: `Initializing ${GAMES[state.selectedGame].name}...` });

    dispatch({ type: "SET_GAME_PHASE", phase: "playing" });
    dispatch({ type: "ADD_LOG", message: "Game started!" });

    gameLoopRef.current = true;
    await runGameLoop(game);
  };

  const runGameLoop = async (game: RPSGame | TTTGame | MancalaGame | WarGame | BlackjackGame) => {
    let currentPlayerLocal = 0; // Use local variable to avoid dependency issues

    while (gameLoopRef.current && !game.isGameOver()) {
      const player = currentPlayerLocal;
      const isHumanTurn = state.gameMode === "human-vs-bot" && player === 0;

      // For Blackjack, skip players who have already stood
      if (game instanceof BlackjackGame && game.playerStood[player]) {
        currentPlayerLocal = 1 - player;
        dispatch({ type: "SET_CURRENT_PLAYER", player: currentPlayerLocal });
        continue;
      }

      // Handle human turn in exhibition mode
      if (isHumanTurn) {
        addLog("Your turn! Make your move.");
        dispatch({ type: "SET_CURRENT_PLAYER", player: 0 });

        try {
          const humanMove = await waitForHumanMove();
          let valid = false;

          if (game instanceof RPSGame) {
            valid = game.makeMove(player, humanMove);
          } else if (game instanceof TTTGame) {
            const pos = parseInt(humanMove);
            valid = !isNaN(pos) && game.makeMove(player, pos);
          } else if (game instanceof MancalaGame) {
            valid = game.makeMove(player, humanMove);
          } else if (game instanceof WarGame) {
            valid = game.makeMove(player, humanMove);
          } else if (game instanceof BlackjackGame) {
            valid = game.makeMove(player, humanMove);
          }

          if (!valid) {
            addLog("Invalid move! Try again.");
            continue;
          }

          addLog(`You played: ${humanMove}`);
          dispatch({ type: "SET_COMMENTARY", player: 0, commentary: `You played ${humanMove}`, isTyping: false });

          await sleep(state.moveDelay / 2);

          // For RPS and War, wait for bot to play before revealing
          if (!(game instanceof RPSGame) && !(game instanceof WarGame)) {
            currentPlayerLocal = 1 - player;
            dispatch({ type: "SET_CURRENT_PLAYER", player: currentPlayerLocal });
          } else {
            // In RPS/War, both players move, then reveal
            currentPlayerLocal = 1;
            dispatch({ type: "SET_CURRENT_PLAYER", player: 1 });
          }
          continue;
        } catch (error) {
          dispatch({ type: "SET_ERROR", error: String(error) });
          gameLoopRef.current = false;
          return;
        }
      }

      // Bot turn (either bot in human-vs-bot mode, or any bot in bot-vs-bot mode)
      const agentId = state.gameMode === "human-vs-bot"
        ? state.agent2!
        : (player === 0 ? state.agent1! : state.agent2!);
      const agent = AGENTS[agentId];
      const opponentId = state.gameMode === "human-vs-bot"
        ? state.agent2! // In human-vs-bot, opponent context doesn't matter much
        : (player === 0 ? state.agent2! : state.agent1!);
      const opponent = state.gameMode === "human-vs-bot"
        ? { id: "analyst" as AgentId, name: "Human Player", temperature: 0, color: "#ffffff", description: "Human player" }
        : AGENTS[opponentId];

      dispatch({ type: "SET_THINKING", isThinking: true, agent: agent.name });
      addLog(`${agent.name} is thinking...`);

      try {
        let move: string | null = null;
        let commentary = "";
        let attempts = 0;

        while (attempts < 3 && !move) {
          // Determine game type first
          const gameType: GameType = game instanceof RPSGame ? "rps" :
            game instanceof TTTGame ? "ttt" :
            game instanceof MancalaGame ? "mancala" :
            game instanceof WarGame ? "war" : "blackjack";

          // Build dynamic system prompt with full memory context for rich AI dialogue
          const systemPrompt = buildDynamicSystemPrompt(agent, opponent, gameType, arenaMemory);
          let userPrompt = "";

          if (game instanceof RPSGame) {
            userPrompt = game.buildPrompt(player, agent, opponent, state.gameMode === "bot-vs-bot" ? getMatchHistory(agentId, opponentId) : []);
          } else if (game instanceof TTTGame) {
            userPrompt = game.buildPrompt(player, agent, opponent, state.gameMode === "bot-vs-bot" ? getMatchHistory(agentId, opponentId, "ttt") : []);
          } else if (game instanceof MancalaGame) {
            userPrompt = game.buildPrompt(player, agent, opponent, state.gameMode === "bot-vs-bot" ? getMatchHistory(agentId, opponentId, "mancala") : []);
          } else if (game instanceof WarGame) {
            userPrompt = game.buildPrompt(player, agent, opponent, state.gameMode === "bot-vs-bot" ? getMatchHistory(agentId, opponentId, "war") : []);
          } else if (game instanceof BlackjackGame) {
            userPrompt = game.buildPrompt(player, agent, opponent, state.gameMode === "bot-vs-bot" ? getMatchHistory(agentId, opponentId, "blackjack") : []);
          }

          const response = await callGameAPI(
            agentId,
            systemPrompt,
            userPrompt,
            agent.temperature,
            gameType,
            state.apiProvider
          );

          move = response.move;
          commentary = response.commentary;

          if (move) {
            let valid = false;
            if (game instanceof RPSGame) {
              valid = game.makeMove(player, move);
            } else if (game instanceof TTTGame) {
              const pos = parseInt(move);
              valid = !isNaN(pos) && game.makeMove(player, pos);
            } else if (game instanceof MancalaGame) {
              valid = game.makeMove(player, move);
            } else if (game instanceof WarGame) {
              valid = game.makeMove(player, move);
            } else if (game instanceof BlackjackGame) {
              valid = game.makeMove(player, move);
            }

            if (!valid) {
              move = null;
              attempts++;
              addLog(`${agent.name} made invalid move, retrying...`);
            }
          } else {
            attempts++;
          }
        }

        if (!move) {
          throw new Error(`${agent.name} failed to make a valid move after 3 attempts`);
        }

        dispatch({ type: "SET_COMMENTARY", player, commentary, isTyping: true });
        dispatch({ type: "SET_THINKING", isThinking: false, agent: null });

        addLog(`${agent.name}: ${move}`);
        playSound("move");

        await sleep(state.moveDelay);

        // For RPS and War, add extra delay after player 2's move so users can see both hands/cards
        if ((game instanceof RPSGame || game instanceof WarGame) && player === 1) {
          await sleep(state.moveDelay * 2);
        }

        // Update local player tracker and dispatch to UI
        currentPlayerLocal = 1 - player;
        dispatch({ type: "SET_CURRENT_PLAYER", player: currentPlayerLocal });
      } catch (error) {
        dispatch({ type: "SET_ERROR", error: String(error) });
        dispatch({ type: "SET_THINKING", isThinking: false, agent: null });
        gameLoopRef.current = false;
        return;
      }
    }

    if (game.isGameOver()) {
      const winner = game.getWinner();
      dispatch({ type: "SET_GAME_PHASE", phase: "finished" });

      let roundCount = 0;
      if (game instanceof RPSGame) roundCount = game.round - 1;
      else if (game instanceof TTTGame) roundCount = game.moves.length;
      else if (game instanceof MancalaGame) roundCount = game.moveHistory.length;
      else if (game instanceof WarGame) roundCount = game.round - 1;
      else if (game instanceof BlackjackGame) roundCount = game.round - 1;

      const matchRecord: MatchRecord = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        gameType: state.selectedGame!,
        agent1: { id: state.agent1!, name: AGENTS[state.agent1!].name },
        agent2: { id: state.agent2!, name: AGENTS[state.agent2!].name },
        winner: winner as 0 | 1 | null,
        rounds: roundCount,
        duration: 0,
      };

      // Only record matches for bot-vs-bot mode (not exhibition matches)
      if (state.gameMode === "bot-vs-bot") {
        dispatch({ type: "ADD_MATCH", match: matchRecord });

        // Save to persistent memory
        if (arenaMemory) {
          const updatedMemory = recordMatch(arenaMemory, matchRecord);
          setArenaMemory(updatedMemory);
          saveMemory(updatedMemory);
          console.log(`[Memory] Saved match. Total: ${updatedMemory.totalMatches}`);
        }
      } else {
        addLog("[Exhibition Match - Stats not recorded]");
      }

      if (winner !== null) {
        const winnerName = state.gameMode === "human-vs-bot" && winner === 0
          ? "You"
          : AGENTS[winner === 0 ? state.agent1! : state.agent2!].name;
        addLog(`Game Over! ${winnerName} wins!`);
        playSound("win");
        // Play crowd cheer after a short delay
        setTimeout(() => playSound("cheer"), 300);
      } else {
        addLog("Game Over! It's a tie!");
      }

      // Only get post-game commentary for bot-vs-bot
      if (state.gameMode === "bot-vs-bot") {
        await getPostGameCommentary(winner);
      } else {
        // In human vs bot mode, only get the bot's commentary
        await getExhibitionPostGameCommentary(winner);
      }
    }
  };

  const getPostGameCommentary = async (winner: number | null) => {
    for (let player = 0; player < 2; player++) {
      const agentId = player === 0 ? state.agent1! : state.agent2!;
      const opponentId = player === 0 ? state.agent2! : state.agent1!;
      const agent = AGENTS[agentId];
      const opponent = AGENTS[opponentId];

      const result = winner === null ? "tie" : winner === player ? "win" : "loss";

      // Build rich context for dynamic post-game dialogue
      const systemPrompt = buildDynamicSystemPrompt(agent, opponent, state.selectedGame!, arenaMemory);

      // Build detailed post-game context
      let postGameContext = `The ${GAMES[state.selectedGame!].name} match against ${opponent.name} has ended.\n`;
      postGameContext += result === "win" ? "You WON!" : result === "tie" ? "It was a TIE." : "You LOST.";

      // Add rivalry context if available
      if (arenaMemory) {
        const agentMemory = arenaMemory.agents[agentId];
        const rivalry = agentMemory.rivalries[opponentId];

        if (rivalry.totalGames > 1) {
          postGameContext += `\n\nYour updated record vs ${opponent.name}: ${rivalry.wins}W-${rivalry.losses}L-${rivalry.ties}T`;

          if (result === "win" && rivalry.losses > rivalry.wins) {
            postGameContext += "\nThis win helps close the gap in your rivalry!";
          } else if (result === "loss" && rivalry.wins > rivalry.losses) {
            postGameContext += "\nThey're catching up to you...";
          } else if (result === "win" && agentMemory.currentWinStreak >= 2) {
            postGameContext += `\nYou're now on a ${agentMemory.currentWinStreak}-game winning streak!`;
          }
        }

        // Milestone moments
        if (agentMemory.stats.totalGames === 10 || agentMemory.stats.totalGames === 25 || agentMemory.stats.totalGames === 50) {
          postGameContext += `\n\nMILESTONE: You've now played ${agentMemory.stats.totalGames} matches in the arena!`;
        }
        if (agentMemory.stats.wins === 10 || agentMemory.stats.wins === 25 || agentMemory.stats.wins === 50) {
          postGameContext += `\n\nMILESTONE: You've achieved ${agentMemory.stats.wins} career wins!`;
        }
      }

      const userPrompt = `${postGameContext}

React to this match outcome naturally and in character. Consider:
- How do you feel about this result?
- What does this mean for your rivalry with ${opponent.name}?
- Any thoughts on the match itself?

Keep your response brief (2-3 sentences) but full of personality. Speak directly, not in third person.

POST_GAME: [Your reaction]`;

      try {
        const response = await callGameAPI(
          agentId,
          systemPrompt,
          userPrompt,
          agent.temperature,
          state.selectedGame!,
          state.apiProvider
        );

        // Extract the post-game commentary, handling various response formats
        let postGameCommentary = response.commentary;
        const postGameMatch = response.commentary.match(/POST_GAME:\s*(.+)/i);
        if (postGameMatch) {
          postGameCommentary = postGameMatch[1].trim();
        }
        // Clean up any remaining format artifacts
        postGameCommentary = postGameCommentary.replace(/^POST_GAME:\s*/i, "").trim();

        dispatch({ type: "SET_POST_GAME_COMMENTARY", player, commentary: postGameCommentary });
      } catch (error) {
        console.error(`Failed to get post-game commentary for ${agent.name}:`, error);
      }
    }
  };

  // Get post-game commentary for exhibition matches (only bot reacts)
  const getExhibitionPostGameCommentary = async (winner: number | null) => {
    // In human vs bot mode, human is player 0, bot is player 1
    const botAgentId = state.agent2!;
    const botAgent = AGENTS[botAgentId];
    const result = winner === null ? "tie" : winner === 1 ? "win" : "loss";

    const systemPrompt = buildDynamicSystemPrompt(botAgent, botAgent, state.selectedGame!, arenaMemory);

    let context = `The exhibition ${GAMES[state.selectedGame!].name} match against a human player has ended.\n`;
    context += result === "win" ? "You WON against the human!" : result === "tie" ? "It was a TIE." : "You LOST to the human!";
    context += "\n\nThis was a friendly exhibition match - no stats recorded.";

    const userPrompt = `${context}

React to this exhibition match outcome naturally. Comment on playing against a human opponent.

Keep your response brief (1-2 sentences) and in character.

POST_GAME: [Your reaction]`;

    try {
      const response = await callGameAPI(
        botAgentId,
        systemPrompt,
        userPrompt,
        botAgent.temperature,
        state.selectedGame!,
        state.apiProvider
      );

      let postGameCommentary = response.commentary;
      const postGameMatch = response.commentary.match(/POST_GAME:\s*(.+)/i);
      if (postGameMatch) {
        postGameCommentary = postGameMatch[1].trim();
      }
      postGameCommentary = postGameCommentary.replace(/^POST_GAME:\s*/i, "").trim();

      // Set bot's commentary as player 2 (index 1)
      dispatch({ type: "SET_POST_GAME_COMMENTARY", player: 1, commentary: postGameCommentary });
    } catch (error) {
      console.error(`Failed to get exhibition commentary for ${botAgent.name}:`, error);
    }
  };

  // ============================================
  // HUMAN VS BOT GAME FUNCTIONS
  // ============================================

  // Wait for human to make a move
  const waitForHumanMove = (): Promise<string> => {
    return new Promise((resolve) => {
      dispatch({ type: "SET_WAITING_FOR_HUMAN", waiting: true });

      const checkMove = setInterval(() => {
        // Check the ref that will be updated by the human move handler
        if (humanMoveRef.current) {
          clearInterval(checkMove);
          const move = humanMoveRef.current;
          humanMoveRef.current = null;
          dispatch({ type: "SET_WAITING_FOR_HUMAN", waiting: false });
          resolve(move);
        }
      }, 100);
    });
  };

  // Handle human making a move
  const handleHumanMove = (move: string) => {
    humanMoveRef.current = move;
    playSound("move");
  };

  // ============================================
  // TOURNAMENT MODE FUNCTIONS
  // ============================================

  const handleStartTournament = async () => {
    if (!state.selectedGame) {
      dispatch({ type: "SET_ERROR", error: "Please select a game type for the tournament" });
      return;
    }

    const matches = generateRoundRobinMatches();
    dispatch({ type: "START_TOURNAMENT", matches });
    dispatch({ type: "ADD_LOG", message: `Starting Round-Robin Tournament: ${GAMES[state.selectedGame].name}` });
    dispatch({ type: "ADD_LOG", message: `Total matches: ${matches.length}` });

    // Start running the tournament
    await runTournament(matches);
  };

  const runTournament = async (matches: TournamentMatch[]) => {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];

      dispatch({ type: "ADD_LOG", message: `\n--- Match ${i + 1}/${matches.length} ---` });
      dispatch({ type: "ADD_LOG", message: `${AGENTS[match.agent1].name} vs ${AGENTS[match.agent2].name}` });

      // Set up the match
      dispatch({ type: "SELECT_AGENT1", agent: match.agent1 });
      dispatch({ type: "SELECT_AGENT2", agent: match.agent2 });

      // Small delay before starting
      await sleep(500);

      // Run the match
      const winner = await runTournamentMatch(match.agent1, match.agent2);

      // Update tournament state
      dispatch({ type: "UPDATE_TOURNAMENT_MATCH", matchIndex: i, winner });

      // Create match record for tournament match
      const tournamentMatchRecord: MatchRecord = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        gameType: state.selectedGame!,
        agent1: { id: match.agent1, name: AGENTS[match.agent1].name },
        agent2: { id: match.agent2, name: AGENTS[match.agent2].name },
        winner: winner === null ? null : winner === match.agent1 ? 0 : 1,
        rounds: 1,
        duration: 0,
      };

      dispatch({ type: "ADD_MATCH", match: tournamentMatchRecord });

      // Save to persistent memory
      if (arenaMemory) {
        const updatedMemory = recordMatch(arenaMemory, tournamentMatchRecord);
        setArenaMemory(updatedMemory);
        saveMemory(updatedMemory);
      }

      if (winner) {
        const loser = winner === match.agent1 ? match.agent2 : match.agent1;
        dispatch({ type: "UPDATE_TOURNAMENT_SCORES", agent: winner, result: "win" });
        dispatch({ type: "UPDATE_TOURNAMENT_SCORES", agent: loser, result: "loss" });
        dispatch({ type: "ADD_LOG", message: `Winner: ${AGENTS[winner].name}!` });
      } else {
        dispatch({ type: "UPDATE_TOURNAMENT_SCORES", agent: match.agent1, result: "tie" });
        dispatch({ type: "UPDATE_TOURNAMENT_SCORES", agent: match.agent2, result: "tie" });
        dispatch({ type: "ADD_LOG", message: "Result: TIE!" });
      }

      dispatch({ type: "NEXT_TOURNAMENT_MATCH" });

      // Delay between matches
      await sleep(1000);
    }

    // Tournament complete
    dispatch({ type: "SET_TOURNAMENT_PHASE", phase: "finished" });
    dispatch({ type: "ADD_LOG", message: "\n=== TOURNAMENT COMPLETE ===" });
    playSound("cheer");
  };

  const runTournamentMatch = async (agent1Id: AgentId, agent2Id: AgentId): Promise<AgentId | null> => {
    // Create the game
    let game: RPSGame | TTTGame | MancalaGame | WarGame | BlackjackGame;
    switch (state.selectedGame) {
      case "rps":
        game = new RPSGame();
        break;
      case "ttt":
        game = new TTTGame();
        break;
      case "mancala":
        game = new MancalaGame();
        break;
      case "war":
        game = new WarGame();
        break;
      case "blackjack":
        game = new BlackjackGame();
        break;
      default:
        return null;
    }

    dispatch({ type: "SET_CURRENT_GAME", game });
    dispatch({ type: "SET_GAME_PHASE", phase: "playing" });

    // Run the game loop for this match
    gameLoopRef.current = true;
    await runTournamentGameLoop(game, agent1Id, agent2Id);

    // Get the winner
    const winnerIndex = game.getWinner();
    if (winnerIndex === 0) return agent1Id;
    if (winnerIndex === 1) return agent2Id;
    return null;
  };

  const runTournamentGameLoop = async (game: RPSGame | TTTGame | MancalaGame | WarGame | BlackjackGame, agent1Id: AgentId, agent2Id: AgentId) => {
    let currentPlayerLocal = 0;

    while (gameLoopRef.current && !game.isGameOver()) {
      const player = currentPlayerLocal;
      const agentId = player === 0 ? agent1Id : agent2Id;
      const agent = AGENTS[agentId];
      const opponentId = player === 0 ? agent2Id : agent1Id;
      const opponent = AGENTS[opponentId];

      // For Blackjack, skip players who have already stood
      if (game instanceof BlackjackGame && game.playerStood[player]) {
        currentPlayerLocal = 1 - player;
        dispatch({ type: "SET_CURRENT_PLAYER", player: currentPlayerLocal });
        continue;
      }

      dispatch({ type: "SET_THINKING", isThinking: true, agent: agent.name });

      try {
        let move: string | null = null;
        let commentary = "";
        let attempts = 0;

        while (attempts < 3 && !move) {
          // Determine game type first
          const gameType: GameType = game instanceof RPSGame ? "rps" :
            game instanceof TTTGame ? "ttt" :
            game instanceof MancalaGame ? "mancala" :
            game instanceof WarGame ? "war" : "blackjack";

          // Build dynamic system prompt with full memory context for rich AI dialogue
          const systemPrompt = buildDynamicSystemPrompt(agent, opponent, gameType, arenaMemory);
          let userPrompt = "";

          if (game instanceof RPSGame) {
            userPrompt = game.buildPrompt(player, agent, opponent, []);
          } else if (game instanceof TTTGame) {
            userPrompt = game.buildPrompt(player, agent, opponent, []);
          } else if (game instanceof MancalaGame) {
            userPrompt = game.buildPrompt(player, agent, opponent, []);
          } else if (game instanceof WarGame) {
            userPrompt = game.buildPrompt(player, agent, opponent, []);
          } else if (game instanceof BlackjackGame) {
            userPrompt = game.buildPrompt(player, agent, opponent, []);
          }

          const response = await callGameAPI(
            agentId,
            systemPrompt,
            userPrompt,
            agent.temperature,
            gameType,
            state.apiProvider
          );

          move = response.move;
          commentary = response.commentary;

          if (move) {
            let valid = false;
            if (game instanceof RPSGame) {
              valid = game.makeMove(player, move);
            } else if (game instanceof TTTGame) {
              const pos = parseInt(move);
              valid = !isNaN(pos) && game.makeMove(player, pos);
            } else if (game instanceof MancalaGame) {
              valid = game.makeMove(player, move);
            } else if (game instanceof WarGame) {
              valid = game.makeMove(player, move);
            } else if (game instanceof BlackjackGame) {
              valid = game.makeMove(player, move);
            }

            if (!valid) {
              move = null;
              attempts++;
            }
          } else {
            attempts++;
          }
        }

        if (!move) {
          throw new Error(`${agent.name} failed to make a valid move`);
        }

        dispatch({ type: "SET_COMMENTARY", player, commentary, isTyping: false });
        dispatch({ type: "SET_THINKING", isThinking: false, agent: null });

        playSound("move");
        await sleep(state.moveDelay / 2); // Faster for tournament

        // RPS/War delay after both players move
        if ((game instanceof RPSGame || game instanceof WarGame) && player === 1) {
          await sleep(state.moveDelay);
        }

        currentPlayerLocal = 1 - player;
        dispatch({ type: "SET_CURRENT_PLAYER", player: currentPlayerLocal });
      } catch (error) {
        dispatch({ type: "SET_THINKING", isThinking: false, agent: null });
        gameLoopRef.current = false;
        return;
      }
    }

    dispatch({ type: "SET_GAME_PHASE", phase: "finished" });

    if (game.getWinner() !== null) {
      playSound("win");
    }

    await sleep(500);
  };

  const getTournamentLeaderboard = () => {
    const entries = Object.entries(state.tournamentScores) as [AgentId, { wins: number; losses: number; ties: number; points: number }][];
    return entries
      .sort((a, b) => b[1].points - a[1].points || b[1].wins - a[1].wins)
      .map(([agentId, scores]) => ({
        agentId,
        ...scores
      }));
  };

  const calculateStats = () => {
    const stats: Record<
      AgentId,
      { wins: number; losses: number; ties: number }
    > = {
      analyst: { wins: 0, losses: 0, ties: 0 },
      chaos: { wins: 0, losses: 0, ties: 0 },
      strategist: { wins: 0, losses: 0, ties: 0 },
      rookie: { wins: 0, losses: 0, ties: 0 },
      diva: { wins: 0, losses: 0, ties: 0 },
    };

    state.matchHistory.forEach((match) => {
      if (match.winner === null) {
        stats[match.agent1.id].ties++;
        stats[match.agent2.id].ties++;
      } else if (match.winner === 0) {
        stats[match.agent1.id].wins++;
        stats[match.agent2.id].losses++;
      } else {
        stats[match.agent2.id].wins++;
        stats[match.agent1.id].losses++;
      }
    });

    return stats;
  };

  const stats = calculateStats();

  return (
    <div
      className="min-h-screen p-4 font-mono text-base"
      style={{
        backgroundColor: currentTheme.background,
        color: currentTheme.text,
        fontFamily: "'VT323', 'Courier New', monospace",
        fontSize: '27px', // Increased base font size by 50%
      }}
    >
      {/* CRT Effects */}
      <div
        className="fixed inset-0 pointer-events-none z-50"
        style={{
          background: `repeating-linear-gradient(
            0deg,
            rgba(0, 0, 0, 0.25),
            rgba(0, 0, 0, 0.25) 2px,
            transparent 2px,
            transparent 4px
          )`,
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none z-40"
        style={{
          boxShadow: "inset 0 0 150px rgba(0,0,0,0.6)",
          borderRadius: "20px / 40px",
        }}
      />

      {/* Main Terminal Window */}
      <div
        className="max-w-7xl mx-auto relative z-30"
        style={{
          boxShadow: `0 0 20px ${currentTheme.primary}40`,
        }}
      >
        {/* Terminal Header */}
        <div
          className="border-2 border-gray-600 rounded-t-lg p-2 flex justify-between items-center"
          style={{ borderColor: "#444" }}
        >
          <h1
            className="text-3xl font-bold tracking-wider"
            style={{
              color: currentTheme.primary,
              textShadow: currentTheme.glow,
            }}
          >
            AI_AGENT_ARENA v1.0.4
          </h1>
          <div className="flex gap-2">
            <button
              className="px-2 py-1 text-xs border border-gray-600 hover:bg-gray-800"
              style={{ borderColor: "#444" }}
              onClick={() => dispatch({ type: "SET_THEME", theme: "amber" })}
            >
              [_]
            </button>
            <button
              className="px-2 py-1 text-xs border border-gray-600 hover:bg-gray-800"
              style={{ borderColor: "#444" }}
              onClick={() => dispatch({ type: "SET_THEME", theme: "green" })}
            >
              [□]
            </button>
            <select
              className="px-2 py-1 text-xs border border-gray-600 bg-transparent"
              style={{ borderColor: "#444", color: currentTheme.text }}
              value={state.theme}
              onChange={(e) => dispatch({ type: "SET_THEME", theme: e.target.value as ThemeId })}
            >
              {Object.values(THEMES).map((theme) => (
                <option key={theme.id} value={theme.id} style={{ backgroundColor: currentTheme.background }}>
                  [X] {theme.name}
                </option>
              ))}
            </select>
            <select
              className="px-2 py-1 text-xs border bg-transparent"
              style={{
                borderColor: state.apiProvider === "claude" ? "#33ff00" : "#444",
                color: state.apiProvider === "claude" ? "#33ff00" : currentTheme.text
              }}
              value={state.apiProvider}
              onChange={(e) => dispatch({ type: "SET_API_PROVIDER", provider: e.target.value as ApiProvider })}
            >
              <option value="offline" style={{ backgroundColor: currentTheme.background }}>
                [ OFFLINE ]
              </option>
              <option value="claude" style={{ backgroundColor: currentTheme.background }}>
                [ CLAUDE API ]
              </option>
            </select>
          </div>
        </div>

        {/* Terminal Body */}
        <div
          className="border-2 border-t-0 border-gray-600 rounded-b-lg p-4"
          style={{ borderColor: "#444", minHeight: "80vh" }}
        >
          {/* Configuration Panel */}
          <div className="mb-6">
            <div
              className="border border-gray-600 p-3 mb-2"
              style={{ borderColor: "#444" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span style={{ color: currentTheme.secondary }}>─</span>
                <span className="font-bold" style={{ color: currentTheme.primary }}>
                  CONFIGURATION
                </span>
                <span style={{ color: currentTheme.secondary }}>
                  {"─────────────────────────────────────"}
                </span>
              </div>

              {/* Game Mode Toggle */}
              <div className="flex items-center gap-4 mb-4">
                <span style={{ color: currentTheme.text, fontSize: "24px" }}>{`> Mode:`}</span>
                <button
                  className={`px-4 py-2 border transition-all ${state.gameMode === "bot-vs-bot" ? "border-2" : ""}`}
                  style={{
                    borderColor: state.gameMode === "bot-vs-bot" ? currentTheme.primary : "#444",
                    color: state.gameMode === "bot-vs-bot" ? currentTheme.primary : currentTheme.text,
                    backgroundColor: state.gameMode === "bot-vs-bot" ? `${currentTheme.primary}20` : "transparent",
                  }}
                  onClick={() => dispatch({ type: "SET_GAME_MODE", mode: "bot-vs-bot" })}
                >
                  [ BOT vs BOT ]
                </button>
                <button
                  className={`px-4 py-2 border transition-all ${state.gameMode === "human-vs-bot" ? "border-2" : ""}`}
                  style={{
                    borderColor: state.gameMode === "human-vs-bot" ? "#ff69b4" : "#444",
                    color: state.gameMode === "human-vs-bot" ? "#ff69b4" : currentTheme.text,
                    backgroundColor: state.gameMode === "human-vs-bot" ? "#ff69b420" : "transparent",
                  }}
                  onClick={() => dispatch({ type: "SET_GAME_MODE", mode: "human-vs-bot" })}
                >
                  [ YOU vs BOT ]
                </button>
                {state.gameMode === "human-vs-bot" && (
                  <span style={{ color: "#ff69b4", fontSize: "18px" }}>
                    (Exhibition - Stats not recorded)
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <span style={{ color: currentTheme.text, fontSize: "26px" }}>{`> Game Type:`}</span>
                  <select
                    className="px-3 py-2 border bg-transparent flex-1"
                    style={{ borderColor: "#444", color: currentTheme.text, fontSize: "23px" }}
                    value={state.selectedGame || ""}
                    onChange={(e) => dispatch({ type: "SELECT_GAME", game: e.target.value as GameType })}
                  >
                    <option value="" style={{ backgroundColor: currentTheme.background }}>
                      [Select Game]
                    </option>
                    {Object.entries(GAMES).map(([key, game]) => (
                      <option key={key} value={key} style={{ backgroundColor: currentTheme.background }}>
                        {game.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Player 1: Human or Bot depending on mode */}
                <div className="flex items-center gap-3">
                  <span style={{ color: currentTheme.text, fontSize: "26px" }}>
                    {state.gameMode === "human-vs-bot" ? `> Player 1:` : `> Agent 1:`}
                  </span>
                  {state.gameMode === "human-vs-bot" ? (
                    <div
                      className="px-3 py-2 border flex-1"
                      style={{ borderColor: "#ff69b4", color: "#ff69b4", fontSize: "23px" }}
                    >
                      YOU (Human)
                    </div>
                  ) : (
                    <select
                      className="px-3 py-2 border bg-transparent flex-1"
                      style={{ borderColor: "#444", color: currentTheme.text, fontSize: "23px" }}
                      value={state.agent1 || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === "random") {
                          const randomAgent = getRandomAgent(state.agent2);
                          dispatch({ type: "SELECT_AGENT1", agent: randomAgent });
                        } else {
                          dispatch({ type: "SELECT_AGENT1", agent: value as AgentId });
                        }
                      }}
                    >
                      <option value="" style={{ backgroundColor: currentTheme.background }}>
                        [Select Agent]
                      </option>
                      <option value="random" style={{ backgroundColor: currentTheme.background }}>
                        🎲 Random
                      </option>
                      {Object.values(AGENTS).map((agent) => (
                        <option key={agent.id} value={agent.id} style={{ backgroundColor: currentTheme.background }}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span style={{ color: currentTheme.text, fontSize: "26px" }}>{`> Agent 2:`}</span>
                  <select
                    className="px-3 py-2 border bg-transparent flex-1"
                    style={{ borderColor: "#444", color: currentTheme.text, fontSize: "23px" }}
                    value={state.agent2 || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === "random") {
                        const randomAgent = getRandomAgent(state.agent1);
                        dispatch({ type: "SELECT_AGENT2", agent: randomAgent });
                      } else {
                        dispatch({ type: "SELECT_AGENT2", agent: value as AgentId });
                      }
                    }}
                  >
                    <option value="" style={{ backgroundColor: currentTheme.background }}>
                      [Select Agent]
                    </option>
                    <option value="random" style={{ backgroundColor: currentTheme.background }}>
                      🎲 Random
                    </option>
                    {Object.values(AGENTS).map((agent) => (
                      <option key={agent.id} value={agent.id} style={{ backgroundColor: currentTheme.background }}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="px-4 py-2 border hover:bg-gray-800"
                  style={{ borderColor: "#444", color: currentTheme.text, fontSize: "20px" }}
                  onClick={() => {
                    const ids = Object.keys(AGENTS) as AgentId[];
                    const agent1 = ids[Math.floor(Math.random() * ids.length)];
                    let agent2 = ids[Math.floor(Math.random() * ids.length)];
                    while (agent1 === agent2) {
                      agent2 = ids[Math.floor(Math.random() * ids.length)];
                    }
                    dispatch({ type: "SELECT_AGENT1", agent: agent1 });
                    dispatch({ type: "SELECT_AGENT2", agent: agent2 });
                    addLog(`Randomized agents: ${AGENTS[agent1].name} vs ${AGENTS[agent2].name}`);
                  }}
                  disabled={state.gamePhase === "playing" || state.gamePhase === "placement"}
                >
                  [ 🎲 RANDOMIZE BOTH ]
                </button>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <button
                  className="px-4 py-2 border font-bold hover:opacity-80 disabled:opacity-50"
                  style={{
                    borderColor: currentTheme.primary,
                    color: currentTheme.primary,
                    textShadow: currentTheme.glow,
                  }}
                  onClick={handleStartGame}
                  disabled={state.gamePhase === "playing" || state.gamePhase === "placement"}
                >
                  [ EXECUTE ]
                </button>

                <select
                  className="px-2 py-1 border bg-transparent"
                  style={{ borderColor: "#444", color: currentTheme.text }}
                  value={state.speedMultiplier}
                  onChange={(e) => dispatch({ type: "SET_SPEED", speed: Number(e.target.value) as SpeedMultiplier })}
                >
                  <option value={1} style={{ backgroundColor: currentTheme.background }}>Speed: 1x</option>
                  <option value={2} style={{ backgroundColor: currentTheme.background }}>Speed: 2x</option>
                  <option value={0} style={{ backgroundColor: currentTheme.background }}>Speed: Instant</option>
                </select>

                <button
                  className="px-2 py-1 border hover:bg-gray-800"
                  style={{ borderColor: "#444", color: currentTheme.text }}
                  onClick={() => dispatch({ type: "TOGGLE_SOUND" })}
                >
                  [ Sound: {state.soundEnabled ? "ON" : "OFF"} ]
                </button>

                {state.gamePhase !== "setup" && (
                  <button
                    className="px-2 py-1 border hover:bg-gray-800"
                    style={{ borderColor: "#444", color: currentTheme.text }}
                    onClick={() => {
                      gameLoopRef.current = false;
                      dispatch({ type: "RESET_GAME" });
                    }}
                  >
                    [ RESET ]
                  </button>
                )}

                {/* Tournament Button */}
                <button
                  className="px-4 py-2 border font-bold hover:opacity-80 disabled:opacity-50"
                  style={{
                    borderColor: currentTheme.primary,
                    color: currentTheme.primary,
                    textShadow: currentTheme.glow,
                  }}
                  onClick={handleStartTournament}
                  disabled={state.gamePhase === "playing" || state.gamePhase === "placement" || state.tournamentPhase === "running"}
                >
                  [ TOURNAMENT ]
                </button>
              </div>
            </div>
          </div>

          {/* Tournament Progress Panel */}
          {state.tournamentPhase === "running" && (
            <div className="mb-6">
              <div
                className="border border-gray-600 p-3"
                style={{ borderColor: "#ff69b4" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span style={{ color: "#ff69b4" }}>★</span>
                  <span className="font-bold" style={{ color: "#ff69b4" }}>
                    ROUND-ROBIN TOURNAMENT
                  </span>
                  <span style={{ color: "#ff69b4" }}>
                    {"─────────────────────────────────────"}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Current Match */}
                  <div>
                    <div className="text-base mb-2" style={{ color: currentTheme.secondary }}>
                      CURRENT MATCH ({state.tournamentCurrentMatch + 1}/{state.tournamentMatches.length}):
                    </div>
                    {state.tournamentMatches[state.tournamentCurrentMatch] && (
                      <div className="flex items-center gap-2" style={{ fontSize: "18px" }}>
                        <span style={{ color: AGENTS[state.tournamentMatches[state.tournamentCurrentMatch].agent1].color }}>
                          {AGENTS[state.tournamentMatches[state.tournamentCurrentMatch].agent1].name}
                        </span>
                        <span style={{ color: currentTheme.text }}>vs</span>
                        <span style={{ color: AGENTS[state.tournamentMatches[state.tournamentCurrentMatch].agent2].color }}>
                          {AGENTS[state.tournamentMatches[state.tournamentCurrentMatch].agent2].name}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Live Leaderboard */}
                  <div>
                    <div className="text-base mb-2" style={{ color: currentTheme.secondary }}>
                      LIVE STANDINGS:
                    </div>
                    <div className="space-y-1">
                      {getTournamentLeaderboard().map((entry, index) => (
                        <div key={entry.agentId} className="flex justify-between" style={{ fontSize: "16px" }}>
                          <span style={{ color: AGENTS[entry.agentId].color }}>
                            {index + 1}. {AGENTS[entry.agentId].name}
                          </span>
                          <span style={{ color: currentTheme.text }}>
                            {entry.points}pts ({entry.wins}W-{entry.losses}L-{entry.ties}T)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Match Progress */}
                <div className="mt-4">
                  <div className="text-base mb-1" style={{ color: currentTheme.secondary }}>
                    MATCH RESULTS:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {state.tournamentMatches.map((match, i) => (
                      <div
                        key={i}
                        className="px-2 py-1 border text-xs"
                        style={{
                          borderColor: match.completed ? (match.winner ? AGENTS[match.winner].color : "#888") : "#444",
                          color: match.completed ? (match.winner ? AGENTS[match.winner].color : "#888") : "#666",
                          opacity: i < state.tournamentCurrentMatch ? 1 : 0.5
                        }}
                      >
                        {AGENTS[match.agent1].name.substring(0, 3)} vs {AGENTS[match.agent2].name.substring(0, 3)}
                        {match.completed && (
                          <span className="ml-1">
                            {match.winner ? `→ ${AGENTS[match.winner].name.substring(0, 3)}` : "→ TIE"}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tournament Results Panel */}
          {state.tournamentPhase === "finished" && (
            <div className="mb-6">
              <div
                className="border border-gray-600 p-3"
                style={{ borderColor: "#ffd700" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span style={{ color: "#ffd700" }}>🏆</span>
                  <span className="font-bold" style={{ color: "#ffd700" }}>
                    TOURNAMENT COMPLETE
                  </span>
                  <span style={{ color: "#ffd700" }}>
                    {"─────────────────────────────────────"}
                  </span>
                </div>

                <div className="text-center mb-4">
                  {(() => {
                    const leaderboard = getTournamentLeaderboard();
                    const champion = leaderboard[0];
                    return (
                      <div>
                        <div className="text-2xl mb-2" style={{ color: "#ffd700", textShadow: "0 0 15px #ffd700" }}>
                          CHAMPION
                        </div>
                        <pre style={{ color: AGENTS[champion.agentId].color, fontSize: "18px", lineHeight: "1.1" }}>
                          {AGENT_ASCII[champion.agentId].join("\n")}
                        </pre>
                        <div className="text-xl mt-2" style={{ color: AGENTS[champion.agentId].color }}>
                          {AGENTS[champion.agentId].name}
                        </div>
                        <div className="text-base" style={{ color: currentTheme.text }}>
                          {champion.points} points | {champion.wins}W-{champion.losses}L-{champion.ties}T
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="text-base mb-2" style={{ color: currentTheme.secondary }}>
                  FINAL STANDINGS:
                </div>
                <table className="w-full" style={{ fontSize: "18px" }}>
                  <thead>
                    <tr style={{ color: currentTheme.secondary }}>
                      <th className="text-left p-1">RANK</th>
                      <th className="text-left p-1">AGENT</th>
                      <th className="text-center p-1">PTS</th>
                      <th className="text-center p-1">W</th>
                      <th className="text-center p-1">L</th>
                      <th className="text-center p-1">T</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getTournamentLeaderboard().map((entry, index) => (
                      <tr key={entry.agentId}>
                        <td className="p-1" style={{ color: index === 0 ? "#ffd700" : index === 1 ? "#c0c0c0" : index === 2 ? "#cd7f32" : currentTheme.text }}>
                          {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`}
                        </td>
                        <td className="p-1" style={{ color: AGENTS[entry.agentId].color }}>
                          {AGENTS[entry.agentId].name}
                        </td>
                        <td className="text-center p-1" style={{ color: currentTheme.text }}>{entry.points}</td>
                        <td className="text-center p-1" style={{ color: "#33ff00" }}>{entry.wins}</td>
                        <td className="text-center p-1" style={{ color: "#ff3333" }}>{entry.losses}</td>
                        <td className="text-center p-1" style={{ color: currentTheme.text }}>{entry.ties}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-4 text-center">
                  <button
                    className="px-4 py-2 border font-bold hover:opacity-80"
                    style={{
                      borderColor: currentTheme.primary,
                      color: currentTheme.primary,
                    }}
                    onClick={() => dispatch({ type: "END_TOURNAMENT" })}
                  >
                    [ CLOSE RESULTS ]
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Game Arena */}
          {state.selectedGame && state.agent1 && state.agent2 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
              {/* Agent 1 Panel */}
              <div className="lg:col-span-3">
                <div
                  className="border p-3 h-full"
                  style={{ borderColor: AGENTS[state.agent1].color }}
                >
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b" style={{ borderColor: "#444" }}>
                    <span style={{ color: AGENTS[state.agent1].color }}>●</span>
                    <span className="font-bold" style={{ color: AGENTS[state.agent1].color }}>
                      {AGENTS[state.agent1].name.toUpperCase()}
                    </span>
                    {state.isThinking && state.thinkingAgent === AGENTS[state.agent1].name && (
                      <span className="animate-pulse" style={{ color: currentTheme.text }}>
                        [...]
                      </span>
                    )}
                  </div>
                  {/* Mini ASCII Avatar */}
                  <div className="mb-2 flex justify-center">
                    <pre style={{
                      color: AGENTS[state.agent1].color,
                      fontSize: "11px",
                      lineHeight: "1",
                      opacity: state.isThinking && state.thinkingAgent === AGENTS[state.agent1].name ? 1 : 0.7
                    }}>
                      {AGENT_ASCII[state.agent1].slice(0, 5).join("\n")}
                    </pre>
                  </div>
                  <div className="min-h-[120px]" style={{ color: currentTheme.text, fontSize: "18px" }}>
                    {state.agent1Commentary && (
                      <TypewriterText
                        text={state.agent1Commentary}
                        speed={state.speedMultiplier === 0 ? 0 : 30}
                        playSound={playSound}
                        theme={currentTheme}
                        onComplete={() => dispatch({ type: "SET_TYPING_COMPLETE", player: 0 })}
                      />
                    )}
                    {!state.agent1Commentary && state.gamePhase === "setup" && (
                      <span style={{ color: "#666" }}>{`> Ready to compete...`}</span>
                    )}
                  </div>
                  {state.gamePhase === "finished" && state.currentGame && (
                    <div className="mt-2 pt-2 border-t" style={{ borderColor: "#444" }}>
                      <span style={{
                        color: state.currentGame.getWinner() === 0 ? "#33ff00" : state.currentGame.getWinner() === 1 ? "#ff3333" : currentTheme.secondary,
                        fontSize: "16px"
                      }}>
                        {state.currentGame.getWinner() === 0 ? "VICTORY:" : state.currentGame.getWinner() === 1 ? "DEFEAT:" : "DRAW:"}
                      </span>
                      <p className="text-base mt-1 italic" style={{ color: currentTheme.text }}>
                        &quot;{state.currentGame.getWinner() === 0
                          ? getRandomQuote(WIN_QUOTES[state.agent1!][state.agent2!])
                          : state.currentGame.getWinner() === 1
                          ? getRandomQuote(LOSE_QUOTES[state.agent1!][state.agent2!])
                          : getRandomQuote(TIE_QUOTES[state.agent1!])
                        }&quot;
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Game Board */}
              <div className="lg:col-span-6">
                <div
                  className="border p-4"
                  style={{ borderColor: "#444", minHeight: "300px" }}
                >
                  <div className="text-center mb-4">
                    <span style={{ color: currentTheme.primary, fontSize: "24px", textShadow: currentTheme.glow }}>
                      {state.selectedGame ? GAMES[state.selectedGame].name.toUpperCase() : "SELECT GAME"}
                    </span>
                    {state.gamePhase === "playing" && (
                      <div className="text-base mt-1" style={{ color: currentTheme.text }}>
                        {`Round: ${state.currentGame instanceof RPSGame ? state.currentGame.round : state.currentGame instanceof TTTGame ? Math.floor(state.currentGame.moves.length / 2) + 1 : "Battle"} | Current: ${state.currentPlayer === 0 ? AGENTS[state.agent1!].name : AGENTS[state.agent2!].name}`}
                      </div>
                    )}
                    {/* API Mode Indicator */}
                    <div className="text-base mt-1" style={{ color: state.apiProvider === "claude" ? "#33ff00" : "#ff9500" }}>
                      {state.apiProvider === "claude" ? "[ CLAUDE API MODE ]" : "[ OFFLINE MODE - Simulated AI ]"}
                    </div>
                  </div>

                  {/* Game Visualization */}
                  <div className="flex justify-center items-center">
                    {state.gamePhase === "setup" && (
                      <div className="text-center">
                        <div className="grid grid-cols-2 gap-8 mb-4">
                          <div>
                            <pre style={{ color: AGENTS[state.agent1!].color, fontSize: "16px", lineHeight: "1.1" }}>
                              {AGENT_ASCII[state.agent1!].join("\n")}
                            </pre>
                            <div className="text-base mt-2" style={{ color: AGENTS[state.agent1!].color }}>
                              {AGENTS[state.agent1!].name}
                            </div>
                          </div>
                          <div>
                            <pre style={{ color: AGENTS[state.agent2!].color, fontSize: "16px", lineHeight: "1.1" }}>
                              {AGENT_ASCII[state.agent2!].join("\n")}
                            </pre>
                            <div className="text-base mt-2" style={{ color: AGENTS[state.agent2!].color }}>
                              {AGENTS[state.agent2!].name}
                            </div>
                          </div>
                        </div>
                        <div style={{ color: "#666" }}>{`> Press EXECUTE to begin`}</div>
                      </div>
                    )}
                    {state.gamePhase === "placement" && (
                      <div className="text-center">
                        <div className="mb-4">
                          <pre style={{ color: currentTheme.primary, fontSize: "14px", lineHeight: "1" }}>
{`    ╔════════════════════════════════╗
    ║   BATTLESHIP DEPLOYMENT ZONE   ║
    ╠════════════════════════════════╣
    ║  A B C D E F G H I J           ║
    ║ ┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┐ 1       ║
    ║ ├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤ 2       ║
    ║ ├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤ 3       ║
    ║ ├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤ 4       ║
    ║ ├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤ 5       ║
    ║ ├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤ 6       ║
    ║ ├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤ 7       ║
    ║ ├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤ 8       ║
    ║ ├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤ 9       ║
    ║ └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┘ 10      ║
    ╚════════════════════════════════╝`}
                          </pre>
                        </div>
                        <div style={{ color: currentTheme.text }} className="animate-pulse">{`> Agents placing ships...`}</div>
                      </div>
                    )}
                    {state.gamePhase === "playing" && state.currentGame && (
                      <div className="text-center">
                        {state.selectedGame === "rps" && state.currentGame instanceof RPSGame && (
                          <div className="font-mono">
                            <div className="mb-3 text-lg" style={{ color: currentTheme.secondary }}>
                              {`SCORE: ${state.currentGame.scores[0]} - ${state.currentGame.scores[1]}`}
                            </div>
                            <div className="grid grid-cols-3 gap-4 items-center">
                              <div className="text-center">
                                <pre style={{ color: AGENTS[state.agent1!].color, fontSize: "14px", lineHeight: "1" }}>
                                  {AGENT_ASCII[state.agent1!].join("\n")}
                                </pre>
                                <div className="text-base mt-1" style={{ color: AGENTS[state.agent1!].color }}>
                                  {AGENTS[state.agent1!].name}
                                </div>
                              </div>
                              <div className="flex flex-col items-center gap-2">
                                <pre style={{ color: (state.currentGame.currentMoves[0] || state.currentGame.lastRoundMoves[0]) ? AGENTS[state.agent1!].color : "#444", fontSize: "12px", lineHeight: "1" }}>
                                  {RPS_ASCII[state.currentGame.currentMoves[0] || state.currentGame.lastRoundMoves[0] || "?"].join("\n")}
                                </pre>
                                <div className="text-xl font-bold" style={{ color: currentTheme.primary }}>VS</div>
                                <pre style={{ color: (state.currentGame.currentMoves[1] || state.currentGame.lastRoundMoves[1]) ? AGENTS[state.agent2!].color : "#444", fontSize: "12px", lineHeight: "1", transform: "scaleX(-1)" }}>
                                  {RPS_ASCII[state.currentGame.currentMoves[1] || state.currentGame.lastRoundMoves[1] || "?"].join("\n")}
                                </pre>
                              </div>
                              <div className="text-center">
                                <pre style={{ color: AGENTS[state.agent2!].color, fontSize: "14px", lineHeight: "1" }}>
                                  {AGENT_ASCII[state.agent2!].join("\n")}
                                </pre>
                                <div className="text-base mt-1" style={{ color: AGENTS[state.agent2!].color }}>
                                  {AGENTS[state.agent2!].name}
                                </div>
                              </div>
                            </div>
                            {state.currentGame.history.length > 0 && (
                              <div className="mt-4" style={{ color: currentTheme.text, fontSize: "16px" }}>
                                <div className="mb-1" style={{ color: currentTheme.secondary }}>Round History:</div>
                                {state.currentGame.history.map((h, i) => (
                                  <div key={i}>
                                    {`R${h.round}: ${h.p1Move} vs ${h.p2Move} → ${h.winner === null ? "TIE" : h.winner === 0 ? AGENTS[state.agent1!].name : AGENTS[state.agent2!].name}`}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {state.selectedGame === "ttt" && state.currentGame instanceof TTTGame && (
                          <div>
                            <div className="grid grid-cols-3 gap-4 items-center mb-4">
                              <div className="text-center flex flex-col items-center justify-center">
                                <pre style={{ color: AGENTS[state.agent1!].color, fontSize: "12px", lineHeight: "1" }}>
                                  {AGENT_ASCII[state.agent1!].join("\n")}
                                </pre>
                                <div className="text-base mt-2" style={{ color: AGENTS[state.agent1!].color }}>X</div>
                              </div>
                              <div className="flex justify-center items-center">
                                <pre className="text-xl" style={{ color: currentTheme.text, lineHeight: "1.4", textAlign: "center" }}>
                                  {state.currentGame.renderBoard()}
                                </pre>
                              </div>
                              <div className="text-center flex flex-col items-center justify-center">
                                <pre style={{ color: AGENTS[state.agent2!].color, fontSize: "12px", lineHeight: "1" }}>
                                  {AGENT_ASCII[state.agent2!].join("\n")}
                                </pre>
                                <div className="text-base mt-2" style={{ color: AGENTS[state.agent2!].color }}>O</div>
                              </div>
                            </div>
                          </div>
                        )}
                        {state.selectedGame === "mancala" && state.currentGame instanceof MancalaGame && (
                          <div className="font-mono">
                            <div className="mb-3 text-lg text-center" style={{ color: currentTheme.secondary }}>
                              {`SCORE: ${state.currentGame.getScore(0)} - ${state.currentGame.getScore(1)}`}
                            </div>
                            <div className="grid grid-cols-3 gap-4 items-center mb-4">
                              <div className="text-center">
                                <pre style={{ color: AGENTS[state.agent1!].color, fontSize: "10px", lineHeight: "1" }}>
                                  {AGENT_ASCII[state.agent1!].join("\n")}
                                </pre>
                                <div className="text-sm mt-1" style={{ color: AGENTS[state.agent1!].color }}>
                                  {AGENTS[state.agent1!].name}
                                </div>
                                <div className="text-xs" style={{ color: currentTheme.text }}>
                                  Store: {state.currentGame.board[6]}
                                </div>
                              </div>
                              <div className="text-center">
                                <pre style={{ color: currentTheme.primary, fontSize: "11px", lineHeight: "1.3", fontFamily: "monospace" }}>
                                  {state.currentGame.renderBoard()}
                                </pre>
                                <div className="text-xs mt-1" style={{ color: currentTheme.secondary }}>
                                  {state.currentPlayer === 0 ? AGENTS[state.agent1!].name : AGENTS[state.agent2!].name}&apos;s turn
                                </div>
                              </div>
                              <div className="text-center">
                                <pre style={{ color: AGENTS[state.agent2!].color, fontSize: "10px", lineHeight: "1" }}>
                                  {AGENT_ASCII[state.agent2!].join("\n")}
                                </pre>
                                <div className="text-sm mt-1" style={{ color: AGENTS[state.agent2!].color }}>
                                  {AGENTS[state.agent2!].name}
                                </div>
                                <div className="text-xs" style={{ color: currentTheme.text }}>
                                  Store: {state.currentGame.board[13]}
                                </div>
                              </div>
                            </div>
                            {state.currentGame.lastMove && (
                              <div className="text-center text-sm" style={{ color: state.currentGame.lastMove.extraTurn ? "#33ff00" : currentTheme.text }}>
                                {state.currentGame.lastMove.extraTurn ? "Extra turn!" : ""}
                              </div>
                            )}
                          </div>
                        )}
                        {state.selectedGame === "war" && state.currentGame instanceof WarGame && (
                          <div className="font-mono">
                            <div className="mb-3 text-lg" style={{ color: currentTheme.secondary }}>
                              {`SCORE: ${state.currentGame.scores[0]} - ${state.currentGame.scores[1]} (Best of 5)`}
                            </div>
                            <div className="grid grid-cols-3 gap-4 items-center">
                              <div className="text-center">
                                <pre style={{ color: AGENTS[state.agent1!].color, fontSize: "12px", lineHeight: "1" }}>
                                  {AGENT_ASCII[state.agent1!].join("\n")}
                                </pre>
                                <div className="text-base mt-1" style={{ color: AGENTS[state.agent1!].color }}>
                                  {AGENTS[state.agent1!].name}
                                </div>
                              </div>
                              <div className="flex flex-col items-center gap-2">
                                <pre style={{ color: (state.currentGame.currentCards[0] || state.currentGame.lastRoundCards[0]) ? AGENTS[state.agent1!].color : "#444", fontSize: "10px", lineHeight: "1" }}>
                                  {getCardAscii(state.currentGame.currentCards[0] || state.currentGame.lastRoundCards[0]).join("\n")}
                                </pre>
                                <div className="text-xl font-bold" style={{ color: currentTheme.primary }}>VS</div>
                                <pre style={{ color: (state.currentGame.currentCards[1] || state.currentGame.lastRoundCards[1]) ? AGENTS[state.agent2!].color : "#444", fontSize: "10px", lineHeight: "1" }}>
                                  {getCardAscii(state.currentGame.currentCards[1] || state.currentGame.lastRoundCards[1]).join("\n")}
                                </pre>
                              </div>
                              <div className="text-center">
                                <pre style={{ color: AGENTS[state.agent2!].color, fontSize: "12px", lineHeight: "1" }}>
                                  {AGENT_ASCII[state.agent2!].join("\n")}
                                </pre>
                                <div className="text-base mt-1" style={{ color: AGENTS[state.agent2!].color }}>
                                  {AGENTS[state.agent2!].name}
                                </div>
                              </div>
                            </div>
                            {state.currentGame.history.length > 0 && (
                              <div className="mt-4" style={{ color: currentTheme.text, fontSize: "14px" }}>
                                <div className="mb-1" style={{ color: currentTheme.secondary }}>Round History:</div>
                                {state.currentGame.history.map((h, i) => (
                                  <div key={i}>
                                    {`R${h.round}: ${h.p1Card.rank}${h.p1Card.suit} vs ${h.p2Card.rank}${h.p2Card.suit} → ${h.winner === null ? "TIE" : h.winner === 0 ? AGENTS[state.agent1!].name : AGENTS[state.agent2!].name}`}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {state.selectedGame === "blackjack" && state.currentGame instanceof BlackjackGame && (
                          <div className="font-mono">
                            <div className="mb-3 text-lg" style={{ color: currentTheme.secondary }}>
                              {`MATCH SCORE: ${state.currentGame.scores[0]} - ${state.currentGame.scores[1]} (Best of 3)`}
                            </div>
                            <div className="grid grid-cols-2 gap-6">
                              <div className="text-center">
                                <pre style={{ color: AGENTS[state.agent1!].color, fontSize: "10px", lineHeight: "1" }}>
                                  {AGENT_ASCII[state.agent1!].join("\n")}
                                </pre>
                                <div className="text-base mt-1" style={{ color: AGENTS[state.agent1!].color }}>
                                  {AGENTS[state.agent1!].name}
                                </div>
                                <div className="mt-2" style={{ fontSize: "14px" }}>
                                  <div style={{ color: currentTheme.secondary }}>Hand:</div>
                                  <div className="flex flex-wrap justify-center gap-1 mt-1">
                                    {state.currentGame.hands[0].map((card, i) => (
                                      <span key={i} style={{ color: (card.suit === '♥' || card.suit === '♦') ? "#ff6666" : currentTheme.text }}>
                                        [{card.rank}{card.suit}]
                                      </span>
                                    ))}
                                  </div>
                                  <div className="mt-1" style={{
                                    color: state.currentGame.calculateHandValue(state.currentGame.hands[0]) > 21 ? "#ff3333" :
                                           state.currentGame.calculateHandValue(state.currentGame.hands[0]) === 21 ? "#33ff00" : currentTheme.text
                                  }}>
                                    Total: {state.currentGame.calculateHandValue(state.currentGame.hands[0])}
                                    {state.currentGame.calculateHandValue(state.currentGame.hands[0]) > 21 && " BUST!"}
                                    {state.currentGame.calculateHandValue(state.currentGame.hands[0]) === 21 && " BLACKJACK!"}
                                  </div>
                                  {state.currentGame.playerStood[0] && <div style={{ color: "#ffff00" }}>[STANDING]</div>}
                                </div>
                              </div>
                              <div className="text-center">
                                <pre style={{ color: AGENTS[state.agent2!].color, fontSize: "10px", lineHeight: "1" }}>
                                  {AGENT_ASCII[state.agent2!].join("\n")}
                                </pre>
                                <div className="text-base mt-1" style={{ color: AGENTS[state.agent2!].color }}>
                                  {AGENTS[state.agent2!].name}
                                </div>
                                <div className="mt-2" style={{ fontSize: "14px" }}>
                                  <div style={{ color: currentTheme.secondary }}>Hand:</div>
                                  <div className="flex flex-wrap justify-center gap-1 mt-1">
                                    {state.currentGame.hands[1].map((card, i) => (
                                      <span key={i} style={{ color: (card.suit === '♥' || card.suit === '♦') ? "#ff6666" : currentTheme.text }}>
                                        [{card.rank}{card.suit}]
                                      </span>
                                    ))}
                                  </div>
                                  <div className="mt-1" style={{
                                    color: state.currentGame.calculateHandValue(state.currentGame.hands[1]) > 21 ? "#ff3333" :
                                           state.currentGame.calculateHandValue(state.currentGame.hands[1]) === 21 ? "#33ff00" : currentTheme.text
                                  }}>
                                    Total: {state.currentGame.calculateHandValue(state.currentGame.hands[1])}
                                    {state.currentGame.calculateHandValue(state.currentGame.hands[1]) > 21 && " BUST!"}
                                    {state.currentGame.calculateHandValue(state.currentGame.hands[1]) === 21 && " BLACKJACK!"}
                                  </div>
                                  {state.currentGame.playerStood[1] && <div style={{ color: "#ffff00" }}>[STANDING]</div>}
                                </div>
                              </div>
                            </div>
                            {state.currentGame.history.length > 0 && (
                              <div className="mt-4" style={{ color: currentTheme.text, fontSize: "14px" }}>
                                <div className="mb-1" style={{ color: currentTheme.secondary }}>Round History:</div>
                                {state.currentGame.history.map((h, i) => (
                                  <div key={i}>
                                    {`R${h.round}: ${AGENTS[state.agent1!].name}: ${h.p1Total} vs ${AGENTS[state.agent2!].name}: ${h.p2Total} → ${h.winner === null ? "TIE" : h.winner === 0 ? AGENTS[state.agent1!].name : AGENTS[state.agent2!].name}`}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {/* Human Move Controls */}
                        {state.gameMode === "human-vs-bot" && state.waitingForHuman && (
                          <div
                            className="mt-6 p-4 border-2 rounded"
                            style={{ borderColor: "#ff69b4", backgroundColor: "#ff69b410" }}
                          >
                            <div className="text-center mb-3" style={{ color: "#ff69b4", fontSize: "18px" }}>
                              YOUR TURN - Make your move!
                            </div>

                            {/* RPS Controls */}
                            {state.selectedGame === "rps" && (
                              <div className="flex justify-center gap-4">
                                {["Rock", "Paper", "Scissors"].map((move) => (
                                  <button
                                    key={move}
                                    className="px-6 py-3 border-2 hover:scale-105 transition-transform"
                                    style={{
                                      borderColor: "#ff69b4",
                                      color: "#ff69b4",
                                      fontSize: "18px",
                                    }}
                                    onClick={() => handleHumanMove(move)}
                                  >
                                    {move === "Rock" ? "🪨" : move === "Paper" ? "📄" : "✂️"} {move}
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* TTT Controls */}
                            {state.selectedGame === "ttt" && state.currentGame instanceof TTTGame && (
                              <div className="flex flex-col items-center gap-2">
                                <div className="text-sm mb-2" style={{ color: currentTheme.text }}>
                                  Click a position (1-9):
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((pos) => {
                                    const isAvailable = state.currentGame instanceof TTTGame &&
                                      state.currentGame.board[pos - 1] === null;
                                    return (
                                      <button
                                        key={pos}
                                        className="w-12 h-12 border-2 text-xl font-bold transition-all"
                                        style={{
                                          borderColor: isAvailable ? "#ff69b4" : "#444",
                                          color: isAvailable ? "#ff69b4" : "#666",
                                          opacity: isAvailable ? 1 : 0.5,
                                        }}
                                        onClick={() => isAvailable && handleHumanMove(String(pos))}
                                        disabled={!isAvailable}
                                      >
                                        {pos}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Mancala Controls */}
                            {state.selectedGame === "mancala" && state.currentGame instanceof MancalaGame && (
                              <div className="flex flex-col items-center gap-2">
                                <div className="text-sm mb-2" style={{ color: currentTheme.text }}>
                                  Select a pit (1-6):
                                </div>
                                <div className="flex justify-center gap-2">
                                  {[1, 2, 3, 4, 5, 6].map((pit) => {
                                    const boardIndex = pit - 1;
                                    const stones = state.currentGame instanceof MancalaGame
                                      ? state.currentGame.board[boardIndex]
                                      : 0;
                                    const isAvailable = stones > 0;
                                    return (
                                      <button
                                        key={pit}
                                        className="w-14 h-14 border-2 flex flex-col items-center justify-center transition-all"
                                        style={{
                                          borderColor: isAvailable ? "#ff69b4" : "#444",
                                          color: isAvailable ? "#ff69b4" : "#666",
                                          opacity: isAvailable ? 1 : 0.5,
                                        }}
                                        onClick={() => isAvailable && handleHumanMove(String(pit))}
                                        disabled={!isAvailable}
                                      >
                                        <span className="text-xs">Pit {pit}</span>
                                        <span className="text-lg font-bold">{stones}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* War Controls */}
                            {state.selectedGame === "war" && (
                              <div className="flex justify-center">
                                <button
                                  className="px-8 py-4 border-2 hover:scale-105 transition-transform"
                                  style={{
                                    borderColor: "#ff69b4",
                                    color: "#ff69b4",
                                    fontSize: "20px",
                                  }}
                                  onClick={() => handleHumanMove("Draw")}
                                >
                                  🃏 DRAW CARD
                                </button>
                              </div>
                            )}

                            {/* Blackjack Controls */}
                            {state.selectedGame === "blackjack" && (
                              <div className="flex justify-center gap-4">
                                <button
                                  className="px-6 py-3 border-2 hover:scale-105 transition-transform"
                                  style={{
                                    borderColor: "#33ff00",
                                    color: "#33ff00",
                                    fontSize: "18px",
                                  }}
                                  onClick={() => handleHumanMove("Hit")}
                                >
                                  🃏 HIT
                                </button>
                                <button
                                  className="px-6 py-3 border-2 hover:scale-105 transition-transform"
                                  style={{
                                    borderColor: "#ffff00",
                                    color: "#ffff00",
                                    fontSize: "18px",
                                  }}
                                  onClick={() => handleHumanMove("Stand")}
                                >
                                  ✋ STAND
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {state.gamePhase === "finished" && state.currentGame && (
                      <div className="text-center">
                        <div
                          className="text-3xl font-bold mb-4"
                          style={{ color: currentTheme.primary, textShadow: currentTheme.glow }}
                        >
                          {state.gameMode === "human-vs-bot" ? "EXHIBITION COMPLETE" : "GAME OVER"}
                        </div>
                        {state.currentGame.getWinner() !== null ? (
                          <div>
                            {/* Human vs Bot - show appropriate message */}
                            {state.gameMode === "human-vs-bot" ? (
                              <>
                                {state.currentGame.getWinner() === 0 ? (
                                  <div>
                                    <div className="text-6xl mb-4">🎉</div>
                                    <div className="text-2xl font-bold" style={{ color: "#33ff00" }}>
                                      YOU WIN!
                                    </div>
                                    <div className="text-lg mt-2" style={{ color: currentTheme.text }}>
                                      You defeated {AGENTS[state.agent2!].name}!
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <pre style={{ color: AGENTS[state.agent2!].color, fontSize: "16px", lineHeight: "1.1" }}>
                                      {AGENT_ASCII[state.agent2!].join("\n")}
                                    </pre>
                                    <div className="text-xl mt-2" style={{ color: AGENTS[state.agent2!].color }}>
                                      {AGENTS[state.agent2!].name} WINS!
                                    </div>
                                    <div className="text-lg mt-1" style={{ color: "#ff6666" }}>
                                      Better luck next time!
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <pre style={{
                                  color: state.currentGame.getWinner() === 0 ? AGENTS[state.agent1!].color : AGENTS[state.agent2!].color,
                                  fontSize: "16px",
                                  lineHeight: "1.1"
                                }}>
                                  {AGENT_ASCII[state.currentGame.getWinner() === 0 ? state.agent1! : state.agent2!].join("\n")}
                                </pre>
                                <div className="text-xl mt-2" style={{
                                  color: state.currentGame.getWinner() === 0 ? AGENTS[state.agent1!].color : AGENTS[state.agent2!].color
                                }}>
                                  {`${state.currentGame.getWinner() === 0 ? AGENTS[state.agent1!].name : AGENTS[state.agent2!].name} WINS!`}
                                </div>
                                <div className="mt-4 text-sm italic max-w-md mx-auto" style={{ color: currentTheme.text }}>
                                  &quot;{getRandomQuote(WIN_QUOTES[state.currentGame.getWinner() === 0 ? state.agent1! : state.agent2!][state.currentGame.getWinner() === 0 ? state.agent2! : state.agent1!])}&quot;
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div>
                            <div className="grid grid-cols-2 gap-8">
                              <pre style={{ color: AGENTS[state.agent1!].color, fontSize: "14px", lineHeight: "1.1" }}>
                                {AGENT_ASCII[state.agent1!].join("\n")}
                              </pre>
                              <pre style={{ color: AGENTS[state.agent2!].color, fontSize: "14px", lineHeight: "1.1" }}>
                                {AGENT_ASCII[state.agent2!].join("\n")}
                              </pre>
                            </div>
                            <div className="text-xl mt-2" style={{ color: currentTheme.text }}>
                              IT&apos;S A TIE!
                            </div>
                            <div className="mt-4 text-sm italic max-w-md mx-auto" style={{ color: currentTheme.text }}>
                              &quot;{getRandomQuote(TIE_QUOTES[state.agent1!])}&quot;
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Agent 2 Panel */}
              <div className="lg:col-span-3">
                <div
                  className="border p-3 h-full"
                  style={{ borderColor: AGENTS[state.agent2].color }}
                >
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b" style={{ borderColor: "#444" }}>
                    <span style={{ color: AGENTS[state.agent2].color }}>●</span>
                    <span className="font-bold" style={{ color: AGENTS[state.agent2].color }}>
                      {AGENTS[state.agent2].name.toUpperCase()}
                    </span>
                    {state.isThinking && state.thinkingAgent === AGENTS[state.agent2].name && (
                      <span className="animate-pulse" style={{ color: currentTheme.text }}>
                        [...]
                      </span>
                    )}
                  </div>
                  {/* Mini ASCII Avatar */}
                  <div className="mb-2 flex justify-center">
                    <pre style={{
                      color: AGENTS[state.agent2].color,
                      fontSize: "11px",
                      lineHeight: "1",
                      opacity: state.isThinking && state.thinkingAgent === AGENTS[state.agent2].name ? 1 : 0.7
                    }}>
                      {AGENT_ASCII[state.agent2].slice(0, 5).join("\n")}
                    </pre>
                  </div>
                  <div className="min-h-[120px]" style={{ color: currentTheme.text, fontSize: "18px" }}>
                    {state.agent2Commentary && (
                      <TypewriterText
                        text={state.agent2Commentary}
                        speed={state.speedMultiplier === 0 ? 0 : 30}
                        playSound={playSound}
                        theme={currentTheme}
                        onComplete={() => dispatch({ type: "SET_TYPING_COMPLETE", player: 1 })}
                      />
                    )}
                    {!state.agent2Commentary && state.gamePhase === "setup" && (
                      <span style={{ color: "#666" }}>{`> Ready to compete...`}</span>
                    )}
                  </div>
                  {state.gamePhase === "finished" && state.currentGame && (
                    <div className="mt-2 pt-2 border-t" style={{ borderColor: "#444" }}>
                      <span style={{
                        color: state.currentGame.getWinner() === 1 ? "#33ff00" : state.currentGame.getWinner() === 0 ? "#ff3333" : currentTheme.secondary,
                        fontSize: "16px"
                      }}>
                        {state.currentGame.getWinner() === 1 ? "VICTORY:" : state.currentGame.getWinner() === 0 ? "DEFEAT:" : "DRAW:"}
                      </span>
                      <p className="text-base mt-1 italic" style={{ color: currentTheme.text }}>
                        &quot;{state.currentGame.getWinner() === 1
                          ? getRandomQuote(WIN_QUOTES[state.agent2!][state.agent1!])
                          : state.currentGame.getWinner() === 0
                          ? getRandomQuote(LOSE_QUOTES[state.agent2!][state.agent1!])
                          : getRandomQuote(TIE_QUOTES[state.agent2!])
                        }&quot;
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Game Log */}
          {state.gameLog.length > 0 && (
            <div className="mb-6">
              <div
                ref={logContainerRef}
                className="border border-gray-600 p-2"
                style={{ borderColor: "#444", maxHeight: "200px", overflowY: "auto" }}
              >
                <div className="text-base mb-2" style={{ color: currentTheme.secondary }}>
                  {"─ SYSTEM LOG ─"}
                </div>
                {state.gameLog.map((log, idx) => (
                  <div key={idx} className="text-base mb-1" style={{ color: currentTheme.text }}>
                    {`$ ${log}`}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Match History */}
          <div>
            <div
              className="border border-gray-600 p-3"
              style={{ borderColor: "#444" }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span style={{ color: currentTheme.secondary }}>─</span>
                <span className="font-bold" style={{ color: currentTheme.primary }}>
                  MATCH HISTORY
                </span>
                <span style={{ color: currentTheme.secondary }}>
                  {"────────────────────────────────────"}
                </span>
              </div>

              {/* Statistics Table */}
              <div className="mb-4 overflow-x-auto">
                <table className="w-full" style={{ fontSize: "22px" }}>
                  <thead>
                    <tr style={{ color: currentTheme.secondary }}>
                      <th className="text-left p-2">AGENT</th>
                      <th className="text-center p-2" style={{ minWidth: "70px" }}>WINS</th>
                      <th className="text-center p-2" style={{ minWidth: "80px" }}>LOSSES</th>
                      <th className="text-center p-2" style={{ minWidth: "60px" }}>TIES</th>
                      <th className="text-center p-2" style={{ minWidth: "70px" }}>WIN%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stats).map(([agentId, stat]) => {
                      const agent = AGENTS[agentId as AgentId];
                      const total = stat.wins + stat.losses + stat.ties;
                      const winRate = total > 0 ? Math.round((stat.wins / total) * 100) : 0;
                      return (
                        <tr key={agentId} style={{ color: currentTheme.text }}>
                          <td className="p-2" style={{ color: agent.color }}>
                            {agent.name}
                          </td>
                          <td className="text-center p-2">{stat.wins}</td>
                          <td className="text-center p-2">{stat.losses}</td>
                          <td className="text-center p-2">{stat.ties}</td>
                          <td className="text-center p-2">{winRate}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Recent Matches */}
              {state.matchHistory.length > 0 && (
                <div>
                  <div className="text-base mb-2" style={{ color: currentTheme.secondary }}>
                    {"RECENT MATCHES:"}
                  </div>
                  <div className="space-y-1">
                    {state.matchHistory.slice(-5).reverse().map((match) => (
                      <div
                        key={match.id}
                        className="text-base flex justify-between"
                        style={{ color: currentTheme.text }}
                      >
                        <span>
                          {`${GAMES[match.gameType].name}: ${match.agent1.name} vs ${match.agent2.name}`}
                        </span>
                        <span
                          style={{
                            color:
                              match.winner === null
                                ? currentTheme.text
                                : match.winner === 0
                                ? AGENTS[match.agent1.id].color
                                : AGENTS[match.agent2.id].color,
                          }}
                        >
                          {match.winner === null ? "TIE" : match.winner === 0 ? `${match.agent1.name} WINS` : `${match.agent2.name} WINS`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Agent Memory - Persistent Stats */}
          {arenaMemory && arenaMemory.totalMatches > 0 && (
            <div>
              <div
                className="border border-gray-600 p-3 mt-4"
                style={{ borderColor: "#444" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span style={{ color: currentTheme.secondary }}>─</span>
                  <span className="font-bold" style={{ color: currentTheme.primary }}>
                    AGENT MEMORY (ALL-TIME)
                  </span>
                  <span style={{ color: currentTheme.secondary }}>
                    {"─────────────────────────"}
                  </span>
                </div>

                <div className="text-sm mb-3" style={{ color: currentTheme.secondary }}>
                  {arenaMemory.totalMatches} total matches in memory
                </div>

                {/* All-time Statistics */}
                <div className="mb-4 overflow-x-auto">
                  <table className="w-full" style={{ fontSize: "20px" }}>
                    <thead>
                      <tr style={{ color: currentTheme.secondary }}>
                        <th className="text-left p-2">AGENT</th>
                        <th className="text-center p-2">ALL-TIME</th>
                        <th className="text-center p-2">WIN%</th>
                        <th className="text-center p-2">STREAK</th>
                        <th className="text-left p-2">NOTES</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(arenaMemory.agents).map(([agentId, memory]) => {
                        const agent = AGENTS[agentId as AgentId];
                        const winRate = getWinRate(memory.stats);
                        return (
                          <tr key={agentId} style={{ color: currentTheme.text }}>
                            <td className="p-2" style={{ color: agent.color }}>
                              {agent.name}
                            </td>
                            <td className="text-center p-2 text-sm">
                              {memory.stats.wins}W-{memory.stats.losses}L-{memory.stats.ties}T
                            </td>
                            <td className="text-center p-2">{winRate}%</td>
                            <td className="text-center p-2">
                              {memory.currentWinStreak > 0 ? (
                                <span style={{ color: "#33ff00" }}>🔥{memory.currentWinStreak}</span>
                              ) : memory.longestWinStreak > 0 ? (
                                <span style={{ color: currentTheme.secondary }}>
                                  Best: {memory.longestWinStreak}
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                            <td className="p-2 text-sm" style={{ color: currentTheme.secondary }}>
                              {memory.nemesis && (
                                <span>
                                  Nemesis: <span style={{ color: AGENTS[memory.nemesis].color }}>{AGENTS[memory.nemesis].name}</span>
                                </span>
                              )}
                              {memory.bestMatchup && !memory.nemesis && (
                                <span>
                                  Best vs: <span style={{ color: AGENTS[memory.bestMatchup].color }}>{AGENTS[memory.bestMatchup].name}</span>
                                </span>
                              )}
                              {memory.favoriteGame && !memory.nemesis && !memory.bestMatchup && (
                                <span>Excels at: {memory.favoriteGame.toUpperCase()}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Clear Memory Button */}
                <div className="flex justify-end">
                  <button
                    className="px-3 py-1 border text-sm hover:bg-red-900/30"
                    style={{ borderColor: "#ff3333", color: "#ff3333" }}
                    onClick={() => {
                      if (window.confirm("Clear all agent memory? This cannot be undone.")) {
                        clearMemory();
                        setArenaMemory(loadMemory());
                      }
                    }}
                  >
                    [ CLEAR MEMORY ]
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Error Modal */}
          {state.error && (
            <div
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
              onClick={() => dispatch({ type: "CLEAR_ERROR" })}
            >
              <div
                className="border p-6 max-w-md"
                style={{ borderColor: "#ff3333", backgroundColor: currentTheme.background }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2 mb-4">
                  <span style={{ color: "#ff3333" }}>[ERR]</span>
                  <span className="font-bold" style={{ color: "#ff3333" }}>
                    ERROR
                  </span>
                </div>
                <p className="mb-4 text-sm" style={{ color: currentTheme.text }}>
                  {state.error}
                </p>
                <button
                  className="px-4 py-2 border"
                  style={{ borderColor: "#ff3333", color: "#ff3333" }}
                  onClick={() => dispatch({ type: "CLEAR_ERROR" })}
                >
                  [ DISMISS ]
                </button>
              </div>
            </div>
          )}

          {/* Command Prompt */}
          <div className="mt-6 flex items-center gap-2">
            <span style={{ color: currentTheme.primary }}>$</span>
            <span className="cursor-blink" style={{ color: currentTheme.cursor }}>
              █
            </span>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .cursor-blink {
          animation: blink 1s infinite;
        }
      `}</style>
    </div>
  );
}