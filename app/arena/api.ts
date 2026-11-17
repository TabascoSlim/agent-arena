import { AgentId, ApiProvider, GameType } from "./types";

export interface APIResponse {
  move: string;
  commentary: string;
  source: "api" | "offline";
}

export const callGameAPI = async (
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
