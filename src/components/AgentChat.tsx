"use client";

import { useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "TV에서 LG가 가장 뒤처진 토픽 알려줘",
  "oled tv에서 LG가 빠진 prompt 중 볼륨 큰 거는?",
  "Monitor에서 우리 보유 콘텐츠가 인용되고 있어?",
];

const MODELS = [
  { id: "claude", label: "Claude Sonnet" },
  { id: "gemini", label: "Gemini" },
];

export default function AgentChat({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("claude");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setError(null);
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "request failed");
      setMessages([...next, { role: "assistant", content: data.reply ?? "(빈 응답)" }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages(next);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
    }
  }

  return (
    <section className={`card chat${compact ? " chat--compact" : ""}`}>
      <div className="chat__bar">
        <span className="chat__name">Ask AI</span>
        <select
          className="select select--sm"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          aria-label="Model"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="chat__log" ref={logRef}>
        {messages.length === 0 && (
          <div className="chat__empty">
            <p>무엇이든 물어보세요. 예를 들면:</p>
            <div className="chat__chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg--${m.role}`}>
            {m.content}
          </div>
        ))}
        {loading && <div className="msg msg--assistant msg--loading">분석 중…</div>}
        {error && <div className="banner banner--inline">오류: {error}</div>}
      </div>

      <div className="chat__form">
        <textarea
          className="chat__input"
          rows={2}
          value={input}
          placeholder="질문을 입력하세요…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <button className="btn" onClick={() => send(input)} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </section>
  );
}
