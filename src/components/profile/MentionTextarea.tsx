import { useEffect, useRef, useState } from "react";
import { Avatar } from "../chat/Avatar";
import { searchUsers, type UserSearchResult } from "../../services/profile/profile";
import type { MentionRef } from "../../services/profile/save";

/**
 * Multi-line bio editor with @mention autocomplete. The parent owns the text
 * value; onAddRef fires when a suggestion is picked. Stale refs (tokens later
 * deleted from the text) are dropped automatically at save time.
 */
export function MentionTextarea({
  value,
  onChange,
  onAddRef,
  maxLength = 500,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onAddRef: (ref: MentionRef) => void;
  maxLength?: number;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<UserSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!query) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const handle = setTimeout(async () => {
      const results = await searchUsers(query);
      setSuggestions(results);
      setActiveIndex(0);
      setOpen(results.length > 0);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  function handleChange(next: string) {
    onChange(next);
    const caret = inputRef.current?.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    const match = before.match(/@([a-zA-Z0-9_]*)$/);
    setQuery(match ? match[1] : "");
  }

  function insertSuggestion(person: UserSearchResult) {
    const textarea = inputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const match = before.match(/@([a-zA-Z0-9_]*)$/);
    const tokenStart = match ? match.index! : start;
    const next = before.slice(0, tokenStart) + `@${person.username} ` + after;
    onChange(next);
    onAddRef({ username: person.username, id: person.id });
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = tokenStart + person.username.length + 2;
      textarea.setSelectionRange(caret, caret);
    });
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertSuggestion(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="mention-editor">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={maxLength}
        disabled={disabled}
        rows={3}
      />
      {open && suggestions.length > 0 && (
        <ul className="mention-autocomplete" role="listbox" aria-label="Mention someone">
          {suggestions.map((person, i) => (
            <li key={person.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                className={i === activeIndex ? "active" : ""}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertSuggestion(person);
                }}
              >
                <Avatar name={person.username} url={person.avatar_url} />
                <span>
                  <b>{person.display_name || person.username}</b>{" "}
                  <small>@{person.username}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}