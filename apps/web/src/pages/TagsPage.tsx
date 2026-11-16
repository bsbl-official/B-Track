import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { errorMessage } from "../format";
import type { ManagedTag, TagSettings } from "../types";
import { ColorInput } from "./PosPage";

// Common names for what a tag asks for, offered while typing.
const DETAIL_LABELS = ["Tables", "Form files", "Screens", "Report names", "Packages", "APIs"];

const endingsText = (extensions: string[]) => extensions.join(", ");
const parseEndings = (text: string) =>
  [...new Set(text.split(/[\s,;]+/).map((item) => item.replace(/^\.+/, "").toLowerCase()).filter(Boolean))];

export function TagsPage({ onChanged }: { onChanged: () => void }) {
  const [tags, setTags] = useState<ManagedTag[] | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Bumped after a failed save, so the boxes show the saved values again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api.listTags().then(setTags).catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);

  const replace = (updated: ManagedTag) =>
    setTags((current) => current?.map((tag) => (tag.id === updated.id ? updated : tag)) ?? null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    try {
      const created = await api.createTag({ name: newName.trim() });
      setTags((current) => [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const update = async (tag: ManagedTag, change: TagSettings) => {
    setError(null);
    try {
      replace(await api.updateTag(tag.id, change));
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
      // Put the saved values back in the boxes.
      setVersion((current) => current + 1);
    }
  };

  // Text boxes save when you leave them (or press Enter).
  const textCell = (tag: ManagedTag, key: "name" | "detailLabel" | "detailHint", props: { label: string; placeholder?: string; list?: string; disabled?: boolean; maxLength: number }) => {
    const saved = tag[key] ?? "";
    return (
      <input
        className="cell-input"
        defaultValue={saved}
        key={`${tag.id}-${key}-${saved}-${version}`}
        aria-label={`${props.label} for ${tag.name}`}
        placeholder={props.placeholder}
        list={props.list}
        disabled={props.disabled}
        maxLength={props.maxLength}
        onBlur={(event) => {
          const value = event.target.value.replace(/\s+/g, " ").trim();
          if (key === "name" && !value) event.target.value = saved;
          else if (value !== saved) update(tag, { [key]: value || null });
        }}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      />
    );
  };

  return (
    <div className="admin-page">
      <div className="sheet-heading">
        <div>
          <h1>Tags</h1>
          <p className="subtitle">
            Tags help find related tasks later. A tag can ask for details: for example <b>Database/DB</b> asks for the tables an
            issue touches, and every task with it must list at least one. Anyone editing a task can also add a new plain tag by
            typing it; it appears here. Archived tags stay on their tasks but can't be added to more.
          </p>
        </div>
      </div>

      <form className="inline-form" onSubmit={create}>
        <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Tag name, e.g. Report" aria-label="New tag name" maxLength={60} />
        <button type="submit" className="small-primary" disabled={!newName.trim()}>Add tag</button>
      </form>

      {error && <p className="form-error" role="alert">{error}</p>}

      <datalist id="tag-detail-labels">
        {DETAIL_LABELS.map((label) => <option key={label} value={label} />)}
      </datalist>

      <div className="panel-card table-card">
        <table className="plain-table tags-table">
          <thead>
            <tr>
              <th>Colour</th>
              <th>Name</th>
              <th title="What a task with this tag must list. Leave empty for a plain tag.">Asks for</th>
              <th>Example</th>
              <th title="Each entry must end in one of these, e.g. fmb, fmx, rdf. Leave empty to allow any text.">Allowed file endings</th>
              <th title="Save entries in capitals (e.g. database table names)">Capitals</th>
              <th>Tasks</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tags === null && <tr><td colSpan={9} className="table-message">Loading…</td></tr>}
            {tags?.length === 0 && <tr><td colSpan={9} className="table-message">No tags yet. Add the first one above.</td></tr>}
            {tags?.map((tag) => {
              const plain = !tag.detailLabel;
              return (
                <tr key={tag.id} className={tag.isActive ? "" : "archived"}>
                  <td className="color-cell">
                    <ColorInput value={tag.color} label={`Colour for ${tag.name}`} onChange={(color) => update(tag, { color })} />
                  </td>
                  <td>{textCell(tag, "name", { label: "Rename", maxLength: 60 })}</td>
                  <td>{textCell(tag, "detailLabel", { label: "What it asks for", placeholder: "Nothing (plain tag)", list: "tag-detail-labels", maxLength: 40 })}</td>
                  <td>{textCell(tag, "detailHint", { label: "Example", placeholder: plain ? "—" : "e.g. CR_INFO", disabled: plain, maxLength: 120 })}</td>
                  <td>
                    <input
                      className="cell-input"
                      defaultValue={endingsText(tag.detailExtensions)}
                      key={`${tag.id}-ext-${endingsText(tag.detailExtensions)}-${version}`}
                      aria-label={`Allowed file endings for ${tag.name}`}
                      placeholder={plain ? "—" : "Any"}
                      disabled={plain}
                      onBlur={(event) => {
                        const endings = parseEndings(event.target.value);
                        if (endingsText(endings) !== endingsText(tag.detailExtensions)) update(tag, { detailExtensions: endings });
                        else event.target.value = endingsText(tag.detailExtensions);
                      }}
                      onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                    />
                  </td>
                  <td className="center-cell">
                    <input
                      type="checkbox"
                      checked={tag.detailUppercase}
                      disabled={plain}
                      aria-label={`Save ${tag.name} entries in capitals`}
                      onChange={(event) => update(tag, { detailUppercase: event.target.checked })}
                    />
                  </td>
                  <td>
                    {tag._count.tasks > 0 ? (
                      <a href={`#/tasks?view=all&tag=${tag.id}`} title={`Show the tasks tagged ${tag.name}`}>{tag._count.tasks}</a>
                    ) : (
                      0
                    )}
                  </td>
                  <td><span className={`state-chip ${tag.isActive ? "on" : "off"}`}>{tag.isActive ? "Active" : "Archived"}</span></td>
                  <td className="actions-cell">
                    <button type="button" className="text-button" onClick={() => update(tag, { isActive: !tag.isActive })}>
                      {tag.isActive ? "Archive" : "Restore"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
