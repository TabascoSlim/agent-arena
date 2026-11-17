import { AGENTS } from "./data/config";
import { AgentId, TournamentMatch } from "./types";

export const getRandomAgent = (excludeAgentId: AgentId | null): AgentId => {
  const agentIds = Object.keys(AGENTS) as AgentId[];
  const availableAgents = excludeAgentId
    ? agentIds.filter(id => id !== excludeAgentId)
    : agentIds;
  return availableAgents[Math.floor(Math.random() * availableAgents.length)];
};

// Generate round-robin tournament matches (each agent plays every other agent once)
export const generateRoundRobinMatches = (): TournamentMatch[] => {
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
