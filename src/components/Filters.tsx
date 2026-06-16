"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type { Topic } from "@/lib/types";
import { CATEGORIES, type Category } from "@/lib/categories";

interface Props {
  category: Category;
  topics: Topic[]; // already filtered to the selected category (Total first)
  selectedTopic: string;
  start: string;
  end: string;
}

export default function Filters({ category, topics, selectedTopic, start, end }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const push = useCallback(
    (params: URLSearchParams) => router.push(`${pathname}?${params.toString()}`),
    [router, pathname],
  );

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      push(params);
    },
    [searchParams, push],
  );

  // Changing the category resets the topic so the page falls back to that
  // category's Total.
  const changeCategory = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("category", value);
      params.delete("topic");
      push(params);
    },
    [searchParams, push],
  );

  return (
    <div className="filters">
      <div className="field">
        <label className="field__label" htmlFor="category">
          Category
        </label>
        <select
          id="category"
          className="select select--sm"
          value={category}
          onChange={(e) => changeCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

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
          {topics.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.label ?? t.tag}
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
