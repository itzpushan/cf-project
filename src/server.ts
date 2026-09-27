import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { handleRegister, handleLogin, handleMe } from "./auth";

function getPrisma(db: D1Database): PrismaClient {
  const adapter = new PrismaD1(db);
  return new PrismaClient({ adapter } as unknown as ConstructorParameters<
    typeof PrismaClient
  >[0]);
}

const SYSTEM_PROMPT = `You are a task planning assistant. You help users plan ANY project or goal by breaking it into actionable tasks with timelines.

When a user describes a project, goal, or anything they want to plan:
1. Use the createPlan tool to create 3-6 tasks for it
2. Then describe each task with a timeline estimate (e.g., "Day 1-2", "Week 1", "2 hours")
3. Suggest priorities and what to start first

Always use the createPlan tool — never just list tasks as text without saving them.
For follow-up messages like "do it", "yes", "retry" — refer to conversation history and act on what was discussed.
Keep task titles short and actionable, starting with a verb.`;

export class TaskPlannerAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;

  private getPrisma(): PrismaClient {
    return getPrisma(this.env.DB);
  }

  private getUserId(): string {
    return this.name.split("_")[0];
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const prisma = this.getPrisma();
    const userId = this.getUserId();

    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(this.messages),
      tools: {
        createPlan: tool({
          description:
            "Create a project plan with multiple tasks at once. Use this when the user describes a project or goal.",
          inputSchema: z.object({
            projectName: z.string().describe("Name of the project or goal"),
            taskTitles: z
              .array(z.string())
              .describe(
                "List of 3-6 actionable task titles, each starting with a verb"
              )
          }),
          execute: async ({ projectName, taskTitles }) => {
            const parent = await prisma.task.create({
              data: { title: projectName, description: "", userId }
            });
            const tasks = [];
            for (const title of taskTitles) {
              const t = await prisma.task.create({
                data: { title, userId, parentId: parent.id }
              });
              tasks.push(t.title);
            }
            return {
              project: projectName,
              created: tasks.length,
              tasks
            };
          }
        }),

        addTask: tool({
          description:
            "Add a single task. Use for individual tasks, not full project plans.",
          inputSchema: z.object({
            title: z.string().describe("Short, actionable task title"),
            description: z.string().optional().describe("Task details or notes")
          }),
          execute: async ({ title, description }) => {
            const task = await prisma.task.create({
              data: {
                title,
                description: description || "",
                userId
              }
            });
            return { id: task.id, title: task.title, status: task.status };
          }
        }),

        listTasks: tool({
          description: "List all current tasks to check progress or find IDs.",
          inputSchema: z.object({}),
          execute: async () => {
            const tasks = await prisma.task.findMany({
              where: { userId },
              include: { subtasks: true },
              orderBy: { createdAt: "asc" }
            });
            if (tasks.length === 0) return "No tasks yet.";
            return tasks.map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              subtasks: t.subtasks.length
            }));
          }
        }),

        updateTask: tool({
          description:
            "Update a task's status. Call listTasks first to get the task ID.",
          inputSchema: z.object({
            id: z.string().describe("Task ID to update"),
            status: z
              .enum(["todo", "in_progress", "done"])
              .describe("New status")
          }),
          execute: async ({ id, status }) => {
            const data: Record<string, unknown> = { status };
            if (status === "done") data.completedAt = new Date();
            else data.completedAt = null;
            const task = await prisma.task.update({
              where: { id, userId },
              data
            });
            return { title: task.title, status: task.status };
          }
        }),

        deleteTask: tool({
          description: "Delete a task and its subtasks.",
          inputSchema: z.object({
            id: z.string().describe("Task ID to delete")
          }),
          execute: async ({ id }) => {
            await prisma.task.deleteMany({
              where: { parentId: id, userId }
            });
            await prisma.task.delete({ where: { id, userId } });
            return { deleted: true };
          }
        })
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/register" && request.method === "POST") {
      return handleRegister(request, env);
    }
    if (url.pathname === "/api/login" && request.method === "POST") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/api/me" && request.method === "GET") {
      return handleMe(request, env);
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
