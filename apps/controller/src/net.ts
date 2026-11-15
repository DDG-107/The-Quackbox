import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type ClientMessage,
  type GameResult,
  type JoinMessage,
  type RoomMessage,
  type UIMessage,
  type WelcomeMessage,
} from "@quackbox/protocol";

const TOKEN_KEY = "quackbox:token";
/** Hub pings every 5s; this much silence means the socket is dead. */
const SILENCE_LIMIT_MS = 20_000;
const BACKOFF_MS = [500, 1000, 2000, 4000, 5000] as const;

export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface ConnectionHandlers {
  onState?(state: ConnectionState): void;
  onWelcome?(message: WelcomeMessage): void;
  onUI?(message: UIMessage): void;
  onRoom?(message: RoomMessage): void;
  onEvent?(event: string, data: unknown): void;
  onEnded?(results: GameResult[]): void;
  onKicked?(reason: string): void;
  onError?(code: string, message: string): void;
}

interface StartOptions {
  room?: string;
  name: string;
}

function socketUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

/**
 * The phone side of the protocol: join, auto-reconnect with backoff, re-send
 * the token so the player lands in the same slot with the same screen.
 */
export class Connection {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private silenceTimer: number | null = null;
  private stopped = true;
  private token: string | null = null;
  private room: string | undefined;
  private name = "";

  constructor(private readonly handlers: ConnectionHandlers) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.reconnectNow();
    });
    window.addEventListener("online", () => this.reconnectNow());
  }

  start(options: StartOptions): void {
    this.room = options.room;
    this.name = options.name;
    this.token = localStorage.getItem(TOKEN_KEY);
    this.stopped = false;
    this.attempt = 0;

    // The socket may already be open (retrying after a rejected name).
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendJoin();
      return;
    }
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.handlers.onState?.("closed");
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  forgetToken(): void {
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  private open(): void {
    const state = this.socket?.readyState;
    if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) return;

    this.clearTimers();
    this.handlers.onState?.(this.attempt === 0 ? "connecting" : "reconnecting");

    const socket = new WebSocket(socketUrl());
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.handlers.onState?.("open");
      this.sendJoin();
      this.armSilenceTimer();
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      this.receive(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      if (!this.stopped) this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // 'close' always follows; reconnection is scheduled there.
    });
  }

  private sendJoin(): void {
    const join: JoinMessage = { t: "join", protocol: PROTOCOL_VERSION };
    if (this.room) join.room = this.room;
    if (this.name) join.name = this.name;
    if (this.token) join.token = this.token;
    this.socket?.send(JSON.stringify(join));
  }

  private receive(raw: unknown): void {
    this.armSilenceTimer();
    if (typeof raw !== "string") return;

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }

    const parsed = serverMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const message = parsed.data;

    switch (message.t) {
      case "welcome":
        this.token = message.token;
        localStorage.setItem(TOKEN_KEY, message.token);
        this.handlers.onWelcome?.(message);
        break;
      case "ui":
        this.handlers.onUI?.(message);
        break;
      case "room":
        this.handlers.onRoom?.(message);
        break;
      case "event":
        this.handlers.onEvent?.(message.event, message.data);
        break;
      case "ended":
        this.handlers.onEnded?.(message.results);
        break;
      case "kicked":
        this.forgetToken();
        this.stopped = true;
        this.handlers.onKicked?.(message.reason);
        break;
      case "error":
        this.handlers.onError?.(message.code, message.message);
        break;
    }
  }

  private reconnectNow(): void {
    if (this.stopped) return;
    if (this.socket?.readyState === WebSocket.CONNECTING || this.socket?.readyState === WebSocket.OPEN) {
      return;
    }
    this.attempt = 0;
    this.open();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 5000;
    this.attempt += 1;
    this.handlers.onState?.("reconnecting");
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer !== null) window.clearTimeout(this.silenceTimer);
    this.silenceTimer = window.setTimeout(() => {
      const socket = this.socket;
      this.socket = null;
      socket?.close();
      if (!this.stopped) this.scheduleReconnect();
    }, SILENCE_LIMIT_MS);
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.silenceTimer !== null) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
}
