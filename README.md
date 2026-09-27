# AI Task Planner

An AI-powered task planning assistant built on Cloudflare's platform. Chat with an AI that breaks down your projects and goals into actionable tasks with timelines, then tracks your progress.

**Live demo:** [ai-task-planner.kumarpushan759.workers.dev](https://ai-task-planner.kumarpushan759.workers.dev)

## Features

- **AI-powered planning** — Describe a project or goal and the AI breaks it into 3-6 actionable tasks with timeline estimates
- **Task management** — Create, list, update status, and delete tasks via natural conversation
- **Conversation history** — Multiple chat sessions with auto-generated titles, persisted across visits
- **Real-time streaming** — WebSocket-based chat with live response streaming
- **User authentication** — Email/password auth with JWT tokens
- **Persistent storage** — Tasks stored in Cloudflare D1 (SQLite), chat messages in Durable Object SQLite

## Architecture

```
React (Vite)  <──WebSocket──>  Durable Object (AIChatAgent)  ──>  Workers AI (Llama 3.3 70B)
                                       │
                                       ├── D1 Database (users, tasks)
                                       └── DO SQLite (chat messages)
```

| Component    | Technology                                                              |
| ------------ | ----------------------------------------------------------------------- |
| LLM          | Llama 3.3 70B via Workers AI                                            |
| Coordination | Durable Objects (AIChatAgent)                                           |
| User input   | WebSocket chat with streaming                                           |
| State/Memory | D1 + Prisma (tasks), DO SQLite (messages), localStorage (conversations) |
| Frontend     | React 19 + Tailwind CSS 4                                               |
| Auth         | bcryptjs + JWT (jose)                                                   |
| Build        | Vite + @cloudflare/vite-plugin                                          |

## Project structure

```
src/
  server.ts    # TaskPlannerAgent DO with AI tools (createPlan, addTask, listTasks, updateTask, deleteTask)
  app.tsx      # Chat UI with conversation sidebar, auth, and tool result formatting
  auth.ts      # Registration, login, and JWT verification
  client.tsx   # React entry point
  styles.css   # Tailwind CSS
prisma/
  schema.prisma  # User and Task models
migrations/
  0001_initial/  # D1 schema migration
patches/
  workers-ai-provider+3.3.1.patch  # Fix for SSE stream duplication bug
```

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- `wrangler login` for CLI authentication

### Setup

```bash
npm install
```

### Create the D1 database

```bash
wrangler d1 create task-planner-db
```

Update the `database_id` in `wrangler.jsonc` with the ID from the output, then run the migration:

```bash
wrangler d1 migrations apply task-planner-db --remote
```

### Set the JWT secret

```bash
wrangler secret put JWT_SECRET
```

Enter a random secret string when prompted. This is used for authentication tokens.

### Generate Prisma client

```bash
npx prisma generate
```

### Development

```bash
npm run dev
```

> Requires Cloudflare authentication since Workers AI runs remotely.

### Deploy

```bash
npm run deploy
```

## How it works

1. **User sends a message** via WebSocket to the TaskPlannerAgent Durable Object
2. **The agent calls Workers AI** (Llama 3.3 70B) with the conversation history and available tools
3. **The model decides** whether to use a tool (createPlan, addTask, etc.) or respond with text
4. **Tool results** are stored in D1 via Prisma and streamed back as compact UI indicators
5. **Chat messages** are persisted in the DO's SQLite storage and restored on reconnect
6. **Conversations** are tracked in localStorage with auto-generated titles from the first message

## Known issues

- `workers-ai-provider` v3.3.1 has an SSE stream duplication bug where both native and OpenAI-compatible formats are processed, doubling text output and garbling tool call arguments. Fixed via `patch-package` (see `patches/`).

## License

MIT
