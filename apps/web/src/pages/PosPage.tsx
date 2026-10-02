import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { errorMessage, formatDateTime } from "../format";
import type { ManagedClient } from "../types";

export function PosPage({ onChanged }: { onChanged: () => void }) {
  const [pos, setPos] = useState<ManagedClient[] | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listClients().then(setPos).catch((cause: unknown) => setError(errorMessage(cause)));
  }, []);

  const replace = (updated: ManagedClient) =>
    setPos((current) => current?.map((po) => (po.id === updated.id ? updated : po)) ?? null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    try {
      const created = await api.createClient(newName.trim());
      setPos((current) => [...(current ?? []), created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const update = async (po: ManagedClient, change: { name?: string; color?: string; isActive?: boolean }) => {
    setError(null);
    try {
      replace(await api.updateClient(po.id, change));
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <div className="admin-page">
      <div className="sheet-heading">
        <div>
          <h1>Partner Organisations</h1>
          <p className="subtitle">Every task is logged against a Partner Organisation (PO). Archived POs keep their tasks but can't be picked for new ones.</p>
        </div>
      </div>

      <form className="inline-form" onSubmit={create}>
        <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Partner Organisation name" aria-label="New Partner Organisation name" maxLength={120} />
        <button type="submit" className="small-primary" disabled={!newName.trim()}>Add PO</button>
      </form>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="panel-card table-card">
        <table className="plain-table">
          <thead>
            <tr><th>Colour</th><th>Name</th><th>Tasks</th><th>Added</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {pos === null && <tr><td colSpan={6} className="table-message">Loading…</td></tr>}
            {pos?.length === 0 && <tr><td colSpan={6} className="table-message">No Partner Organisations yet. Add the first one above.</td></tr>}
            {pos?.map((po) => (
              <tr key={po.id} className={po.isActive ? "" : "archived"}>
                <td className="color-cell">
                  <ColorInput value={po.color} label={`Colour for ${po.name}`} onChange={(color) => update(po, { color })} />
                </td>
                <td>
                  <input
                    className="cell-input"
                    defaultValue={po.name}
                    key={po.name}
                    aria-label={`Rename ${po.name}`}
                    onBlur={(event) => {
                      const name = event.target.value.trim();
                      if (!name) event.target.value = po.name;
                      else if (name !== po.name) update(po, { name });
                    }}
                    onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                  />
                </td>
                <td>{po._count.tasks}</td>
                <td className="muted-cell">{formatDateTime(po.createdAt)}</td>
                <td><span className={`state-chip ${po.isActive ? "on" : "off"}`}>{po.isActive ? "Active" : "Archived"}</span></td>
                <td className="actions-cell">
                  <button type="button" className="text-button" onClick={() => update(po, { isActive: !po.isActive })}>
                    {po.isActive ? "Archive" : "Restore"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The native picker reports every drag step; save once the choice settles.
function ColorInput({ value, label, onChange }: { value: string; label: string; onChange: (color: string) => void }) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <input
      type="color"
      value={draft}
      aria-label={label}
      onChange={(event) => {
        const color = event.target.value;
        setDraft(color);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => color !== value && onChange(color), 500);
      }}
    />
  );
}
