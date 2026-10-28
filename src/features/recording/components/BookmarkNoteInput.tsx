import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { Bookmark } from "../../../types";

// Follows edits from the other recording window unless this one is being typed in.
const BookmarkNoteInput = ({
  bookmark,
  autoFocus,
  onCommit,
  className,
}: {
  bookmark: Bookmark;
  autoFocus: boolean;
  onCommit: (label: string) => void;
  className: string;
}) => {
  const { t } = useLingui();
  const label = bookmark.label ?? "";
  const [draft, setDraft] = useState(label);
  const [seenLabel, setSeenLabel] = useState(label);
  const [editing, setEditing] = useState(false);
  if (label !== seenLabel) {
    setSeenLabel(label);
    if (!editing) setDraft(label);
  }

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        const value = draft.trim();
        if (value !== label) onCommit(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      placeholder={t({ id: "record.bookmark.note", message: "Add a note" })}
      autoFocus={autoFocus}
      className={className}
    />
  );
};

export default BookmarkNoteInput;
