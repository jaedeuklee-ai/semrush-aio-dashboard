"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Topic } from "@/lib/types";
import { CATEGORIES, CATEGORY_TOTAL_TAG, categoryOf, type Category } from "@/lib/categories";

interface Props {
  allTopics: Topic[]; // full whitelist; the topic dropdown is scoped client-side
  category: Category; // currently applied values (used to init local state)
  selectedTopic: string;
  start: string;
  end: string;
}

export default function Filters({ allTopics, category, selectedTopic, start, end }: Props) {
  const router = useRouter();

  const [cat, setCat] = useState<Category>(category);
  const [topic, setTopic] = useState<string>(selectedTopic);
  const [from, setFrom] = useState<string>(start);
  const [to, setTo] = useState<string>(end);

  // Topics for the locally-selected category, Total first.
  const categoryTopics = useMemo(() => {
    const total = CATEGORY_TOTAL_TAG[cat];
    return allTopics
      .filter((t) => categoryOf(t.tag) === cat)
      .sort((a, b) => (a.tag === total ? -1 : b.tag === total ? 1 : 0));
  }, [allTopics, cat]);

  function onCategory(value: string) {
    const next = value as Category;
    setCat(next);
    setTopic(CATEGORY_TOTAL_TAG[next]); // reset to that category's Total
  }

  function apply() {
    const params = new URLSearchParams();
    params.set("category", cat);
    params.set("topic", topic);
    params.set("start", from);
    params.set("end", to);
    router.push(`/?${params.toString()}`);
  }

  const dirty =
    cat !== category || topic !== selectedTopic || from !== start || to !== end;

  return (
    <div className="filters">
      <div className="field">
        <label className="field__label" htmlFor="category">
          Category
        </label>
        <select
          id="category"
          className="select select--sm"
          value={cat}
          onChange={(e) => onCategory(e.target.value)}
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
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        >
          {categoryTopics.map((t) => (
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
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
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
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      <div className="field">
        <span className="field__label">&nbsp;</span>
        <button className="btn" onClick={apply} disabled={!dirty}>
          Apply
        </button>
      </div>
    </div>
  );
}
