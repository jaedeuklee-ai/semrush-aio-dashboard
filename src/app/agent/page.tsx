import Link from "next/link";
import AgentChat from "@/components/AgentChat";

export default function AgentPage() {
  return (
    <main className="app">
      <div className="topbar">
        <div>
          <h1 className="title">Ask AI</h1>
          <p className="subtitle">AI 검색 노출 분석 · DB를 조회해 답합니다</p>
        </div>
        <Link className="navlink" href="/">
          ← Dashboard
        </Link>
      </div>
      <AgentChat />
    </main>
  );
}
