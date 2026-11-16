import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { api } from "../api";
import type { Tag, TagInput, TaskTag } from "../types";

// Tags on a task: picking them (with suggestions, so names stay consistent), the details some tags ask
// for (tables, form files, screens…), and showing them in the task drawer.

const NEUTRAL = "#5f6673";
const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const listText = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}` : items[0] ?? "");

type KnownTag = Omit<Tag, "id"> & { id: string };

/** A detail as it will be saved (tidied, in capitals where the tag says so), and what's wrong with it. */
function prepareDetail(tag: KnownTag, raw: string): { value: string; problem: string | null } {
  let value = clean(raw);
  if (tag.detailUppercase) value = value.toUpperCase();
  if (tag.detailExtensions.length > 0) {
    const ending = value.includes(".") ? value.split(".").pop()!.toLowerCase() : "";
    if (!tag.detailExtensions.includes(ending)) {
      return { value, problem: `“${value}” must end in ${listText(tag.detailExtensions.map((extension) => `.${extension}`))}` };
    }
  }
  return { value, problem: null };
}

/** The first tag still missing its details, as a message; null when every tag is complete. */
export function tagsProblem(value: TagInput[], known: Array<{ name: string; detailLabel: string | null }>): string | null {
  for (const item of value) {
    const tag = known.find((candidate) => same(candidate.name, item.name));
    if (tag?.detailLabel && item.details.length === 0) return `List the ${tag.detailLabel.toLowerCase()} for the “${tag.name}” tag.`;
  }
  return null;
}

/** A task's tags as the API takes them. */
export const tagInputsOf = (tags: TaskTag[]): TagInput[] => tags.map((tag) => ({ name: tag.name, details: tag.details }));

// Details already used with each tag (on tasks this person can see), to suggest while typing.
function useDetailSuggestions() {
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let live = true;
    api.tagDetails().then((data) => live && setSuggestions(data)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return suggestions;
}

export function TagChip({ name, color }: { name: string; color?: string }) {
  return <span className="tag-chip" style={{ "--pill": color ?? NEUTRAL } as CSSProperties}>{name}</span>;
}

/** Tags with their details, read-only (task drawer). */
export function TagList({ tags }: { tags: TaskTag[] }) {
  return (
    <ul className="tag-list">
      {tags.map((tag) => (
        <li key={tag.id}>
          <TagChip name={tag.name} color={tag.color} />
          {tag.details.length > 0 && (
            <span className="tag-list-details" aria-label={tag.detailLabel ?? "Details"}>
              {tag.details.map((detail) => <span key={detail} className="detail-chip">{detail}</span>)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Pick a task's tags. Typing shows matching tags to click (Enter takes the best match); a name that isn't a
 * tag yet can be added as a new plain tag. Tags that ask for details get a box for them underneath.
 */
export function TagEditor({
  tags,
  value,
  onChange,
  current = [],
}: {
  // Active tags (meta.tags).
  tags: Tag[];
  value: TagInput[];
  onChange: (tags: TagInput[]) => void;
  // The task's saved tags, so archived ones still on it keep their name and colour.
  current?: TaskTag[];
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const suggestions = useDetailSuggestions();

  const known: KnownTag[] = [
    ...tags,
    ...current
      .filter((saved) => !tags.some((tag) => tag.id === saved.id))
      .map((saved) => ({ ...saved, detailHint: null, detailExtensions: [], detailUppercase: false })),
  ];
  const find = (name: string) => known.find((tag) => same(tag.name, name));

  const add = (name: string) => {
    const typed = clean(name);
    if (!typed) return;
    const finalName = find(typed)?.name ?? typed;
    if (!value.some((item) => same(item.name, finalName))) {
      onChange([...value, { name: finalName, details: [] }]);
      setJustAdded(finalName);
    }
    setQuery("");
  };
  const remove = (name: string) => onChange(value.filter((item) => !same(item.name, name)));
  const setDetails = (name: string, details: string[]) => onChange(value.map((item) => (same(item.name, name) ? { ...item, details } : item)));

  const search = clean(query).toLowerCase();
  const available = tags.filter((tag) => !value.some((item) => same(item.name, tag.name)));
  const matches = search ? available.filter((tag) => tag.name.toLowerCase().includes(search)) : available;
  const exact = search ? known.find((tag) => tag.name.toLowerCase() === search) : undefined;
  const canCreate = search !== "" && !exact && !value.some((item) => item.name.toLowerCase() === search);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query) {
      event.stopPropagation();
      setQuery("");
    }
    if (event.key !== "Enter") return;
    // Never submit the form from here.
    event.preventDefault();
    if (!search) return;
    if (exact) add(exact.name);
    else if (matches[0]) add(matches[0].name);
    else add(query);
  };

  return (
    <div className="tag-editor">
      {value.length > 0 && (
        <ul className="tag-rows">
          {value.map((item) => {
            const tag = find(item.name);
            return (
              <li key={item.name} className="tag-row">
                <div className="tag-row-head">
                  <TagChip name={item.name} color={tag?.color} />
                  {!tag && <span className="tag-new">new tag</span>}
                  {tag?.detailLabel && <span className="tag-row-label">{tag.detailLabel} <b className="req">*</b></span>}
                  <button type="button" className="tag-remove" onClick={() => remove(item.name)} aria-label={`Remove the ${item.name} tag`} title="Remove tag">×</button>
                </div>
                {tag?.detailLabel && (
                  <DetailInput
                    tag={tag}
                    value={item.details}
                    onChange={(details) => setDetails(item.name, details)}
                    suggestions={suggestions[tag.id] ?? []}
                    autoFocus={justAdded === item.name}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="tag-add">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0z" /><circle cx="8" cy="8" r="1.3" /></svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={value.length ? "Add another tag…" : "Add a tag: start typing, e.g. Database"}
          aria-label="Add a tag"
          maxLength={60}
        />
      </div>
      {focused && (matches.length > 0 || canCreate) && (
        <div className="tag-suggestions" aria-label="Matching tags">
          {matches.slice(0, 15).map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="tag-suggestion"
              style={{ "--pill": tag.color } as CSSProperties}
              // Keep focus in the box, so the list stays open for the next tag.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(tag.name)}
            >
              <span className="seg-dot" aria-hidden="true" />
              {tag.name}
              {tag.detailLabel && <em>+ {tag.detailLabel.toLowerCase()}</em>}
            </button>
          ))}
          {canCreate && (
            <button type="button" className="tag-suggestion create" onMouseDown={(event) => event.preventDefault()} onClick={() => add(query)}>
              ＋ New tag “{clean(query)}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The details for one tag, as removable chips. Enter or a comma adds what's typed; pasting a list adds each. */
function DetailInput({
  tag,
  value,
  onChange,
  suggestions,
  autoFocus,
}: {
  tag: KnownTag;
  value: string[];
  onChange: (details: string[]) => void;
  suggestions: string[];
  autoFocus: boolean;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const parts = raw.split(/[,\n\r\t]+/).map(clean).filter(Boolean);
    const next = [...value];
    const rejected: string[] = [];
    let firstProblem: string | null = null;
    for (const part of parts) {
      const prepared = prepareDetail(tag, part);
      if (prepared.problem) {
        rejected.push(part);
        firstProblem ??= prepared.problem;
      } else if (!next.some((detail) => same(detail, prepared.value))) {
        next.push(prepared.value);
      }
    }
    if (next.length !== value.length) onChange(next);
    setProblem(firstProblem);
    // Anything refused stays in the box to fix.
    setText(rejected.join(", "));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(text);
    } else if (event.key === "Backspace" && !text && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const search = clean(text).toLowerCase();
  const shown = search
    ? suggestions.filter((item) => item.toLowerCase().includes(search) && !value.some((detail) => same(detail, item))).slice(0, 10)
    : [];
  const rules = [
    tag.detailExtensions.length > 0 && `ends in ${listText(tag.detailExtensions.map((extension) => `.${extension}`))}`,
    tag.detailUppercase && "saved in capitals",
  ].filter(Boolean);

  return (
    <div className="detail-field">
      <div className={`detail-input ${problem ? "invalid" : ""}`} onClick={() => input.current?.focus()}>
        {value.map((detail) => (
          <span key={detail} className="detail-chip">
            {detail}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onChange(value.filter((item) => item !== detail));
              }}
              aria-label={`Remove ${detail}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={input}
          autoFocus={autoFocus}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (!/[,\n\r\t]/.test(pasted)) return;
            event.preventDefault();
            commit(`${text}${pasted}`);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            // Typed but not yet added: add it, so nothing is lost when saving straight away.
            if (clean(text)) commit(text);
          }}
          placeholder={value.length ? "" : tag.detailHint ? `e.g. ${tag.detailHint}` : `Add ${tag.detailLabel?.toLowerCase()}`}
          aria-label={`${tag.detailLabel} for ${tag.name}`}
          maxLength={200}
        />
      </div>
      {focused && shown.length > 0 && (
        <div className="tag-suggestions detail" aria-label={`Used before with ${tag.name}`}>
          {shown.map((item) => (
            <button key={item} type="button" className="detail-suggestion" onMouseDown={(event) => event.preventDefault()} onClick={() => commit(item)}>
              {item}
            </button>
          ))}
        </div>
      )}
      {problem ? (
        <p className="detail-problem" role="alert">{problem}</p>
      ) : (
        <small className="detail-help">Press Enter after each one{rules.length ? ` · ${rules.join(" · ")}` : ""}</small>
      )}
    </div>
  );
}
