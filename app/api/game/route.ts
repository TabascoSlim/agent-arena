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

const AGENT_OFFLINE_LOGIC: Record<
  AgentId,
  {
    rps: () => { move: string; commentary: string };
    ttt: () => { move: string; commentary: string };
    mancala: (userPrompt: string) => { move: string; commentary: string };
    war: () => { move: string; commentary: string };
    blackjack: (userPrompt: string) => { move: string; commentary: string };
  }
> = {
  analyst: {
    rps: () => {
      const moves = ["Rock", "Paper", "Scissors"];
      const weights = [0.3, 0.4, 0.3];
      const move = weightedRandom(moves, weights);
      return {
        move,
        commentary: `Based on game theory analysis, ${move} offers the optimal expected value.`,
      };
    },
    ttt: () => {
      const positions = [5, 1, 3, 7, 9, 2, 4, 6, 8];
      const move = positions[Math.floor(Math.random() * positions.length)];
      return {
        move: String(move),
        commentary: move === 5
          ? "Securing the center provides maximum strategic control."
          : [1, 3, 7, 9].includes(move)
          ? "Controlling corners creates winning opportunities."
          : "Maintaining positional advantage.",
      };
    },
    mancala: (userPrompt: string) => {
      const availablePits = parseAvailableMancalaPits(userPrompt);
      // Analyst prefers pits with more stones (higher value moves)
      const pit = availablePits.length > 0 ? availablePits[Math.floor(Math.random() * availablePits.length)] : 1;
      return {
        move: String(pit),
        commentary: `Selecting pit ${pit} based on stone distribution analysis. This move optimizes capture probability.`,
      };
    },
    war: () => {
      return {
        move: "Draw",
        commentary: "The expected value of any card draw follows a uniform distribution. Let's observe the outcome.",
      };
    },
    blackjack: (userPrompt: string) => {
      const totalMatch = userPrompt.match(/Total:\s*(\d+)/);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      // Analyst plays by the book: hit on 16 or less, stand on 17+
      const move = total <= 16 ? "Hit" : "Stand";
      return {
        move,
        commentary: total <= 16
          ? `With ${total}, probability favors drawing another card. Statistical analysis supports this decision.`
          : `At ${total}, the risk-reward ratio suggests standing. Further draws increase bust probability significantly.`,
      };
    },
  },
  chaos: {
    rps: () => {
      const moves = ["Rock", "Paper", "Scissors"];
      const move = moves[Math.floor(Math.random() * moves.length)];
      const chaosComments = [
        "Let's shake things up!",
        "You'll never see this coming!",
        "RNGesus, guide my hand!",
        "Chaos reigns supreme!",
        "Predictable is boring!",
      ];
      return {
        move,
        commentary: chaosComments[Math.floor(Math.random() * chaosComments.length)],
      };
    },
    ttt: () => {
      const move = Math.floor(Math.random() * 9) + 1;
      const chaosComments = [
        "Randomness is my strategy!",
        "Let's put it... here! Why not?",
        "Chaos doesn't need a reason!",
        "Surprise!",
      ];
      return {
        move: String(move),
        commentary: chaosComments[Math.floor(Math.random() * chaosComments.length)],
      };
    },
    mancala: (userPrompt: string) => {
      const availablePits = parseAvailableMancalaPits(userPrompt);
      const pit = availablePits.length > 0 ? availablePits[Math.floor(Math.random() * availablePits.length)] : 1;
      const chaosComments = [
        "SCOOP THE STONES! Let's GO!",
        "Random pit for maximum CHAOS!",
        "Mancala madness time!",
        "Who needs strategy when you have CHAOS?!",
      ];
      return {
        move: String(pit),
        commentary: chaosComments[Math.floor(Math.random() * chaosComments.length)],
      };
    },
    war: () => {
      const chaosComments = [
        "FLIP THAT CARD! Let chaos decide!",
        "Come on, big money, no whammies!",
        "The card gods smile upon chaos!",
        "YOLO flip!",
      ];
      return {
        move: "Draw",
        commentary: chaosComments[Math.floor(Math.random() * chaosComments.length)],
      };
    },
    blackjack: (userPrompt: string) => {
      const totalMatch = userPrompt.match(/Total:\s*(\d+)/);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      // Chaos agent is unpredictable - sometimes hits even when shouldn't
      const chaosHit = Math.random() < 0.4; // 40% chance to hit regardless
      const move = total > 21 ? "Stand" : (total <= 11 || chaosHit) ? "Hit" : "Stand";
      const chaosComments = [
        "Let's get CRAZY!",
        "Fortune favors the bold... or the foolish!",
        "Rules are for boring people!",
        "YOLO!",
      ];
      return {
        move,
        commentary: chaosComments[Math.floor(Math.random() * chaosComments.length)],
      };
    },
  },
  strategist: {
    rps: () => {
      const moves = ["Rock", "Paper", "Scissors"];
      const move = moves[Math.floor(Math.random() * moves.length)];
      return {
        move,
        commentary: `A balanced approach. ${move} maintains flexibility for future rounds.`,
      };
    },
    ttt: () => {
      const positions = [1, 3, 7, 9, 5, 2, 4, 6, 8];
      const move = positions[Math.floor(Math.random() * positions.length)];
      return {
        move: String(move),
        commentary: [1, 3, 7, 9].includes(move)
          ? "Setting up a fork position. Multiple threats incoming."
          : "Adapting to board state. Maintaining initiative.",
      };
    },
    mancala: (userPrompt: string) => {
      const availablePits = parseAvailableMancalaPits(userPrompt);
      const pit = availablePits.length > 0 ? availablePits[Math.floor(Math.random() * availablePits.length)] : 1;
      return {
        move: String(pit),
        commentary: `Pit ${pit} offers optimal stone distribution. This move maintains positional control.`,
      };
    },
    war: () => {
      return {
        move: "Draw",
        commentary: "In War, the outcome is predetermined. I draw with acceptance of whatever fate brings.",
      };
    },
    blackjack: (userPrompt: string) => {
      const totalMatch = userPrompt.match(/Total:\s*(\d+)/);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      // Strategist plays optimal basic strategy
      const move = total <= 16 ? "Hit" : "Stand";
      return {
        move,
        commentary: total <= 16
          ? `At ${total}, the mathematically sound play is to hit. Patience and discipline.`
          : `Standing at ${total}. The long game rewards those who know when to hold.`,
      };
    },
  },
  rookie: {
    rps: () => {
      const moves = ["Rock", "Paper", "Scissors"];
      const move = moves[Math.floor(Math.random() * moves.length)];
      const rookieComments = [
        "Here goes nothing!",
        "I hope this works!",
        "Ooh, tough choice!",
        "Wait, what did they just play?",
        "I'm still learning this!",
      ];
      return {
        move,
        commentary: rookieComments[Math.floor(Math.random() * rookieComments.length)],
      };
    },
    ttt: () => {
      const shouldMakeMistake = Math.random() < 0.2;
      let move;
      if (shouldMakeMistake) {
        const edges = [2, 4, 6, 8];
        move = edges[Math.floor(Math.random() * edges.length)];
      } else {
        move = Math.floor(Math.random() * 9) + 1;
      }
      const rookieComments = [
        "Is this a good spot?",
        "I think this works?",
        "Ooh, I didn't see that!",
        "Learning as I go!",
      ];
      return {
        move: String(move),
        commentary: rookieComments[Math.floor(Math.random() * rookieComments.length)],
      };
    },
    mancala: (userPrompt: string) => {
      const availablePits = parseAvailableMancalaPits(userPrompt);
      const pit = availablePits.length > 0 ? availablePits[Math.floor(Math.random() * availablePits.length)] : 1;
      const rookieComments = [
        "I'll try this pit!",
        "Scooping stones is fun!",
        "Did I do that right?",
        "This game is tricky!",
      ];
      return {
        move: String(pit),
        commentary: rookieComments[Math.floor(Math.random() * rookieComments.length)],
      };
    },
    war: () => {
      const rookieComments = [
        "Ooh, I love flipping cards!",
        "Please be a high card!",
        "This is so exciting!",
        "Here goes nothing!",
      ];
      return {
        move: "Draw",
        commentary: rookieComments[Math.floor(Math.random() * rookieComments.length)],
      };
    },
    blackjack: (userPrompt: string) => {
      const totalMatch = userPrompt.match(/Total:\s*(\d+)/);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      // Rookie sometimes makes mistakes - hits too high or stands too low
      const makeMistake = Math.random() < 0.25;
      let move;
      if (makeMistake) {
        move = total >= 17 ? "Hit" : "Stand"; // Opposite of optimal
      } else {
        move = total <= 16 ? "Hit" : "Stand";
      }
      const rookieComments = [
        "Um, I think I should...",
        "Is this the right play?",
        "Ooh, this is nerve-wracking!",
        "I'm still learning!",
      ];
      return {
        move,
        commentary: rookieComments[Math.floor(Math.random() * rookieComments.length)],
      };
    },
  },
  diva: {
    rps: () => {
      const moves = ["Rock", "Paper", "Scissors"];
      const move = moves[Math.floor(Math.random() * moves.length)];
      const divaComments = [
        "Watch and learn, darlings!",
        "This move is absolutely ICONIC!",
        "The spotlight is on ME!",
        "Prepare to be DAZZLED!",
        "A star never reveals their strategy... until NOW!",
      ];
      return {
        move,
        commentary: divaComments[Math.floor(Math.random() * divaComments.length)],
      };
    },
    ttt: () => {
      const positions = [5, 1, 3, 7, 9, 2, 4, 6, 8];
      const move = positions[Math.floor(Math.random() * positions.length)];
      const divaComments = [
        "Center stage is MINE, darling!",
        "A dramatic move for a dramatic star!",
        "The audience will LOVE this!",
        "Fabulous positioning, if I say so myself!",
      ];
      return {
        move: String(move),
        commentary: move === 5
          ? "Center stage is MINE, obviously!"
          : divaComments[Math.floor(Math.random() * divaComments.length)],
      };
    },
    mancala: (userPrompt: string) => {
      const availablePits = parseAvailableMancalaPits(userPrompt);
      const pit = availablePits.length > 0 ? availablePits[Math.floor(Math.random() * availablePits.length)] : 1;
      const divaComments = [
        "Scooping stones with ELEGANCE!",
        "This move is pure ARTISTRY!",
        "Watch me DOMINATE this board!",
        "A FABULOUS stone cascade incoming!",
      ];
      return {
        move: String(pit),
        commentary: divaComments[Math.floor(Math.random() * divaComments.length)],
      };
    },
    war: () => {
      const divaComments = [
        "Watch this FABULOUS card flip!",
        "The cards ADORE me!",
        "A star's luck is LEGENDARY!",
        "This will be ICONIC!",
      ];
      return {
        move: "Draw",
        commentary: divaComments[Math.floor(Math.random() * divaComments.length)],
      };
    },
    blackjack: (userPrompt: string) => {
      const totalMatch = userPrompt.match(/Total:\s*(\d+)/);
      const total = totalMatch ? parseInt(totalMatch[1]) : 0;
      // Diva plays reasonably but with flair
      const move = total <= 16 ? "Hit" : "Stand";
      const hitComments = [
        "Hit me, darling! A star needs MORE!",
        "Give me another card! I'm feeling LUCKY!",
        "More cards for the QUEEN!",
      ];
      const standComments = [
        "I'll stand with GRACE and POISE!",
        "This hand is PERFECTION!",
        "A diva knows when to hold her ground!",
      ];
      return {
        move,
        commentary: move === "Hit"
          ? hitComments[Math.floor(Math.random() * hitComments.length)]
          : standComments[Math.floor(Math.random() * standComments.length)],
      };
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
  const match = userPrompt.match(/Available pits:\s*([\d,\s]+)/i);
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

    const move = moveMatch ? moveMatch[1].trim().split(/[\s,]/)[0] : null;
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
        result = AGENT_OFFLINE_LOGIC[agentId].ttt();
      } else {
        result = AGENT_OFFLINE_LOGIC[agentId].mancala(userPrompt);
      }

      // For TTT, ensure we pick from available moves
      if (gameType === "ttt") {
        const availableMoves = parseAvailableTTTMoves(userPrompt);
        if (availableMoves.length > 0) {
          const move = availableMoves[Math.floor(Math.random() * availableMoves.length)];
          result = { ...result, move: String(move) };
        }
      }

      // For Mancala, ensure we pick from available pits
      if (gameType === "mancala") {
        const availablePits = parseAvailableMancalaPits(userPrompt);
        if (availablePits.length > 0) {
          const pit = availablePits[Math.floor(Math.random() * availablePits.length)];
          result = { ...result, move: String(pit) };
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

// Support GET for health check
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok", message: "Game API is running" });
}
