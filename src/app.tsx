import { Suspense, useCallback, useState, useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { TaskPlannerAgent } from "./server";

interface AuthState {
  token: string;
  userId: string;
  email: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: number;
}

function decodeJwtPayload(token: string): { userId: string; email: string } | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

function getStoredAuth(): AuthState | null {
  const token = localStorage.getItem("token");
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return { token, ...payload };
}

function loadConversations(userId: string): Conversation[] {
  try {
    const raw = localStorage.getItem(`convs:${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistConversations(userId: string, convs: Conversation[]) {
  localStorage.setItem(`convs:${userId}`, JSON.stringify(convs));
}

function newConversation(): Conversation {
  return { id: crypto.randomUUID(), title: "New chat", createdAt: Date.now() };
}

function toolSummary(name: string, output: unknown): string {
  if (typeof output === "string") {
    return output.length > 60 ? output.slice(0, 57) + "..." : output;
  }
  if (!output || typeof output !== "object") return `${name} done`;
  const o = output as Record<string, unknown>;
  switch (name) {
    case "createPlan":
      return `Plan created: ${o.project || "project"} (${o.created || 0} tasks)`;
    case "addTask":
      return `Created: ${o.title || "task"}`;
    case "listTasks":
      if (Array.isArray(output))
        return `Found ${output.length} task${output.length !== 1 ? "s" : ""}`;
      return "Listed tasks";
    case "updateTask":
      return `Updated: ${o.title || "task"}${o.status ? ` → ${o.status}` : ""}`;
    case "deleteTask":
      return "Deleted task";
    default:
      return `${name} done`;
  }
}

function LoginPage({ onAuth }: { onAuth: (auth: AuthState) => void }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = isRegister ? "/api/register" : "/api/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as any;
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      localStorage.setItem("token", data.token);
      onAuth({ token: data.token, userId: data.userId, email: data.email });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-sm p-8 bg-white rounded-2xl shadow-lg">
        <h1 className="text-2xl font-bold text-center text-gray-900 mb-1">
          Task Planner AI
        </h1>
        <p className="text-sm text-center text-gray-500 mb-6">
          {isRegister ? "Create an account" : "Sign in to your account"}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Min. 8 characters"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "..." : isRegister ? "Create Account" : "Sign In"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError("");
            }}
            className="text-blue-600 hover:underline font-medium"
          >
            {isRegister ? "Sign in" : "Register"}
          </button>
        </p>
      </div>
    </div>
  );
}

function ToolResultView({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);

  if (part.state === "output-available") {
    return (
      <div className="flex justify-start">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-xs text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block shrink-0" />
          {toolSummary(name, part.output)}
        </div>
      </div>
    );
  }

  if (part.state === "input-available" || part.state === "input-streaming") {
    return (
      <div className="flex justify-start">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-xs text-gray-400">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block shrink-0" />
          {name}...
        </div>
      </div>
    );
  }

  return null;
}

function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  email,
  onLogout,
  open,
  onClose,
}: {
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  email: string;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-40 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-3 border-b border-gray-100">
          <button
            onClick={() => {
              onNew();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            + New Chat
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-1">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center mx-2 my-0.5 rounded-lg cursor-pointer transition-colors ${
                c.id === activeId ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
            >
              <button
                onClick={() => {
                  onSelect(c.id);
                  onClose();
                }}
                className={`flex-1 text-left px-3 py-2 text-sm truncate ${
                  c.id === activeId
                    ? "text-blue-700 font-medium"
                    : "text-gray-600"
                }`}
              >
                {c.title}
              </button>
              {conversations.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 px-2 py-1 mr-1 text-gray-400 hover:text-red-500 transition-opacity"
                  aria-label="Delete"
                >
                  &#215;
                </button>
              )}
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400 truncate mr-2">{email}</span>
          <button
            onClick={onLogout}
            className="px-2.5 py-1 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors shrink-0"
          >
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}

function Chat({
  auth,
  conversationId,
  onUpdateTitle,
  onToggleSidebar,
}: {
  auth: AuthState;
  conversationId: string;
  onUpdateTitle: (id: string, title: string) => void;
  onToggleSidebar: () => void;
}) {
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleSet = useRef(false);

  const agent = useAgent<TaskPlannerAgent>({
    agent: "TaskPlannerAgent",
    name: `${auth.userId}_${conversationId}`,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
  });

  const { messages, sendMessage, clearHistory, stop, status } = useAgentChat({
    agent,
    experimental_throttle: 100,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) textareaRef.current.focus();
  }, [isStreaming]);

  useEffect(() => {
    if (titleSet.current) return;
    const first = messages.find((m) => m.role === "user");
    if (!first) return;
    for (const p of first.parts) {
      if (p.type === "text" && p.text) {
        titleSet.current = true;
        const t = p.text;
        onUpdateTitle(conversationId, t.length > 40 ? t.slice(0, 37) + "..." : t);
        break;
      }
    }
  }, [messages, conversationId, onUpdateTitle]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isStreaming, sendMessage]);

  const allPrompts = [
    "Plan a website redesign project",
    "Break down: learn Go programming",
    "Help me organize moving to a new city",
    "Create a workout routine for this week",
    "Plan a product launch strategy",
    "Organize a birthday party",
    "Break down: learn machine learning",
    "Plan a home renovation project",
    "Create a study plan for final exams",
    "Organize a team offsite event",
    "Plan a 2-week road trip",
    "Break down: build a mobile app",
    "Plan a career transition",
    "Organize a weekly meal prep routine",
    "Plan a garden landscaping project",
    "Break down: start a YouTube channel",
  ];
  const [suggestedPrompts] = useState(() => {
    const shuffled = [...allPrompts].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 4);
  });

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="px-5 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onToggleSidebar}
              className="md:hidden p-1 -ml-1 text-gray-500 hover:text-gray-700"
              aria-label="Menu"
            >
              &#9776;
            </button>
            <h1 className="text-lg font-semibold text-gray-900">
              Task Planner AI
            </h1>
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <span
                className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-400"}`}
              />
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <button
            onClick={clearHistory}
            className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Clear
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="text-4xl mb-3">&#128221;</div>
              <h2 className="text-lg font-medium text-gray-700 mb-2">
                What would you like to plan?
              </h2>
              <p className="text-sm text-gray-500 mb-6">
                I'll help you break it down into manageable tasks.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    disabled={isStreaming || !connected}
                    onClick={() =>
                      sendMessage({
                        role: "user",
                        parts: [{ type: "text", text: prompt }],
                      })
                    }
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-white hover:border-gray-400 disabled:opacity-50 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message: UIMessage) => (
            <div key={message.id} className="space-y-1.5">
              {message.parts.map((part, i) => {
                const key = `${message.id}-${i}`;
                if (isToolUIPart(part))
                  return <ToolResultView key={key} part={part} />;
                if (part.type === "text" && part.text) {
                  const isUser = message.role === "user";
                  return (
                    <div
                      key={key}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-2.5 rounded-2xl leading-relaxed whitespace-pre-wrap ${
                          isUser
                            ? "bg-blue-600 text-white rounded-br-md"
                            : "bg-white text-gray-800 border border-gray-200 rounded-bl-md"
                        }`}
                      >
                        {part.text}
                      </div>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          ))}

          {isStreaming && (
            <div className="flex justify-start">
              <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-white border border-gray-200 text-gray-400 text-sm">
                Thinking...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-gray-200 bg-white shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="max-w-3xl mx-auto px-5 py-4"
        >
          <div className="flex items-end gap-3 rounded-xl border border-gray-300 bg-white p-3 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-shadow">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              placeholder="Describe a project or task..."
              disabled={!connected || isStreaming}
              rows={1}
              className="flex-1 text-sm resize-none outline-none max-h-40 bg-transparent text-gray-800 placeholder-gray-400 disabled:opacity-50"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={stop}
                className="p-2 text-gray-500 hover:text-gray-700 transition-colors"
                aria-label="Stop"
              >
                &#9724;
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() || !connected}
                className="p-2 text-blue-600 hover:text-blue-700 disabled:text-gray-300 transition-colors"
                aria-label="Send"
              >
                &#10148;
              </button>
            )}
          </div>
        </form>
        <div className="flex justify-center pb-3">
          <span className="text-xs text-gray-400">
            Powered by Cloudflare Workers AI
          </span>
        </div>
      </div>
    </div>
  );
}

function AppShell({
  auth,
  onLogout,
}: {
  auth: AuthState;
  onLogout: () => void;
}) {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations(auth.userId);
    if (loaded.length > 0) return loaded;
    const first = newConversation();
    persistConversations(auth.userId, [first]);
    return [first];
  });
  const [activeId, setActiveId] = useState(() => conversations[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleNew = useCallback(() => {
    const c = newConversation();
    setConversations((prev) => {
      const next = [c, ...prev];
      persistConversations(auth.userId, next);
      return next;
    });
    setActiveId(c.id);
  }, [auth.userId]);

  const handleDelete = useCallback(
    (id: string) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (next.length === 0) {
          const fallback = newConversation();
          persistConversations(auth.userId, [fallback]);
          setActiveId(fallback.id);
          return [fallback];
        }
        persistConversations(auth.userId, next);
        setActiveId((cur) => (cur === id ? next[0].id : cur));
        return next;
      });
    },
    [auth.userId],
  );

  const handleUpdateTitle = useCallback(
    (id: string, title: string) => {
      setConversations((prev) => {
        const next = prev.map((c) => (c.id === id ? { ...c, title } : c));
        persistConversations(auth.userId, next);
        return next;
      });
    },
    [auth.userId],
  );

  return (
    <div className="flex h-screen">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={handleNew}
        onDelete={handleDelete}
        email={auth.email}
        onLogout={onLogout}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="flex-1 min-w-0">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-screen text-gray-400">
              Loading...
            </div>
          }
        >
          <Chat
            key={activeId}
            auth={auth}
            conversationId={activeId}
            onUpdateTitle={handleUpdateTitle}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
          />
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(getStoredAuth);
  const handleLogout = useCallback(() => {
    localStorage.removeItem("token");
    setAuth(null);
  }, []);

  if (!auth) return <LoginPage onAuth={setAuth} />;
  return <AppShell auth={auth} onLogout={handleLogout} />;
}
