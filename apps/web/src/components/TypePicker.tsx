import { useState, type CSSProperties } from "react";
import type { TaskType } from "../types";

/**
 * Task type as buttons: Feature, Bug… and one "Routine" button that opens a second row with the routine
 * types (Daily, Weekly). Clicking the selected button again clears the type.
 */
export function TypePicker({ types, value, onChange }: { types: TaskType[]; value: string | null; onChange: (typeId: string | null) => void }) {
  const routines = types.filter((type) => type.isRoutine);
  const others = types.filter((type) => !type.isRoutine);
  const selectedRoutine = routines.find((type) => type.id === value);
  const [routineOpen, setRoutineOpen] = useState(selectedRoutine !== undefined);
  const showRoutines = routineOpen || selectedRoutine !== undefined;
  const routineColor = selectedRoutine?.color ?? routines[0]?.color ?? "#0f766e";

  const pick = (id: string) => {
    onChange(value === id ? null : id);
    if (!routines.some((type) => type.id === id)) setRoutineOpen(false);
  };

  return (
    <div className="type-picker">
      <div className="segmented" role="radiogroup" aria-label="Type">
        {others.map((type) => (
          <button
            key={type.id}
            type="button"
            role="radio"
            aria-checked={value === type.id}
            className={value === type.id ? "selected" : ""}
            style={{ "--pill": type.color } as CSSProperties}
            onClick={() => pick(type.id)}
          >
            <span className="seg-dot" aria-hidden="true" />
            {type.name}
          </button>
        ))}
        {routines.length > 0 && (
          <button
            type="button"
            role="radio"
            aria-checked={selectedRoutine !== undefined}
            aria-expanded={showRoutines}
            className={`${selectedRoutine ? "selected" : ""} ${showRoutines && !selectedRoutine ? "open" : ""}`}
            style={{ "--pill": routineColor } as CSSProperties}
            onClick={() => {
              if (selectedRoutine) {
                // Leaving routine: clear the type and fold the choices away.
                onChange(null);
                setRoutineOpen(false);
              } else {
                setRoutineOpen((open) => !open);
              }
            }}
            title="Work that repeats: daily or weekly"
          >
            <span className="seg-dot" aria-hidden="true" />
            Routine
            <svg className={`routine-caret ${showRoutines ? "up" : ""}`} viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
          </button>
        )}
      </div>
      {showRoutines && (
        <div className="routine-choices">
          <span>How often?</span>
          <div className="segmented" role="radiogroup" aria-label="Routine">
            {routines.map((type) => (
              <button
                key={type.id}
                type="button"
                role="radio"
                aria-checked={value === type.id}
                className={value === type.id ? "selected" : ""}
                style={{ "--pill": type.color } as CSSProperties}
                onClick={() => pick(type.id)}
              >
                <span className="seg-dot" aria-hidden="true" />
                {type.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
