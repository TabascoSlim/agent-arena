// ============================================
// AGENT MEMORY SYSTEM
// Persistent localStorage-based memory for agents
// ============================================

type AgentId = "analyst" | "chaos" | "strategist" | "rookie" | "diva";
type GameType = "rps" | "ttt" | "mancala" | "war" | "blackjack";

export interface MatchRecord {
  id: string;
  timestamp: number;
  gameType: GameType;
  agent1: { id: AgentId; name: string };
  agent2: { id: AgentId; name: string };
  winner: 0 | 1 | null;
  rounds: number;
  duration: number;
}

export interface GameStats {
  wins: number;
  losses: number;
  ties: number;
  totalGames: number;
}

export interface AgentMemory {
  agentId: AgentId;
  stats: GameStats;
  gameStats: Record<GameType, GameStats>;
  rivalries: Record<AgentId, GameStats>;
  recentInsights: string[];
  favoriteGame: GameType | null;
  nemesis: AgentId | null;
  bestMatchup: AgentId | null;
  longestWinStreak: number;
  currentWinStreak: number;
  lastUpdated: number;
}

export interface ArenaMemory {
  agents: Record<AgentId, AgentMemory>;
  matchHistory: MatchRecord[];
  totalMatches: number;
  lastUpdated: number;
}

const STORAGE_KEY = "agent-arena-memory";
const MAX_HISTORY_SIZE = 500; // Keep last 500 matches

const AGENT_IDS: AgentId[] = ["analyst", "chaos", "strategist", "rookie", "diva"];
const GAME_TYPES: GameType[] = ["rps", "ttt", "mancala", "war", "blackjack"];

// Initialize empty stats
const createEmptyStats = (): GameStats => ({
  wins: 0,
  losses: 0,
  ties: 0,
  totalGames: 0,
});

// Initialize empty agent memory
const createEmptyAgentMemory = (agentId: AgentId): AgentMemory => ({
  agentId,
  stats: createEmptyStats(),
  gameStats: GAME_TYPES.reduce((acc, game) => {
    acc[game] = createEmptyStats();
    return acc;
  }, {} as Record<GameType, GameStats>),
  rivalries: AGENT_IDS.filter(id => id !== agentId).reduce((acc, id) => {
    acc[id] = createEmptyStats();
    return acc;
  }, {} as Record<AgentId, GameStats>),
  recentInsights: [],
  favoriteGame: null,
  nemesis: null,
  bestMatchup: null,
  longestWinStreak: 0,
  currentWinStreak: 0,
  lastUpdated: Date.now(),
});

// Initialize empty arena memory
const createEmptyArenaMemory = (): ArenaMemory => ({
  agents: AGENT_IDS.reduce((acc, id) => {
    acc[id] = createEmptyAgentMemory(id);
    return acc;
  }, {} as Record<AgentId, AgentMemory>),
  matchHistory: [],
  totalMatches: 0,
  lastUpdated: Date.now(),
});

// Load memory from localStorage
export const loadMemory = (): ArenaMemory => {
  if (typeof window === "undefined") {
    return createEmptyArenaMemory();
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ArenaMemory;
      // Validate and merge with defaults to handle schema changes
      const memory = createEmptyArenaMemory();

      // Merge stored data
      if (parsed.matchHistory) {
        memory.matchHistory = parsed.matchHistory;
        memory.totalMatches = parsed.totalMatches || parsed.matchHistory.length;
      }

      // Merge agent memories
      AGENT_IDS.forEach(id => {
        if (parsed.agents && parsed.agents[id]) {
          memory.agents[id] = {
            ...memory.agents[id],
            ...parsed.agents[id],
          };
        }
      });

      return memory;
    }
  } catch (error) {
    console.error("Failed to load agent memory:", error);
  }

  return createEmptyArenaMemory();
};

// Save memory to localStorage
export const saveMemory = (memory: ArenaMemory): void => {
  if (typeof window === "undefined") return;

  try {
    // Trim history if too large
    if (memory.matchHistory.length > MAX_HISTORY_SIZE) {
      memory.matchHistory = memory.matchHistory.slice(-MAX_HISTORY_SIZE);
    }

    memory.lastUpdated = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch (error) {
    console.error("Failed to save agent memory:", error);
  }
};

// Update stats helper
const updateStats = (stats: GameStats, result: "win" | "loss" | "tie"): GameStats => ({
  wins: stats.wins + (result === "win" ? 1 : 0),
  losses: stats.losses + (result === "loss" ? 1 : 0),
  ties: stats.ties + (result === "tie" ? 1 : 0),
  totalGames: stats.totalGames + 1,
});

// Calculate win rate
export const getWinRate = (stats: GameStats): number => {
  if (stats.totalGames === 0) return 0;
  return Math.round((stats.wins / stats.totalGames) * 100);
};

// Generate insight based on match outcome
const generateInsight = (
  agentId: AgentId,
  opponentId: AgentId,
  gameType: GameType,
  result: "win" | "loss" | "tie",
  memory: AgentMemory
): string | null => {
  const rivalry = memory.rivalries[opponentId];
  const gameStats = memory.gameStats[gameType];

  // Only generate insights for significant events
  if (result === "win" && memory.currentWinStreak >= 3) {
    return `On a ${memory.currentWinStreak}-game winning streak!`;
  }

  if (result === "win" && rivalry.wins === 1 && rivalry.losses >= 3) {
    return `Finally beat ${opponentId} after ${rivalry.losses} losses!`;
  }

  if (result === "loss" && rivalry.losses >= 5 && rivalry.wins === 0) {
    return `${opponentId} remains unbeaten against me (0-${rivalry.losses})`;
  }

  if (gameStats.totalGames === 10 && getWinRate(gameStats) >= 70) {
    return `Becoming dominant at ${gameType} (${getWinRate(gameStats)}% win rate)`;
  }

  return null;
};

// Find nemesis (opponent with worst record against)
const findNemesis = (rivalries: Record<AgentId, GameStats>): AgentId | null => {
  let nemesis: AgentId | null = null;
  let worstRate = 100;

  Object.entries(rivalries).forEach(([id, stats]) => {
    if (stats.totalGames >= 3) {
      const rate = getWinRate(stats);
      if (rate < worstRate) {
        worstRate = rate;
        nemesis = id as AgentId;
      }
    }
  });

  return worstRate < 40 ? nemesis : null;
};

// Find best matchup (opponent with best record against)
const findBestMatchup = (rivalries: Record<AgentId, GameStats>): AgentId | null => {
  let best: AgentId | null = null;
  let bestRate = 0;

  Object.entries(rivalries).forEach(([id, stats]) => {
    if (stats.totalGames >= 3) {
      const rate = getWinRate(stats);
      if (rate > bestRate) {
        bestRate = rate;
        best = id as AgentId;
      }
    }
  });

  return bestRate > 60 ? best : null;
};

// Find favorite game (best win rate)
const findFavoriteGame = (gameStats: Record<GameType, GameStats>): GameType | null => {
  let favorite: GameType | null = null;
  let bestRate = 0;

  Object.entries(gameStats).forEach(([game, stats]) => {
    if (stats.totalGames >= 5) {
      const rate = getWinRate(stats);
      if (rate > bestRate) {
        bestRate = rate;
        favorite = game as GameType;
      }
    }
  });

  return bestRate > 50 ? favorite : null;
};

// Record a match result and update all relevant stats
export const recordMatch = (memory: ArenaMemory, match: MatchRecord): ArenaMemory => {
  const newMemory = { ...memory };
  newMemory.matchHistory = [...memory.matchHistory, match];
  newMemory.totalMatches = memory.totalMatches + 1;

  const agent1Id = match.agent1.id;
  const agent2Id = match.agent2.id;

  // Determine results
  const agent1Result: "win" | "loss" | "tie" =
    match.winner === null ? "tie" : match.winner === 0 ? "win" : "loss";
  const agent2Result: "win" | "loss" | "tie" =
    match.winner === null ? "tie" : match.winner === 1 ? "win" : "loss";

  // Update agent 1
  const agent1Memory = { ...memory.agents[agent1Id] };
  agent1Memory.stats = updateStats(agent1Memory.stats, agent1Result);
  agent1Memory.gameStats = {
    ...agent1Memory.gameStats,
    [match.gameType]: updateStats(agent1Memory.gameStats[match.gameType], agent1Result),
  };
  agent1Memory.rivalries = {
    ...agent1Memory.rivalries,
    [agent2Id]: updateStats(agent1Memory.rivalries[agent2Id], agent1Result),
  };

  // Update win streaks for agent 1
  if (agent1Result === "win") {
    agent1Memory.currentWinStreak += 1;
    if (agent1Memory.currentWinStreak > agent1Memory.longestWinStreak) {
      agent1Memory.longestWinStreak = agent1Memory.currentWinStreak;
    }
  } else {
    agent1Memory.currentWinStreak = 0;
  }

  // Generate insight for agent 1
  const insight1 = generateInsight(agent1Id, agent2Id, match.gameType, agent1Result, agent1Memory);
  if (insight1) {
    agent1Memory.recentInsights = [insight1, ...agent1Memory.recentInsights].slice(0, 5);
  }

  // Update derived stats for agent 1
  agent1Memory.nemesis = findNemesis(agent1Memory.rivalries);
  agent1Memory.bestMatchup = findBestMatchup(agent1Memory.rivalries);
  agent1Memory.favoriteGame = findFavoriteGame(agent1Memory.gameStats);
  agent1Memory.lastUpdated = Date.now();

  // Update agent 2
  const agent2Memory = { ...memory.agents[agent2Id] };
  agent2Memory.stats = updateStats(agent2Memory.stats, agent2Result);
  agent2Memory.gameStats = {
    ...agent2Memory.gameStats,
    [match.gameType]: updateStats(agent2Memory.gameStats[match.gameType], agent2Result),
  };
  agent2Memory.rivalries = {
    ...agent2Memory.rivalries,
    [agent1Id]: updateStats(agent2Memory.rivalries[agent1Id], agent2Result),
  };

  // Update win streaks for agent 2
  if (agent2Result === "win") {
    agent2Memory.currentWinStreak += 1;
    if (agent2Memory.currentWinStreak > agent2Memory.longestWinStreak) {
      agent2Memory.longestWinStreak = agent2Memory.currentWinStreak;
    }
  } else {
    agent2Memory.currentWinStreak = 0;
  }

  // Generate insight for agent 2
  const insight2 = generateInsight(agent2Id, agent1Id, match.gameType, agent2Result, agent2Memory);
  if (insight2) {
    agent2Memory.recentInsights = [insight2, ...agent2Memory.recentInsights].slice(0, 5);
  }

  // Update derived stats for agent 2
  agent2Memory.nemesis = findNemesis(agent2Memory.rivalries);
  agent2Memory.bestMatchup = findBestMatchup(agent2Memory.rivalries);
  agent2Memory.favoriteGame = findFavoriteGame(agent2Memory.gameStats);
  agent2Memory.lastUpdated = Date.now();

  newMemory.agents = {
    ...memory.agents,
    [agent1Id]: agent1Memory,
    [agent2Id]: agent2Memory,
  };

  return newMemory;
};

// Build memory context for agent prompts
export const buildMemoryContext = (
  agentId: AgentId,
  opponentId: AgentId,
  gameType: GameType,
  memory: ArenaMemory
): string => {
  const agentMemory = memory.agents[agentId];
  const rivalry = agentMemory.rivalries[opponentId];
  const gameStats = agentMemory.gameStats[gameType];

  const lines: string[] = [];

  // Overall experience
  if (agentMemory.stats.totalGames > 0) {
    lines.push(`LIFETIME RECORD: ${agentMemory.stats.wins}W-${agentMemory.stats.losses}L-${agentMemory.stats.ties}T (${getWinRate(agentMemory.stats)}% win rate)`);
  }

  // Game-specific experience
  if (gameStats.totalGames > 0) {
    lines.push(`${gameType.toUpperCase()} RECORD: ${gameStats.wins}W-${gameStats.losses}L-${gameStats.ties}T (${getWinRate(gameStats)}% win rate)`);
  }

  // Head-to-head with opponent
  if (rivalry.totalGames > 0) {
    lines.push(`VS ${opponentId.toUpperCase()}: ${rivalry.wins}W-${rivalry.losses}L-${rivalry.ties}T`);
  }

  // Current form
  if (agentMemory.currentWinStreak >= 2) {
    lines.push(`CURRENT STREAK: ${agentMemory.currentWinStreak} wins`);
  }

  // Psychological factors
  if (agentMemory.nemesis === opponentId) {
    lines.push(`WARNING: ${opponentId} is your nemesis - they have historically dominated you`);
  } else if (agentMemory.bestMatchup === opponentId) {
    lines.push(`CONFIDENCE: You have a strong historical record against ${opponentId}`);
  }

  // Favorite game advantage
  if (agentMemory.favoriteGame === gameType) {
    lines.push(`ADVANTAGE: ${gameType} is your strongest game`);
  }

  // Recent insights
  if (agentMemory.recentInsights.length > 0) {
    lines.push(`RECENT NOTES: ${agentMemory.recentInsights[0]}`);
  }

  if (lines.length === 0) {
    return "MEMORY: No previous match data. This is a fresh start.";
  }

  return "MEMORY:\n" + lines.join("\n");
};

// Get recent matches between two agents
export const getRecentMatches = (
  memory: ArenaMemory,
  agent1Id: AgentId,
  agent2Id: AgentId,
  gameType?: GameType,
  limit: number = 5
): MatchRecord[] => {
  return memory.matchHistory
    .filter(m =>
      ((m.agent1.id === agent1Id && m.agent2.id === agent2Id) ||
       (m.agent1.id === agent2Id && m.agent2.id === agent1Id)) &&
      (!gameType || m.gameType === gameType)
    )
    .slice(-limit);
};

// Clear all memory (for testing/reset)
export const clearMemory = (): void => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
};

// Export memory as JSON (for backup)
export const exportMemory = (): string => {
  const memory = loadMemory();
  return JSON.stringify(memory, null, 2);
};

// Import memory from JSON (for restore)
export const importMemory = (json: string): boolean => {
  try {
    const memory = JSON.parse(json) as ArenaMemory;
    saveMemory(memory);
    return true;
  } catch {
    return false;
  }
};
