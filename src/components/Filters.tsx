"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type { Topic } from "@/lib/types";

interface Props {
  topics: Topic[];
  selectedTopic: string;
  start: string;
  end: string;
}

export default function Filters({ topics, selectedTopic, start, end }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="filters">
      <div className="field">
        <label className="field__label" htmlFor="topic">
          Topic
        </label>
        <select
          id="topic"
          className="select"
          value={selectedTopic}
          onChange={(e) => update("topic", e.target.value)}
        >
          {topics.length === 0 && <option value="">No topics loaded</option>}
          {topics.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.label ? `${t.label} — ${t.tag}` : t.tag}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="start">
          From
        </label>
        <input
          id="start"
          className="input"
          type="date"
          value={start}
          max={end}
          onChange={(e) => update("start", e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="end">
          To
        </label>
        <input
          id="end"
          className="input"
          type="date"
          value={end}
          min={start}
          onChange={(e) => update("end", e.target.value)}
        />
      </div>
    </div>
  );
}
