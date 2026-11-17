"use client";

import React, { useState, useEffect, useRef, useCallback, useReducer, useMemo } from "react";
import {
  ArenaMemory,
  loadMemory,
  saveMemory,
  recordMatch,
  getWinRate,
  clearMemory,
} from "../lib/agentMemory";
import AgentModel from "./AgentModel";
import { TypewriterText } from "../arena/TypewriterText";
import { callGameAPI } from "../arena/api";
import { AGENT_ASCII, RPS_ASCII, getCardAscii } from "../arena/data/ascii";
import { AGENTS, GAMES, HUMAN_COLORS, HUMAN_COLOR_KEY, THEMES } from "../arena/data/config";
import { LOSE_QUOTES, TIE_QUOTES, WIN_QUOTES, getRandomQuote } from "../arena/data/quotes";
import { BlackjackGame } from "../arena/games/blackjack";
import { MancalaGame } from "../arena/games/mancala";
import { applyMove, getFallbackMove, nextPlayerAfter } from "../arena/games/moves";
import { RPSGame } from "../arena/games/rps";
import { TTTGame } from "../arena/games/ttt";
import { WarGame } from "../arena/games/war";
import { buildDynamicSystemPrompt } from "../arena/prompts";
import { gameReducer, initialState } from "../arena/state";
import { generateRoundRobinMatches, getRandomAgent } from "../arena/tournament";
import { AgentId, ApiProvider, GameType, MatchRecord, SpeedMultiplier, ThemeId, TournamentMatch } from "../arena/types";
import { useTerminalSounds } from "../arena/useTerminalSounds";

export default function AgentGameArena() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const { playSound } = useTerminalSounds(state.soundEnabled);
  const gameLoopRef = useRef<boolean>(false);
  const tournamentCancelRef = useRef<boolean>(false);
  // Bumped on every match start/stop; a running loop quits as soon as its number is out of date
  const matchGenRef = useRef<number>(0);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const humanMoveRef = useRef<string | null>(null);

  // Agent Memory System - persistent localStorage storage
  // Whether this server has a Claude API key configured (checked once on load)
  const [claudeAvailable, setClaudeAvailable] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/game")
      .then((res) => res.json())
      .then((data: { claudeAvailable?: boolean }) => {
        if (cancelled) return;
        const available = Boolean(data.claudeAvailable);
        setClaudeAvailable(available);
        if (!available) dispatch({ type: "SET_API_PROVIDER", provider: "offline" });
      })
      .catch(() => {
        if (!cancelled) setClaudeAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [arenaMemory, setArenaMemory] = useState<ArenaMemory | null>(null);
  const [memoryLoaded, setMemoryLoaded] = useState(false);

  // Your colour in YOU vs BOT, remembered in this browser
  const [humanColorId, setHumanColorId] = useState("pink");
  const humanColor = (HUMAN_COLORS.find((c) => c.id === humanColorId) ?? HUMAN_COLORS[0]).hex;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HUMAN_COLOR_KEY);
      if (saved && HUMAN_COLORS.some((c) => c.id === saved)) setHumanColorId(saved);
    } catch { /* storage blocked: keep the default */ }
  }, []);
  const chooseHumanColor = (id: string) => {
    setHumanColorId(id);
    try { localStorage.setItem(HUMAN_COLOR_KEY, id); } catch { /* storage blocked: it just won't be remembered */ }
  };

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
    const gen = ++matchGenRef.current;
    await runGameLoop(game, gen);
  };

  // Stop a regular (non-tournament) match: keeps the selected game and agents so you can hit EXECUTE again
  const handleStopMatch = () => {
    matchGenRef.current++;
    gameLoopRef.current = false;
    humanMoveRef.current = null;
    dispatch({ type: "RESET_GAME" });
  };

  const runGameLoop = async (game: RPSGame | TTTGame | MancalaGame | WarGame | BlackjackGame, gen: number) => {
    let currentPlayerLocal = 0; // Use local variable to avoid dependency issues
    const stopped = () => gen !== matchGenRef.current;

    while (gameLoopRef.current && !stopped() && !game.isGameOver()) {
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
          if (stopped()) return;
          const valid = applyMove(game, player, humanMove);

          if (!valid) {
            addLog("Invalid move! Try again.");
            continue;
          }

          addLog(`You played: ${humanMove}`);
          dispatch({ type: "SET_COMMENTARY", player: 0, commentary: `You played ${humanMove}`, isTyping: false });

          await sleep(state.moveDelay / 2);

          // For RPS and War, wait for bot to play before revealing
          if (!(game instanceof RPSGame) && !(game instanceof WarGame)) {
            currentPlayerLocal = nextPlayerAfter(game, player);
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

          if (stopped()) return;
          move = response.move;
          commentary = response.commentary;

          if (move) {
            const valid = applyMove(game, player, move);

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
          const fallback = getFallbackMove(game, player);
          if (!applyMove(game, player, fallback)) {
            throw new Error(`${agent.name} failed to make a valid move after 3 attempts`);
          }
          move = fallback;
          addLog(`${agent.name} couldn't settle on a legal move; auto-played ${fallback}.`);
        }

        dispatch({ type: "SET_COMMENTARY", player, commentary, isTyping: true });
        dispatch({ type: "SET_THINKING", isThinking: false, agent: null });

        addLog(`${agent.name}: ${move}`);
        playSound("move");

        await sleep(state.moveDelay);
        if (stopped()) return;

        // For RPS and War, add extra delay after player 2's move so users can see both hands/cards
        if ((game instanceof RPSGame || game instanceof WarGame) && player === 1) {
          await sleep(state.moveDelay * 2);
        }

        // Update local player tracker and dispatch to UI (Mancala extra turns keep the same player)
        currentPlayerLocal = nextPlayerAfter(game, player);
        dispatch({ type: "SET_CURRENT_PLAYER", player: currentPlayerLocal });
      } catch (error) {
        dispatch({ type: "SET_ERROR", error: String(error) });
        dispatch({ type: "SET_THINKING", isThinking: false, agent: null });
        gameLoopRef.current = false;
        return;
      }
    }

    if (!stopped() && game.isGameOver()) {
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
        // In YOU vs BOT the first player is you, so there may be no agent to name (this record isn't saved then anyway)
        agent1: { id: state.agent1 ?? "analyst", name: state.agent1 ? AGENTS[state.agent1].name : "You" },
        agent2: { id: state.agent2 ?? "analyst", name: state.agent2 ? AGENTS[state.agent2].name : "Bot" },
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
        // Match was stopped while waiting: stop polling so the loop can exit
        if (!gameLoopRef.current) {
          clearInterval(checkMove);
          dispatch({ type: "SET_WAITING_FOR_HUMAN", waiting: false });
          resolve("");
          return;
        }
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
    tournamentCancelRef.current = false;
    dispatch({ type: "START_TOURNAMENT", matches });
    dispatch({ type: "ADD_LOG", message: `Starting Round-Robin Tournament: ${GAMES[state.selectedGame].name}` });
    dispatch({ type: "ADD_LOG", message: `Total matches: ${matches.length}` });

    // Start running the tournament
    await runTournament(matches);
  };

  // Stop a running tournament: ends the current match at the next turn and skips the rest
  const handleStopTournament = () => {
    tournamentCancelRef.current = true;
    gameLoopRef.current = false;
  };

  const runTournament = async (matches: TournamentMatch[]) => {
    for (let i = 0; i < matches.length; i++) {
      if (tournamentCancelRef.current) break;
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

      // A match interrupted by STOP is not recorded (it would otherwise count as a tie)
      if (tournamentCancelRef.current) break;

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

    if (tournamentCancelRef.current) {
      tournamentCancelRef.current = false;
      dispatch({ type: "ADD_LOG", message: "\n=== TOURNAMENT STOPPED ===" });
      dispatch({ type: "STOP_TOURNAMENT" });
      return;
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
            const valid = applyMove(game, player, move);

            if (!valid) {
              move = null;
              attempts++;
            }
          } else {
            attempts++;
          }
        }

        if (!move) {
          const fallback = getFallbackMove(game, player);
          if (!applyMove(game, player, fallback)) {
            throw new Error(`${agent.name} failed to make a valid move`);
          }
          move = fallback;
        }

        dispatch({ type: "SET_COMMENTARY", player, commentary, isTyping: false });
        dispatch({ type: "SET_THINKING", isThinking: false, agent: null });

        playSound("move");
        await sleep(state.moveDelay / 2); // Faster for tournament

        // RPS/War delay after both players move
        if ((game instanceof RPSGame || game instanceof WarGame) && player === 1) {
          await sleep(state.moveDelay);
        }

        currentPlayerLocal = nextPlayerAfter(game, player);
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


  // Picking a different game or agent after a match clears the finished board, so the new
  // line-up starts fresh instead of inheriting the last match's win screen
  const clearFinishedMatch = () => {
    if (state.gamePhase === "finished") dispatch({ type: "RESET_GAME" });
  };

  // Which mood an agent's 3D model shows: neutral while a match runs, winning or losing once it's over
  const moodFor = (player: 0 | 1): "neutral" | "win" | "lose" => {
    if (state.gamePhase !== "finished" || !state.currentGame) return "neutral";
    const winner = state.currentGame.getWinner();
    return winner === null ? "neutral" : winner === player ? "win" : "lose";
  };
  // On the win screen the winner's side panel merges into the centre box, so the winner appears only once
  const winnerSide: 0 | 1 | null =
    state.gamePhase === "finished" && state.currentGame ? (state.currentGame.getWinner() as 0 | 1 | null) : null;
  // Pick the winner's quote once per finished game, so it doesn't change every time the screen re-renders
  const winQuote = useMemo(() => {
    if (winnerSide === null || !state.currentGame || !state.agent1 || !state.agent2) return "";   // a new game gets a new quote
    const winnerId = winnerSide === 0 ? state.agent1 : state.agent2;
    const loserId = winnerSide === 0 ? state.agent2 : state.agent1;
    return getRandomQuote(WIN_QUOTES[winnerId][loserId]);
  }, [winnerSide, state.currentGame, state.agent1, state.agent2]);
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
              title={claudeAvailable ? "Choose how the agents think" : "Claude mode isn't set up on this server, so agents use offline personalities"}
            >
              <option value="offline" style={{ backgroundColor: currentTheme.background }}>
                [ OFFLINE ]
              </option>
              <option
                value="claude"
                disabled={!claudeAvailable}
                style={{ backgroundColor: currentTheme.background, color: claudeAvailable ? undefined : "#666" }}
              >
                {claudeAvailable ? "[ CLAUDE API ]" : "[ CLAUDE API: N/A ]"}
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
                    borderColor: state.gameMode === "human-vs-bot" ? humanColor : "#444",
                    color: state.gameMode === "human-vs-bot" ? humanColor : currentTheme.text,
                    backgroundColor: state.gameMode === "human-vs-bot" ? `${humanColor}20` : "transparent",
                  }}
                  onClick={() => dispatch({ type: "SET_GAME_MODE", mode: "human-vs-bot" })}
                >
                  [ YOU vs BOT ]
                </button>
                {state.gameMode === "human-vs-bot" && (
                  <span style={{ color: humanColor, fontSize: "18px" }}>
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
                    onChange={(e) => { clearFinishedMatch(); dispatch({ type: "SELECT_GAME", game: e.target.value as GameType }); }}
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
                    <label
                      className="px-3 py-2 border flex-1 flex items-center gap-2"
                      style={{ borderColor: humanColor, color: humanColor, fontSize: "23px" }}
                    >
                      <span className="whitespace-nowrap">YOU</span>
                      <select
                        aria-label="Your colour"
                        className="bg-transparent flex-1 min-w-0"
                        style={{ color: humanColor, fontSize: "20px" }}
                        value={humanColorId}
                        onChange={(e) => chooseHumanColor(e.target.value)}
                      >
                        {HUMAN_COLORS.map((c) => (
                          <option key={c.id} value={c.id} style={{ color: c.hex, backgroundColor: "#111" }}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <select
                      className="px-3 py-2 border bg-transparent flex-1"
                      style={{ borderColor: "#444", color: currentTheme.text, fontSize: "23px" }}
                      value={state.agent1 || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        clearFinishedMatch();
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
                      clearFinishedMatch();
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
                    clearFinishedMatch();
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

                {(state.gamePhase === "playing" || state.gamePhase === "placement") && state.tournamentPhase !== "running" && (
                  <button
                    className="px-4 py-2 border font-bold hover:opacity-80"
                    style={{ borderColor: "#ff3333", color: "#ff3333" }}
                    onClick={handleStopMatch}
                  >
                    [ ■ STOP ]
                  </button>
                )}

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
                      if (state.tournamentPhase === "running") {
                        handleStopTournament();
                        return;
                      }
                      handleStopMatch();
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
                  <span className="flex-1 overflow-hidden whitespace-nowrap" style={{ color: "#ff69b4" }}>
                    {"─────────────────────────────────────"}
                  </span>
                  <button
                    className="px-3 py-1 border font-bold hover:opacity-80 shrink-0"
                    style={{ borderColor: "#ff3333", color: "#ff3333" }}
                    onClick={handleStopTournament}
                  >
                    [ STOP TOURNAMENT ]
                  </button>
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
                    {state.tournamentStopped ? "TOURNAMENT STOPPED" : "TOURNAMENT COMPLETE"}
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
                          {state.tournamentStopped ? "LEADER AT STOP" : "CHAMPION"}
                        </div>
                        <AgentModel agentId={champion.agentId} mood="win" size={390} ratio={1.25} zoom={1.15} draggable={false} ascii={AGENT_ASCII[champion.agentId]} color={AGENTS[champion.agentId].color} label={`${AGENTS[champion.agentId].name}, winning`} />
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
                  {state.tournamentStopped
                    ? `STANDINGS AFTER ${state.tournamentMatches.filter((m) => m.completed).length}/${state.tournamentMatches.length} MATCHES:`
                    : "FINAL STANDINGS:"}
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
              {/* Agent 1 Panel (hidden on the win screen when this agent won: it merges into the centre box) */}
              <div className={winnerSide === 0 ? "hidden" : "lg:col-span-3"}>
                <div
                  className="border p-3 h-full"
                  style={{ borderColor: state.gameMode === "human-vs-bot" ? humanColor : AGENTS[state.agent1].color }}
                >
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b" style={{ borderColor: "#444" }}>
                    <span style={{ color: state.gameMode === "human-vs-bot" ? humanColor : AGENTS[state.agent1].color }}>●</span>
                    <span className="font-bold" style={{ color: state.gameMode === "human-vs-bot" ? humanColor : AGENTS[state.agent1].color }}>
                      {state.gameMode === "human-vs-bot" ? "YOU" : AGENTS[state.agent1].name.toUpperCase()}
                    </span>
                    {state.isThinking && state.thinkingAgent === AGENTS[state.agent1].name && (
                      <span className="animate-pulse" style={{ color: currentTheme.text }}>
                        [...]
                      </span>
                    )}
                  </div>
                  {/* 3D avatar: neutral during the match, then winning or losing (none for you in YOU vs BOT) */}
                  {winnerSide !== 0 && state.gameMode !== "human-vs-bot" && <div className="mb-2 flex justify-center">
                    <AgentModel
                      agentId={state.agent1}
                      mood={moodFor(0)}
                      size={190}
                      ratio={1}
                      zoom={1}
                      ascii={AGENT_ASCII[state.agent1]}
                      color={AGENTS[state.agent1].color}
                      label={`${AGENTS[state.agent1].name}`}
                      opacity={state.gamePhase !== "playing" || (state.isThinking && state.thinkingAgent === AGENTS[state.agent1].name) ? 1 : 0.85}
                    />
                  </div>}
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

              {/* Game Board (on the win screen it widens over the winner's column and takes the winner's colour) */}
              <div className={winnerSide === null ? "lg:col-span-6" : "lg:col-span-9"}>
                <div
                  key={winnerSide === null ? "board" : `won-${winnerSide}`}
                  className={`border p-4 h-full ${winnerSide === null ? "" : winnerSide === 0 ? "arena-merge-left" : "arena-merge-right"}`}
                  style={{
                    borderColor: winnerSide === null ? "#444" : winnerSide === 0 && state.gameMode === "human-vs-bot" ? humanColor : AGENTS[winnerSide === 0 ? state.agent1 : state.agent2].color,
                    minHeight: "300px",
                  }}
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
                            style={{ borderColor: humanColor, backgroundColor: `${humanColor}10` }}
                          >
                            <div className="text-center mb-3" style={{ color: humanColor, fontSize: "18px" }}>
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
                                      borderColor: humanColor,
                                      color: humanColor,
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
                                          borderColor: isAvailable ? humanColor : "#444",
                                          color: isAvailable ? humanColor : "#666",
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
                                          borderColor: isAvailable ? humanColor : "#444",
                                          color: isAvailable ? humanColor : "#666",
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
                                    borderColor: humanColor,
                                    color: humanColor,
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
                                    <AgentModel agentId={state.agent2!} mood="win" size={390} ratio={1.25} zoom={1.15} draggable={false} ascii={AGENT_ASCII[state.agent2!]} color={AGENTS[state.agent2!].color} label={`${AGENTS[state.agent2!].name}, winning`} />
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
                                <AgentModel
                                  agentId={state.currentGame.getWinner() === 0 ? state.agent1! : state.agent2!}
                                  mood="win"
                                  size={390}
                                  ratio={1.25}
                                  zoom={1.15}
                                  draggable={false}
                                  ascii={AGENT_ASCII[state.currentGame.getWinner() === 0 ? state.agent1! : state.agent2!]}
                                  color={state.currentGame.getWinner() === 0 ? AGENTS[state.agent1!].color : AGENTS[state.agent2!].color}
                                  label={`${state.currentGame.getWinner() === 0 ? AGENTS[state.agent1!].name : AGENTS[state.agent2!].name}, winning`}
                                />
                                <div className="text-xl mt-2" style={{
                                  color: state.currentGame.getWinner() === 0 ? AGENTS[state.agent1!].color : AGENTS[state.agent2!].color
                                }}>
                                  {`${state.currentGame.getWinner() === 0 ? AGENTS[state.agent1!].name : AGENTS[state.agent2!].name} WINS!`}
                                </div>
                                <div className="mt-4 text-base italic max-w-md mx-auto" style={{ color: currentTheme.text }}>
                                  &quot;{winQuote}&quot;
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

              {/* Agent 2 Panel (hidden on the win screen when this agent won: it merges into the centre box) */}
              <div className={winnerSide === 1 ? "hidden" : "lg:col-span-3"}>
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
                  {/* 3D avatar: neutral during the match, then winning or losing */}
                  {winnerSide !== 1 && <div className="mb-2 flex justify-center">
                    <AgentModel
                      agentId={state.agent2}
                      mood={moodFor(1)}
                      size={190}
                      ratio={1}
                      zoom={1}
                      ascii={AGENT_ASCII[state.agent2]}
                      color={AGENTS[state.agent2].color}
                      label={`${AGENTS[state.agent2].name}`}
                      opacity={state.gamePhase !== "playing" || (state.isThinking && state.thinkingAgent === AGENTS[state.agent2].name) ? 1 : 0.85}
                    />
                  </div>}
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
