import { NextRequest, NextResponse } from "next/server";

// ============================================
// TYPES
// ============================================

type AgentId = "analyst" | "chaos" | "strategist" | "rookie" | "diva";
type GameType = "rps" | "ttt" | "mancala" | "war" | "blackjack";
type ApiProvider = "claude" | "offline";

interface GameRequest {
  agentId: AgentId;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  gameType: GameType;
  apiProvider?: ApiProvider;
}

interface GameResponse {
  move: string;
  commentary: string;
  source: "api" | "offline";
}

// ============================================
// CONFIG & REQUEST GUARDS
// ============================================

// Model is configurable via env so it can be swapped without code changes.
// Haiku is fast and inexpensive, which suits short game moves.
const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

const VALID_AGENTS: readonly AgentId[] = ["analyst", "chaos", "strategist", "rookie", "diva"];
const VALID_GAMES: readonly GameType[] = ["rps", "ttt", "mancala", "war", "blackjack"];

// Caps keep a public deployment from being used as a general-purpose Claude proxy.
const MAX_SYSTEM_PROMPT_CHARS = 12000;
const MAX_USER_PROMPT_CHARS = 6000;

// Simple per-IP rate limit for API mode (in-memory; resets when the server restarts).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestLog.set(ip, recent);
  if (requestLog.size > 5000) {
    for (const [key, times] of requestLog) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) requestLog.delete(key);
    }
  }
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

// ============================================
// POST-GAME REACTIONS
// ============================================

// The client asks for a post-game reaction (not a move) by ending its prompt with "POST_GAME:".
function isPostGameRequest(userPrompt: string): boolean {
  return /POST_GAME:/i.test(userPrompt);
}

const OFFLINE_POST_GAME: Record<AgentId, Record<"win" | "loss" | "tie", string[]>> = {
  analyst: {
    win: ["The numbers held up. A statistically satisfying result.", "As projected. The data rarely lies."],
    loss: ["An outlier result. I'll be recalibrating my model.", "Variance happens. The long-run expectation still favors me."],
    tie: ["A perfectly balanced outcome. Mathematically elegant, if unsatisfying.", "Equilibrium reached. Interesting."],
  },
  chaos: {
    win: ["CHAOS WINS AGAIN! Didn't even have a plan!", "Was that skill? Luck? Who cares, I WON!"],
    loss: ["Lost? Fine. Chaos doesn't keep score... except I totally do.", "Next time I'm making even weirder moves. You've been warned!"],
    tie: ["A tie?! That's the most chaotic result of all!", "Nobody wins, everybody's confused. Perfect."],
  },
  strategist: {
    win: ["Every move set up the next. The plan came together.", "Patience and positioning. That's how it's done."],
    loss: ["They found a line I didn't see. I'll study it.", "A setback, not a defeat. The long game continues."],
    tie: ["Neither of us could break through. Respectable.", "A stalemate tells me where to push next time."],
  },
  rookie: {
    win: ["Wait, I actually won?! Is this real?!", "I can't believe it worked! Can we play again?!"],
    loss: ["Aw man... I'm still learning, okay? I'll get better!", "Okay, that was rough. But I learned a lot!"],
    tie: ["A tie! That's basically a win for me, right?", "I didn't lose! That counts as progress!"],
  },
  diva: {
    win: ["Of course I won. Was there ever any doubt, darling?", "Another flawless performance. You may applaud."],
    loss: ["I simply wasn't trying. Clearly.", "That result is an insult to my talent. I demand a rematch."],
    tie: ["A tie? With ME? How generous of me.", "Sharing the spotlight. How... humbling."],
  },
};

function getOfflinePostGame(agentId: AgentId, userPrompt: string): { move: string; commentary: string } {
  const result = /You WON/i.test(userPrompt) ? "win" : /You LOST/i.test(userPrompt) ? "loss" : "tie";
  const lines = OFFLINE_POST_GAME[agentId][result];
  return { move: "", commentary: lines[Math.floor(Math.random() * lines.length)] };
}

// ============================================
// OFFLINE MODE LOGIC
// ============================================

// Pick a random item from a list
const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

// Fill {move}, {pit}, {total} placeholders in a line
const fill = (line: string, vars: Record<string, string | number>): string =>
  line.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));

// Tic-tac-toe squares grouped by strength: center, corners, edges
const TTT_CENTER = [5];
const TTT_CORNERS = [1, 3, 7, 9];
const TTT_EDGES = [2, 4, 6, 8];

// Choose a legal square, preferring the first group (in order) that still has an open square
function pickTTTSquare(userPrompt: string, groups: number[][]): number {
  const available = parseAvailableTTTMoves(userPrompt);
  for (const group of groups) {
    const open = group.filter((sq) => available.includes(sq));
    if (open.length > 0) return pick(open);
  }
  return pick(available);
}

function tttSquareType(square: number): "center" | "corner" | "edge" {
  if (TTT_CENTER.includes(square)) return "center";
  if (TTT_CORNERS.includes(square)) return "corner";
  return "edge";
}

function pickMancalaPit(userPrompt: string): number {
  const availablePits = parseAvailableMancalaPits(userPrompt);
  return availablePits.length > 0 ? pick(availablePits) : 1;
}

function blackjackTotal(userPrompt: string): number {
  const totalMatch = userPrompt.match(/Total:\s*(\d+)/);
  return totalMatch ? parseInt(totalMatch[1]) : 0;
}

// ============================================
// OFFLINE DIALOGUE
// Placeholders: {move} (RPS/TTT), {pit} (Mancala), {total} (Blackjack)
// ============================================

const LINES = {
  analyst: {
    rps: [
      "Based on game theory analysis, {move} offers the optimal expected value.",
      "Opponent tendencies noted. {move} is the statistically sound response.",
      "A one-in-three proposition, on paper. My models suggest {move}.",
      "Pattern recognition engaged. Deploying {move}.",
      "Most players over-select Rock early. Adjusting accordingly: {move}.",
      "{move}. The data does not lie, even when it disappoints.",
    ],
    tttCenter: [
      "Securing the center provides maximum strategic control.",
      "The center square sits on four winning lines. The choice is obvious.",
      "Center control: the statistically dominant opening.",
    ],
    tttCorner: [
      "Controlling corners creates winning opportunities.",
      "Corner {move}: three potential lines, minimal exposure.",
      "Corners generate forks at a measurably higher rate.",
    ],
    tttEdge: [
      "Maintaining positional advantage.",
      "Square {move}. Suboptimal in isolation, necessary in context.",
      "Square {move} blocks the most probable threat line.",
    ],
    mancala: [
      "Selecting pit {pit} based on stone distribution analysis.",
      "Pit {pit}: landing square calculated. Proceeding.",
      "Optimizing for store accumulation. Pit {pit}.",
      "Capture probability favors pit {pit} this turn.",
      "Counting stones... pit {pit} yields the highest expected gain.",
      "Pit {pit}. Every stone accounted for.",
    ],
    war: [
      "The expected value of any card draw follows a uniform distribution. Let's observe the outcome.",
      "Thirteen ranks, four suits. Roughly even odds of a higher card. Drawing.",
      "War has no strategy. It is, however, an excellent random sample.",
      "Drawing. The variance in this game is fascinating, if unproductive.",
      "Logging this result for my dataset.",
      "Probability does not care about my preferences. Drawing.",
    ],
    blackjackHit: [
      "With {total}, probability favors drawing another card. Statistical analysis supports this decision.",
      "{total} is below the standing threshold. Hit.",
      "At {total}, the bust risk is acceptable. Drawing.",
      "Basic strategy is unambiguous at {total}: hit.",
      "Expected value improves with another card at {total}.",
    ],
    blackjackStand: [
      "At {total}, the risk-reward ratio suggests standing. Further draws increase bust probability significantly.",
      "{total}. Standing. The numbers say this is where I stop.",
      "Bust probability at {total} exceeds my tolerance. I stand.",
      "Holding at {total}. Discipline is a statistical advantage.",
      "Standing on {total}, per the probability tables.",
    ],
  },
  chaos: {
    rps: [
      "Let's shake things up!",
      "You'll never see this coming!",
      "RNGesus, guide my hand!",
      "Chaos reigns supreme!",
      "Predictable is boring!",
      "My hand is moving on its OWN!",
      "Flip a coin! Wait, wrong game!",
    ],
    ttt: [
      "Randomness is my strategy!",
      "Let's put it... here! Why not?",
      "Chaos doesn't need a reason!",
      "Surprise!",
      "I'm not even LOOKING at the board!",
      "Square {move}! Because the voices said so!",
    ],
    mancala: [
      "SCOOP THE STONES! Let's GO!",
      "Random pit for maximum CHAOS!",
      "Mancala madness time!",
      "Who needs strategy when you have CHAOS?!",
      "Stones go WHEEE!",
      "Pit {pit}, because it FELT right!",
    ],
    war: [
      "FLIP THAT CARD! Let chaos decide!",
      "Come on, big money, no whammies!",
      "The card gods smile upon chaos!",
      "YOLO flip!",
      "DRAW! DRAW! DRAW!",
      "Bet it's a two. Bet it's an ace. Bet it's BOTH!",
    ],
    blackjackHit: [
      "HIT ME! Let's get CRAZY!",
      "Fortune favors the bold... or the foolish!",
      "Rules are for boring people! HIT!",
      "YOLO! Another card!",
      "Bust? Never heard of her! HIT!",
    ],
    blackjackStand: [
      "Standing! Bet you didn't see THAT coming!",
      "I'll stop here... for CHAOS reasons!",
      "Plot twist: I STAND!",
      "Standing is the most chaotic thing I could do right now!",
      "Freeze! Nobody move! Especially not me!",
    ],
  },
  strategist: {
    rps: [
      "A balanced approach. {move} maintains flexibility for future rounds.",
      "{move}. Every round reveals a little more about you.",
      "I'm not playing this round. I'm playing the next one. {move}.",
      "Patience. {move} for now.",
      "Read the opponent, then commit. {move}.",
      "The quiet move is often the strongest. {move}.",
    ],
    tttCenter: [
      "The center anchors every plan. Taking it.",
      "Center. From here, every line is open to me.",
    ],
    tttCorner: [
      "Setting up a fork position. Multiple threats incoming.",
      "Corner {move}. Two moves from now, you'll see why.",
      "Building toward a fork. Corner {move}.",
    ],
    tttEdge: [
      "Adapting to board state. Maintaining initiative.",
      "Square {move}. Closing the door before you walk through it.",
      "A defensive move today is an attacking one tomorrow.",
    ],
    mancala: [
      "Pit {pit} offers sound stone distribution. This move maintains positional control.",
      "Pit {pit}. I'm thinking three turns ahead.",
      "Setting up the next capture. Pit {pit}.",
      "Starving your side of options, one pit at a time.",
      "Pit {pit}. Tempo matters more than stones right now.",
      "Quiet accumulation. Pit {pit}.",
    ],
    war: [
      "In War, the outcome is predetermined. I draw with acceptance of whatever fate brings.",
      "Some battles are decided before they begin. Drawing.",
      "Even without choices, composure is a choice.",
      "I'll accept this card, whatever it is.",
      "Calm hands, whatever the card.",
      "Drawing. The long game includes the rounds you can't control.",
    ],
    blackjackHit: [
      "At {total}, the mathematically sound play is to hit. Patience and discipline.",
      "{total} won't win this hand. Another card.",
      "Hit at {total}. Measured risk.",
      "Not yet. Hit.",
      "A calculated draw at {total}.",
    ],
    blackjackStand: [
      "Standing at {total}. The long game rewards those who know when to hold.",
      "{total}. I'll let you take the risk.",
      "Holding at {total}. The pressure is on you now.",
      "Stand. Restraint wins more hands than courage.",
      "{total} is enough. Your move.",
    ],
  },
  rookie: {
    rps: [
      "Here goes nothing!",
      "I hope this works!",
      "Ooh, tough choice!",
      "Wait, what did they just play?",
      "I'm still learning this!",
      "Eeny, meeny, miny... this one!",
      "Going with my gut!",
    ],
    ttt: [
      "Is this a good spot?",
      "I think this works?",
      "Ooh, I didn't see that!",
      "Learning as I go!",
      "Okay, okay... square {move}!",
      "Wait, can I go here? Yes? Cool!",
    ],
    mancala: [
      "I'll try this pit!",
      "Scooping stones is fun!",
      "Did I do that right?",
      "This game is tricky!",
      "How many stones was that again?",
      "Pit {pit}! I'm counting... I think!",
    ],
    war: [
      "Ooh, I love flipping cards!",
      "Please be a high card!",
      "This is so exciting!",
      "Here goes nothing!",
      "Come on, come on, come on!",
      "I wonder what I'll get!",
    ],
    blackjackHit: [
      "Um, I think I should hit?",
      "One more card... please be small!",
      "Hit me! Wait, is that what you say?",
      "Ooh, this is nerve-wracking! Hit!",
      "{total}... yeah, I'll take another!",
    ],
    blackjackStand: [
      "I'll stand! I think that's right?",
      "Stand! Is {total} good? It feels good!",
      "I'm gonna play it safe and stand!",
      "Stopping here! Fingers crossed!",
      "I'm still learning, but I'll stand!",
    ],
  },
  diva: {
    rps: [
      "Watch and learn, darlings!",
      "This move is absolutely ICONIC!",
      "The spotlight is on ME!",
      "Prepare to be DAZZLED!",
      "A star never reveals their strategy... until NOW!",
      "Darling, I was BORN for this moment!",
      "Strike a pose... and a hand!",
    ],
    tttCenter: [
      "Center stage is MINE, obviously!",
      "Center stage is MINE, darling!",
      "Where else would a star stand? CENTER!",
    ],
    ttt: [
      "A dramatic move for a dramatic star!",
      "The audience will LOVE this!",
      "Fabulous positioning, if I say so myself!",
      "Mark my spot, darling!",
      "Every square I touch turns to GOLD!",
    ],
    mancala: [
      "Scooping stones with ELEGANCE!",
      "This move is pure ARTISTRY!",
      "Watch me DOMINATE this board!",
      "A FABULOUS stone cascade incoming!",
      "Pit {pit}, darling. My DEBUT performance!",
      "Stones fall for me, sweetie. They always do.",
    ],
    war: [
      "Watch this FABULOUS card flip!",
      "The cards ADORE me!",
      "A star's luck is LEGENDARY!",
      "This will be ICONIC!",
      "Darling, I don't draw cards. Cards come to ME.",
      "Lights, camera, CARD!",
    ],
    blackjackHit: [
      "Hit me, darling! A star needs MORE!",
      "Give me another card! I'm feeling LUCKY!",
      "More cards for the QUEEN!",
      "Another card, and make it FABULOUS!",
      "Hit me, sweetie! I live for the drama!",
    ],
    blackjackStand: [
      "I'll stand with GRACE and POISE!",
      "This hand is PERFECTION!",
      "A diva knows when to hold her ground!",
      "{total}? Darling, that's a WINNING number.",
      "Standing ovation... I mean, I STAND!",
    ],
  },
} as const;

type OfflineMove = { move: string; commentary: string };

const AGENT_OFFLINE_LOGIC: Record<
  AgentId,
  {
    rps: () => OfflineMove;
    ttt: (userPrompt: string) => OfflineMove;
    mancala: (userPrompt: string) => OfflineMove;
    war: () => OfflineMove;
    blackjack: (userPrompt: string) => OfflineMove;
  }
> = {
  analyst: {
    rps: () => {
      // Slight lean toward Paper (beats the commonly over-played Rock)
      const move = weightedRandom(["Rock", "Paper", "Scissors"], [0.3, 0.4, 0.3]);
      return { move, commentary: fill(pick(LINES.analyst.rps), { move }) };
    },
    ttt: (userPrompt) => {
      // Center first, then corners, then edges
      const square = pickTTTSquare(userPrompt, [TTT_CENTER, TTT_CORNERS, TTT_EDGES]);
      const type = tttSquareType(square);
      const lines = type === "center" ? LINES.analyst.tttCenter : type === "corner" ? LINES.analyst.tttCorner : LINES.analyst.tttEdge;
      return { move: String(square), commentary: fill(pick(lines), { move: square }) };
    },
    mancala: (userPrompt) => {
      const pit = pickMancalaPit(userPrompt);
      return { move: String(pit), commentary: fill(pick(LINES.analyst.mancala), { pit }) };
    },
    war: () => ({ move: "Draw", commentary: pick(LINES.analyst.war) }),
    blackjack: (userPrompt) => {
      // By the book: hit on 16 or less, stand on 17+
      const total = blackjackTotal(userPrompt);
      const move = total <= 16 ? "Hit" : "Stand";
      const lines = move === "Hit" ? LINES.analyst.blackjackHit : LINES.analyst.blackjackStand;
      return { move, commentary: fill(pick(lines), { total }) };
    },
  },
  chaos: {
    rps: () => ({ move: pick(["Rock", "Paper", "Scissors"]), commentary: pick(LINES.chaos.rps) }),
    ttt: (userPrompt) => {
      // Any open square, no plan at all
      const square = pick(parseAvailableTTTMoves(userPrompt));
      return { move: String(square), commentary: fill(pick(LINES.chaos.ttt), { move: square }) };
    },
    mancala: (userPrompt) => {
      const pit = pickMancalaPit(userPrompt);
      return { move: String(pit), commentary: fill(pick(LINES.chaos.mancala), { pit }) };
    },
    war: () => ({ move: "Draw", commentary: pick(LINES.chaos.war) }),
    blackjack: (userPrompt) => {
      // Hits on 11 or less, plus a 40% chance to hit no matter what
      const total = blackjackTotal(userPrompt);
      const move = total > 21 ? "Stand" : total <= 11 || Math.random() < 0.4 ? "Hit" : "Stand";
      const lines = move === "Hit" ? LINES.chaos.blackjackHit : LINES.chaos.blackjackStand;
      return { move, commentary: fill(pick(lines), { total }) };
    },
  },
  strategist: {
    rps: () => {
      const move = pick(["Rock", "Paper", "Scissors"]);
      return { move, commentary: fill(pick(LINES.strategist.rps), { move }) };
    },
    ttt: (userPrompt) => {
      // Corners first (fork setups), then center, then edges
      const square = pickTTTSquare(userPrompt, [TTT_CORNERS, TTT_CENTER, TTT_EDGES]);
      const type = tttSquareType(square);
      const lines = type === "center" ? LINES.strategist.tttCenter : type === "corner" ? LINES.strategist.tttCorner : LINES.strategist.tttEdge;
      return { move: String(square), commentary: fill(pick(lines), { move: square }) };
    },
    mancala: (userPrompt) => {
      const pit = pickMancalaPit(userPrompt);
      return { move: String(pit), commentary: fill(pick(LINES.strategist.mancala), { pit }) };
    },
    war: () => ({ move: "Draw", commentary: pick(LINES.strategist.war) }),
    blackjack: (userPrompt) => {
      const total = blackjackTotal(userPrompt);
      const move = total <= 16 ? "Hit" : "Stand";
      const lines = move === "Hit" ? LINES.strategist.blackjackHit : LINES.strategist.blackjackStand;
      return { move, commentary: fill(pick(lines), { total }) };
    },
  },
  rookie: {
    rps: () => ({ move: pick(["Rock", "Paper", "Scissors"]), commentary: pick(LINES.rookie.rps) }),
    ttt: (userPrompt) => {
      // 20% of the time makes a beginner mistake and grabs an edge; otherwise any open square
      const square = Math.random() < 0.2
        ? pickTTTSquare(userPrompt, [TTT_EDGES])
        : pick(parseAvailableTTTMoves(userPrompt));
      return { move: String(square), commentary: fill(pick(LINES.rookie.ttt), { move: square }) };
    },
    mancala: (userPrompt) => {
      const pit = pickMancalaPit(userPrompt);
      return { move: String(pit), commentary: fill(pick(LINES.rookie.mancala), { pit }) };
    },
    war: () => ({ move: "Draw", commentary: pick(LINES.rookie.war) }),
    blackjack: (userPrompt) => {
      // Usually by the book, but 25% of the time makes the wrong call
      const total = blackjackTotal(userPrompt);
      const correct = total <= 16 ? "Hit" : "Stand";
      const move = Math.random() < 0.25 ? (correct === "Hit" ? "Stand" : "Hit") : correct;
      const lines = move === "Hit" ? LINES.rookie.blackjackHit : LINES.rookie.blackjackStand;
      return { move, commentary: fill(pick(lines), { total }) };
    },
  },
  diva: {
    rps: () => ({ move: pick(["Rock", "Paper", "Scissors"]), commentary: pick(LINES.diva.rps) }),
    ttt: (userPrompt) => {
      // Center stage first, then anywhere
      const square = pickTTTSquare(userPrompt, [TTT_CENTER, [...TTT_CORNERS, ...TTT_EDGES]]);
      const lines = square === 5 ? LINES.diva.tttCenter : LINES.diva.ttt;
      return { move: String(square), commentary: fill(pick(lines), { move: square }) };
    },
    mancala: (userPrompt) => {
      const pit = pickMancalaPit(userPrompt);
      return { move: String(pit), commentary: fill(pick(LINES.diva.mancala), { pit }) };
    },
    war: () => ({ move: "Draw", commentary: pick(LINES.diva.war) }),
    blackjack: (userPrompt) => {
      // Plays sensibly, with flair
      const total = blackjackTotal(userPrompt);
      const move = total <= 16 ? "Hit" : "Stand";
      const lines = move === "Hit" ? LINES.diva.blackjackHit : LINES.diva.blackjackStand;
      return { move, commentary: fill(pick(lines), { total }) };
    },
  },
};

function weightedRandom<T>(items: T[], weights: number[]): T {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < items.length; i++) {
    if (random < weights[i]) return items[i];
    random -= weights[i];
  }
  return items[items.length - 1];
}

// Parse available TTT moves from the user prompt
function parseAvailableTTTMoves(userPrompt: string): number[] {
  const match = userPrompt.match(/Available moves:\s*([\d,\s]+)/i);
  if (match) {
    return match[1].split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 9);
  }
  return [1, 2, 3, 4, 5, 6, 7, 8, 9];
}

// Parse available Mancala pits from the user prompt
function parseAvailableMancalaPits(userPrompt: string): number[] {
  // The Mancala prompt labels legal pits "Valid moves:"; "Available pits:" kept for compatibility
  const match = userPrompt.match(/(?:Valid moves|Available pits):\s*([\d,\s]+)/i);
  if (match) {
    return match[1].split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 6);
  }
  // Default to all pits if we can't parse
  return [1, 2, 3, 4, 5, 6];
}

// ============================================
// CLAUDE API CLIENT
// ============================================

async function callClaudeAPI(
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  expectMove: boolean = true
): Promise<{ move: string; commentary: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.log("[API] No Anthropic API key found");
    return null;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_CLAUDE_MODEL,
        max_tokens: 300,
        temperature: temperature,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[API] Claude API error: ${response.status} ${response.statusText}`, errorText);
      return null;
    }

    const data = await response.json();
    const textBlock = Array.isArray(data.content)
      ? data.content.find((block: { type?: string }) => block.type === "text")
      : null;
    // Strip markdown bold/code marks (e.g. "MOVE: **Rock**") so parsing doesn't miss formatted replies.
    // Underscores are kept because the "POST_GAME:" marker contains one.
    const text: string = (textBlock?.text || "").replace(/[*`]/g, "");

    if (!expectMove) {
      const postGameMatch = text.match(/POST_GAME:\s*([\s\S]+)/i);
      const reaction = (postGameMatch ? postGameMatch[1] : text).trim();
      return reaction ? { move: "", commentary: reaction } : null;
    }

    const moveMatch = text.match(/MOVE:\s*(.+)/i) || text.match(/ATTACK:\s*(.+)/i);
    const commentaryMatch = text.match(/COMMENTARY:\s*(.+)/i);

    // Tolerate replies like "[Rock]", "Rock.", "Hit!", or "Pit 3" / "Position 5"
    const tokens = moveMatch
      ? moveMatch[1].replace(/[[\]()"'<>.!;:]/g, " ").trim().split(/[\s,]+/).filter(Boolean)
      : [];
    const move =
      tokens.length === 0
        ? null
        : /^(pit|position|pos|square|cell)$/i.test(tokens[0]) && tokens[1]
          ? tokens[1]
          : tokens[0];
    const commentary = commentaryMatch ? commentaryMatch[1].trim() : "Executing strategy.";

    if (!move) {
      console.error("[API] No move found in Claude response:", text);
      return null;
    }

    return { move, commentary };
  } catch (error) {
    console.error("[API] Error calling Claude API:", error);
    return null;
  }
}

// ============================================
// MAIN HANDLER
// ============================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: GameRequest = await request.json();
    const { agentId, systemPrompt, userPrompt, gameType, apiProvider = "offline" } = body;

    // Validate input before doing any work
    if (!VALID_AGENTS.includes(agentId) || !VALID_GAMES.includes(gameType)) {
      return NextResponse.json({ error: "Invalid agent or game", source: "error" }, { status: 400 });
    }
    if (typeof systemPrompt !== "string" || typeof userPrompt !== "string") {
      return NextResponse.json({ error: "Invalid prompt", source: "error" }, { status: 400 });
    }
    if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS || userPrompt.length > MAX_USER_PROMPT_CHARS) {
      return NextResponse.json({ error: "Prompt too long", source: "error" }, { status: 413 });
    }
    const temperature = Math.min(1, Math.max(0, Number(body.temperature) || 0.7));
    const postGame = isPostGameRequest(userPrompt);

    console.log(`[API] Received ${postGame ? "post-game" : "move"} request for ${agentId} playing ${gameType}, provider: ${apiProvider}`);

    // Helper to get valid offline move (or an in-character reaction for post-game requests)
    const getOfflineMove = () => {
      if (postGame) {
        return getOfflinePostGame(agentId, userPrompt);
      }

      let result: { move: string; commentary: string };

      // Blackjack needs userPrompt to determine the total
      if (gameType === "blackjack") {
        result = AGENT_OFFLINE_LOGIC[agentId].blackjack(userPrompt);
      } else if (gameType === "war") {
        result = AGENT_OFFLINE_LOGIC[agentId].war();
      } else if (gameType === "rps") {
        result = AGENT_OFFLINE_LOGIC[agentId].rps();
      } else if (gameType === "ttt") {
        result = AGENT_OFFLINE_LOGIC[agentId].ttt(userPrompt);
      } else {
        result = AGENT_OFFLINE_LOGIC[agentId].mancala(userPrompt);
      }

      // Safety net: if an offline choice is somehow illegal, swap in a legal one.
      // (Legal choices are left alone so the move always matches the agent's commentary.)
      if (gameType === "ttt") {
        const availableMoves = parseAvailableTTTMoves(userPrompt);
        if (availableMoves.length > 0 && !availableMoves.includes(Number(result.move))) {
          result = { ...result, move: String(pick(availableMoves)) };
        }
      }
      if (gameType === "mancala") {
        const availablePits = parseAvailableMancalaPits(userPrompt);
        if (availablePits.length > 0 && !availablePits.includes(Number(result.move))) {
          result = { ...result, move: String(pick(availablePits)) };
        }
      }

      return result;
    };

    // Use offline mode if requested
    if (apiProvider === "offline") {
      console.log("[API] Using offline mode");
      const result = getOfflineMove();
      return NextResponse.json({
        ...result,
        source: "offline",
      });
    }

    // Try Claude API
    if (apiProvider === "claude") {
      const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

      if (!hasApiKey) {
        console.log("[API] No Claude API key, falling back to offline");
        const result = getOfflineMove();
        return NextResponse.json({
          ...result,
          source: "offline",
        });
      }

      if (isRateLimited(getClientIp(request))) {
        console.log("[API] Rate limit hit, falling back to offline");
        const result = getOfflineMove();
        return NextResponse.json({
          ...result,
          source: "offline",
        });
      }

      const apiResult = await callClaudeAPI(systemPrompt, userPrompt, temperature, !postGame);

      if (apiResult) {
        console.log("[API] Successfully got response from Claude");
        return NextResponse.json({
          ...apiResult,
          source: "api",
        });
      }

      // API failed, fall back to offline
      console.log("[API] Claude API call failed, falling back to offline mode");
      const offlineResult = getOfflineMove();
      return NextResponse.json({
        ...offlineResult,
        source: "offline",
      });
    }

    // Default to offline
    const result = getOfflineMove();
    return NextResponse.json({
      ...result,
      source: "offline",
    });
  } catch (error) {
    console.error("[API] Error in game route:", error);
    return NextResponse.json(
      { error: "Internal server error", source: "error" },
      { status: 500 }
    );
  }
}

// Health check. Also tells the UI whether Claude mode is available on this server
// (true only when ANTHROPIC_API_KEY is set; the key itself is never sent).
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: "ok",
    message: "Game API is running",
    claudeAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}
