# AI Agent Arena

Five AI personalities face off in classic games, trash-talking and holding grudges as they go.

**Live demo: [agent-arena-khaki.vercel.app](https://agent-arena-khaki.vercel.app)**. It runs in offline mode, so it's free to play and needs no sign-up.

Pick two agents and a game, then watch them play. Each agent has its own strategy and voice, remembers past matches, and reacts to wins, losses, and rivalries. You can also jump in yourself for an exhibition match against any agent.

## The agents

| Agent | Style |
|---|---|
| **The Analyst** | Plays the odds. Speaks in probabilities and expected value. |
| **Chaos** | Deliberately unpredictable. Lives for surprise. |
| **The Strategist** | Patient, positional, always thinking a few moves ahead. |
| **The Rookie** | Enthusiastic beginner, still figuring things out. |
| **The Diva** | Supremely confident. Takes losses personally. |

## The games

Rock-Paper-Scissors · Tic-Tac-Toe · Mancala · War · Blackjack

## How it works

- **Two modes.** In **Claude API mode**, each turn sends the game state and the agent's personality to Claude, which replies with a move and in-character commentary. In **Offline mode**, each personality runs its own scripted logic (for example, the Analyst plays blackjack by the book), so the arena works with no API key at all.
- **Persistent memory.** Every agent tracks wins, losses, per-game records, rivalries, its nemesis, and win streaks across the last 500 matches (stored in your browser). That history is fed back into the agents' prompts, so rivalries carry over between games.
- **Post-game reactions.** After each match, agents react in character to the result and to how the rivalry is going.
- **Graceful fallback.** If the API is unavailable, rate-limited, or returns something unusable, the agent falls back to its offline logic instead of breaking the game.
- **Safe to deploy publicly.** The API route only accepts known agents and games, caps prompt sizes, limits output length, and rate-limits each visitor, so a public deployment can't be used as a free general-purpose AI endpoint.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React + TypeScript
- Tailwind CSS
- Anthropic Claude API (called server-side from a Next.js route handler, so the key never reaches the browser)

## How I built this with AI

I built Agent Arena with **Claude** as my coding partner. It began as an experiment in my projects folder, and I came back to turn it into something finished and safe to put online.

**How we split the work.** I decided what the arena should do, played it constantly, and reported what felt wrong. Claude wrote and debugged most of the code, and I checked every fix by playing again.

**Real problems we hit and how they got solved:**

1. **Tournaments couldn't be stopped, and the results screen wouldn't close.** We added stop controls for tournaments and single games, and fixed the results screen so it dismisses properly.
2. **Rock-Paper-Scissors kept ending in ties.** Tied rounds are now replayed until there's a winner, the way people actually play.
3. **AI moves weren't always legal.** A language model replies in text, and text can be wrong. Every move is now checked against each game's rules before it's applied. After three bad attempts, the game plays a guaranteed-legal move and notes it in the log.
4. **Mancala broke its own rules.** Extra turns weren't granted correctly, and the list of valid moves shown to the AI didn't match the pit numbers it was asked to choose from. Both were fixed.
5. **A public AI endpoint could be abused.** Anyone could have used the server route as a free chatbot. It now only accepts known agents and games, caps prompt and reply sizes, and limits each visitor to 60 requests a minute.
6. **The Claude mode needed a key nobody else has.** On a server without an API key, the Claude option is greyed out with an explanation, and everything runs on the offline personalities.

We also added more in-character lines for each agent, so matches don't repeat the same trash talk.

## Running it locally

```bash
npm install
cp .env.example .env.local   # optional: add your Anthropic API key
npm run dev
```

Then open http://localhost:3000. Use the selector in the top-right corner to switch between **OFFLINE** and **CLAUDE API** modes.

### Configuration

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | For API mode | Your key from [console.anthropic.com](https://console.anthropic.com/). Without it, the arena runs in offline mode. |
| `ANTHROPIC_MODEL` | No | Claude model to use. Defaults to `claude-haiku-5-5` (fast and inexpensive for short game moves). |

## Project structure

```
app/
  page.tsx                     Entry point
  components/AgentGameArena.tsx  Game UI, game logic, and agent prompts
  lib/agentMemory.ts           Persistent stats, rivalries, and match history
  api/game/route.ts            Server route: Claude calls, offline logic, request guards
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Lint with ESLint |
| `npm run typecheck` | Type-check with TypeScript |
