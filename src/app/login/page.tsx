"use client";

import { useState } from "react";

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!pw || loading) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        const params = new URLSearchParams(window.location.search);
        window.location.href = params.get("next") || "/";
        return;
      }
      const d = await res.json().catch(() => ({}));
      setErr(d.error === "wrong password" ? "비밀번호가 올바르지 않아요." : "로그인에 실패했어요.");
    } catch {
      setErr("로그인에 실패했어요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app">
      <div className="login">
        <div className="card login__card">
          <h1 className="title">AI Visibility</h1>
          <p className="subtitle">접근하려면 비밀번호를 입력하세요.</p>
          <input
            className="input login__input"
            type="password"
            value={pw}
            placeholder="비밀번호"
            autoFocus
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          {err && <p className="login__err">{err}</p>}
          <button className="btn login__btn" onClick={submit} disabled={loading || !pw}>
            {loading ? "확인 중…" : "들어가기"}
          </button>
        </div>
      </div>
    </main>
  );
}
