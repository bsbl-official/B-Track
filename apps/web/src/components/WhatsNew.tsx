import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { todayIso } from "../format";
import type { Profile } from "../types";
import { Avatar } from "./Avatar";
import { TagChip } from "./Tags";

/**
 * "What's new" release notes. They pop up once per person (the server remembers that they closed this
 * release), from showFrom on, and can be opened again from the notification panel. For the next release,
 * change id, showFrom and date, and replace SECTIONS.
 *
 * Each section has written steps and a short looping demo of the same steps: a pointer moves, clicks and
 * types through a mock of the screen (made-up tasks, so no real names). The demo plays while it's in view,
 * and the written step it's showing is highlighted; clicking a step jumps there.
 */
export const RELEASE = { id: "2026-11", showFrom: "2026-11-16", date: "November 2026" };

export const shouldShowReleaseNotes = (profile: Profile) => profile.seenReleaseNotes !== RELEASE.id && todayIso() >= RELEASE.showFrom;

// ms: how long the step plays. target: the element (data-demo="…") the pointer moves to; click: it clicks
// there near the end of the step, and the next step shows the result.
type Step = { text: ReactNode; ms: number; target?: string; click?: boolean };
// elapsed: ms into the current step (Infinity when paused, so each step shows its finished state).
type DemoProps = { step: number; elapsed: number };
type Section = { id: string; title: string; summary: string; steps: Step[]; notes: ReactNode[]; Demo: (props: DemoProps) => ReactNode };

const pill = (color: string) => ({ "--pill": color }) as CSSProperties;
// Text typed out one character at a time from `from` ms.
const typed = (text: string, elapsed: number, from = 300, perChar = 85) =>
  text.slice(0, Math.max(0, Math.floor((elapsed - from) / perChar)));
const typedDone = (text: string, elapsed: number, from = 300, perChar = 85) => elapsed >= from + text.length * perChar;

function StatusPill({ name, color, lock }: { name: string; color: string; lock?: boolean }) {
  return (
    <span key={name} className="drawer-pill status demo-pop" style={pill(color)}>
      <span className="pill-dot" />
      {name}
      {lock && (
        <svg className="demo-lock" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
      )}
    </span>
  );
}

// ---- 1. Testing sign-off ----

function TestingDemo({ step }: DemoProps) {
  const hasTesters = step >= 1;
  const oneDone = step >= 3;
  const twoDone = step >= 5;
  const status =
    step >= 6 ? <StatusPill name="Completed" color="#16a34a" />
    : step >= 1 ? <StatusPill name={`Testing ${Number(oneDone) + Number(twoDone)}/2`} color="#d97706" lock={!twoDone} />
    : <StatusPill name="In Progress" color="#2563eb" />;
  const verdict = (done: boolean) =>
    done ? <span className="testing-verdict passed demo-pop">Passed</span> : <span className="testing-verdict waiting">Testing…</span>;
  return (
    <div className="demo-card demo-wide">
      <div className="demo-card-head">
        <span className="wn-task">#312 · Loan report fix</span>
        {status}
      </div>
      <div className="demo-field">
        <span>Tested by</span>
        <span className="demo-select" data-demo="testedby">
          {hasTesters ? (
            <>
              <span className="po-chip demo-pop" style={pill("#5f6673")}>Tester one</span>
              <span className="po-chip demo-pop" style={pill("#5f6673")}>Tester two</span>
            </>
          ) : (
            <span className="demo-placeholder">Not yet</span>
          )}
        </span>
      </div>
      {hasTesters && (
        <ul className="wn-testers demo-pop">
          <li>
            <span className="wn-person"><Avatar name="Tester One" size={22} />Tester one</span>
            {oneDone ? verdict(true) : <span className="wn-button primary small" data-demo="pass1">✓ Pass testing</span>}
          </li>
          <li>
            <span className="wn-person"><Avatar name="Tester Two" size={22} />Tester two</span>
            {twoDone ? verdict(true) : step >= 3 ? <span className="wn-button primary small" data-demo="pass2">✓ Pass testing</span> : verdict(false)}
          </li>
        </ul>
      )}
      {step === 3 && <p className="demo-note demo-pop">Waiting for Tester two. The status can't be changed until everyone answers.</p>}
      {step === 5 && <span className="wn-button primary demo-pop demo-cta" data-demo="complete">Mark as Completed</span>}
      {step >= 6 && <p className="demo-note good demo-pop">✓ Everyone passed. Task completed.</p>}
    </div>
  );
}

// ---- 2. Alerts ----

function AlertsDemo({ step }: DemoProps) {
  return (
    <div className="demo-screen">
      <span className="demo-rest" data-demo="rest" />
      {step <= 1 && (
        <div className={`demo-prompt ${step === 1 ? "dim" : ""}`}>
          <span className="demo-prompt-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></svg>
          </span>
          <div>
            <strong>Turn on notifications?</strong>
            <span>Get an alert with a sound when something needs you.</span>
            <div className="demo-row">
              <span className="wn-button primary small" data-demo="turnon">Turn on</span>
              <span className="demo-link">Not now</span>
            </div>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="demo-permission demo-pop">
          <span>B-Track wants to</span>
          <b>🔔 Show notifications</b>
          <div className="demo-row">
            <span className="demo-browser-button primary" data-demo="allow">Allow</span>
            <span className="demo-browser-button">Block</span>
          </div>
        </div>
      )}
      {(step === 2 || step === 3) && (
        <div className="wn-toast demo-toast" data-demo="toast">
          <img src="/logo.svg" alt="" width={28} height={28} />
          <div>
            <b>B-Track</b>
            <span>A teammate assigned you #312 “Loan report fix”</span>
          </div>
          <svg className="wn-sound" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>
        </div>
      )}
      {step === 4 && (
        <div className="demo-drawer">
          <span className="demo-muted">Issue #312</span>
          <strong>Loan report fix</strong>
          <span className="drawer-pill status" style={pill("#64748b")}><span className="pill-dot" />New</span>
        </div>
      )}
      {step >= 5 && (
        <div className="demo-bell demo-pop">
          <div className="demo-bell-head">
            <strong>Notifications</strong>
            <span className={`demo-sound ${step >= 6 ? "" : "on"}`} data-demo="sound">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
                {step >= 6 ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
              </svg>
              {step >= 6 ? "Sound off" : "Sound on"}
            </span>
          </div>
          <div className="demo-bell-item">A teammate assigned you #312 “Loan report fix”</div>
          <div className="demo-bell-item">Tester one passed testing on #298</div>
        </div>
      )}
    </div>
  );
}

// ---- 3. Tags ----

function TagsDemo({ step, elapsed }: DemoProps) {
  if (step === 3) {
    const query = typed("CR_INFO", elapsed, 400, 110);
    const found = typedDone("CR_INFO", elapsed, 400, 110);
    return (
      <div className="demo-card demo-wide">
        <span className="wn-try">Task sheet</span>
        <div className="wn-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <span>{query}<span className="demo-caret" /></span>
        </div>
        {found && (
          <ul className="wn-results demo-pop">
            <li><span>#305 · Loan disbursement condition</span><TagChip name="Database/DB" color="#2563eb" /></li>
            <li><span>#318 · Wrong balance in CR report</span><TagChip name="Database/DB" color="#2563eb" /></li>
            <li><span>#322 · Speed up CR export</span><TagChip name="Database/DB" color="#2563eb" /></li>
          </ul>
        )}
      </div>
    );
  }
  // Steps 0–2: the Tags box in the New task form.
  const tagText = step === 0 ? typed("data", elapsed) : "data";
  const picked = step >= 2;
  // Step 2 types two tables; each becomes a chip in capitals when Enter is pressed.
  const first = "cr_info";
  const second = "loan_master";
  const secondFrom = 300 + first.length * 85 + 500;
  const firstDone = step === 2 && typedDone(first, elapsed);
  const secondDone = step === 2 && typedDone(second, elapsed, secondFrom);
  const typing = step !== 2 ? "" : !firstDone ? typed(first, elapsed) : elapsed >= secondFrom ? typed(second, elapsed, secondFrom) : "";
  return (
    <div className="demo-card demo-wide">
      <span className="wn-try">New task · Tags</span>
      {picked ? (
        <div className="tag-row demo-pop">
          <div className="tag-row-head">
            <TagChip name="Database/DB" color="#2563eb" />
            <span className="tag-row-label">Tables <b className="req">*</b></span>
          </div>
          <div className="detail-input">
            {firstDone && <span className="detail-chip demo-pop">CR_INFO</span>}
            {secondDone && <span className="detail-chip demo-pop">LOAN_MASTER</span>}
            <span className="demo-typing">{secondDone ? "" : typing}<span className="demo-caret" /></span>
          </div>
          <small className="detail-help">Press Enter after each one · saved in capitals</small>
        </div>
      ) : (
        <>
          <div className="tag-add demo-focus">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0z" /><circle cx="8" cy="8" r="1.3" /></svg>
            <span className="demo-typing">{tagText}<span className="demo-caret" /></span>
          </div>
          {(step === 1 || typedDone("data", elapsed)) && (
            <div className="tag-suggestions demo-pop">
              <span className="tag-suggestion" style={pill("#2563eb")} data-demo="suggestion">
                <span className="seg-dot" aria-hidden="true" />Database/DB<em>+ tables</em>
              </span>
              <span className="tag-suggestion create">＋ New tag “data”</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- 4. Routine (Daily / Weekly) ----

function RoutineDemo({ step }: DemoProps) {
  const open = step >= 1;
  const weekly = step >= 2;
  const button = (name: string, color: string, selected: boolean, target?: string, extra?: ReactNode) => (
    <span className={`demo-seg ${selected ? "selected" : ""}`} style={pill(color)} data-demo={target}>
      <span className="seg-dot" aria-hidden="true" />{name}{extra}
    </span>
  );
  return (
    <div className="demo-card demo-wide">
      <span className="wn-try">Task · Type</span>
      <div className="demo-segmented">
        {button("Feature", "#2563eb", false)}
        {button("Bug", "#dc2626", false)}
        {button("Routine", weekly ? "#0369a1" : "#0f766e", weekly, "routine", <svg className={`routine-caret ${open ? "up" : ""}`} viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>)}
      </div>
      {open && (
        <div className="routine-choices demo-pop">
          <span>How often?</span>
          <div className="demo-segmented">
            {button("Daily", "#0f766e", false)}
            {button("Weekly", "#0369a1", weekly, "weekly")}
          </div>
        </div>
      )}
      {weekly && (
        <div className="wn-sheet demo-pop">
          <div className="wn-sheet-row head"><span>Issue title</span><span>Probable date</span><span>Gap days</span></div>
          <div className="wn-sheet-row">
            <span>Weekly backup check</span>
            <span><span className="routine-tag" style={pill("#0369a1")}>Weekly</span></span>
            <span className="wn-muted">—</span>
          </div>
        </div>
      )}
    </div>
  );
}

const SECTIONS: Section[] = [
  {
    id: "testing",
    title: "Every tester signs off on their own",
    summary: "When a task has more than one tester, each of them gives their own answer, and the task waits in Testing until everyone has answered.",
    steps: [
      { text: <>The developer adds testers in <b>Tested by</b>.</>, ms: 2200, target: "testedby", click: true },
      { text: <>The task moves to <b>Testing</b> by itself.</>, ms: 2000 },
      { text: <>Tester one clicks <b>✓ Pass testing</b>.</>, ms: 2000, target: "pass1", click: true },
      { text: <>The status shows <b>Testing 1/2</b> and waits for the other tester.</>, ms: 2600, target: "pass2" },
      { text: <>Tester two passes it too.</>, ms: 1600, target: "pass2", click: true },
      { text: <>Everyone passed, so the developer marks it <b>Completed</b>.</>, ms: 2200, target: "complete", click: true },
      { text: <>Done.</>, ms: 2000 },
    ],
    notes: [
      <>If a tester clicks <b>↩ Send back…</b> instead, they give a reason, and the task returns to <b>In Progress</b> once everyone has answered.</>,
      <>The developer is notified of every answer straight away.</>,
    ],
    Demo: TestingDemo,
  },
  {
    id: "alerts",
    title: "Sound and pop-up alerts for notifications",
    summary: "No need to keep watching the bell. B-Track plays a short chime and shows a pop-up on your computer when something needs you.",
    steps: [
      { text: <>After you sign in, click <b>Turn on</b>.</>, ms: 2200, target: "turnon", click: true },
      { text: <>Click <b>Allow</b> when your browser asks.</>, ms: 2000, target: "allow", click: true },
      { text: <>When something needs you, a chime plays and a pop-up appears.</>, ms: 2400, target: "rest" },
      { text: <>Click the pop-up to open the task.</>, ms: 1800, target: "toast", click: true },
      { text: <>The task opens.</>, ms: 1800, target: "rest" },
      { text: <>To mute, open the 🔔 bell and switch <b>Sound on</b> off.</>, ms: 2200, target: "sound", click: true },
      { text: <>The sound is off. Pop-ups still show.</>, ms: 1800 },
    ],
    notes: [<>You're alerted when a task is assigned to you, you're asked to test one, or a tester answers.</>],
    Demo: AlertsDemo,
  },
  {
    id: "tags",
    title: "Tags for tables, form files and screens",
    summary: "Tag an issue with what it touches, then find every task about the same table, form or screen.",
    steps: [
      { text: <>In <b>New task</b> (or <b>Edit</b>), start typing in the Tags box.</>, ms: 1900 },
      { text: <>Pick the matching tag, so names stay spelled the same.</>, ms: 1500, target: "suggestion", click: true },
      { text: <>List the tables, pressing <b>Enter</b> after each one.</>, ms: 3600 },
      { text: <>Later, search a table name to list every task that touches it.</>, ms: 3600 },
    ],
    notes: [
      <><b>Forms</b> asks for the .fmb, .fmx or .rdf files, and <b>Apex</b>, <b>Java</b> and <b>Flutter</b> ask for the screens.</>,
      <>You can also filter the sheet with <b>Filters → Tag</b>.</>,
    ],
    Demo: TagsDemo,
  },
  {
    id: "routine",
    title: "Weekly tasks, under a new Routine button",
    summary: "Work you repeat every week can now be logged as a Weekly task, the same way Daily tasks work.",
    steps: [
      { text: <>In the task's <b>Type</b>, click <b>Routine</b>.</>, ms: 2000, target: "routine", click: true },
      { text: <>Choose <b>Daily</b> or <b>Weekly</b>.</>, ms: 2000, target: "weekly", click: true },
      { text: <>No probable date is needed. The sheet shows <b>Weekly</b> instead.</>, ms: 3000 },
    ],
    notes: [<>Routine tasks have no gap days, are never overdue and get no deadline reminders.</>],
    Demo: RoutineDemo,
  },
];

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const CLICK_BEFORE_END = 450;

function ReleaseSection({ section, index, root }: { section: Section; index: number; root: HTMLElement | null }) {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [visible, setVisible] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  // Bumped when someone picks a step (even the current one), so its timer starts again.
  const [restarts, setRestarts] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const current = section.steps[step];
  const running = playing && visible;

  // Play only while the demo is on screen.
  useEffect(() => {
    if (!stage.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root, threshold: 0.45 });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!running) return;
    const startedAt = performance.now() - elapsed;
    const timer = setInterval(() => {
      const now = performance.now() - startedAt;
      if (now >= current.ms) {
        // Stop first: a slow machine could tick again before the next step renders and skip one.
        clearInterval(timer);
        setStep((step + 1) % section.steps.length);
        setElapsed(0);
      } else {
        setElapsed(now);
      }
    }, 50);
    return () => clearInterval(timer);
    // elapsed is read once when (re)starting, so a pause resumes where it stopped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, step, restarts]);

  const shownElapsed = running ? elapsed : Number.POSITIVE_INFINITY;
  const clicking = running && Boolean(current.click) && elapsed >= current.ms - CLICK_BEFORE_END && elapsed < current.ms - 120;

  // Move the pointer to this step's target, and press it while clicking.
  useLayoutEffect(() => {
    const box = stage.current;
    if (!box) return;
    const target = current.target ? box.querySelector<HTMLElement>(`[data-demo="${current.target}"]`) : null;
    box.querySelectorAll(".demo-press").forEach((element) => element !== target && element.classList.remove("demo-press"));
    if (!target) return;
    target.classList.toggle("demo-press", clicking);
    const stageRect = box.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const x = rect.left - stageRect.left + Math.min(rect.width / 2, 40);
    const y = rect.top - stageRect.top + rect.height / 2;
    if (!cursor || Math.abs(cursor.x - x) > 1 || Math.abs(cursor.y - y) > 1) setCursor({ x, y });
  });

  const goTo = (value: number) => {
    setStep(value);
    setElapsed(0);
    setRestarts((count) => count + 1);
    if (!reducedMotion()) setPlaying(true);
  };

  const { Demo } = section;
  return (
    <article id={`wn-${section.id}`} className="wn-item">
      <div className="wn-text">
        <span className="wn-number">{index + 1}</span>
        <h3>{section.title}</h3>
        <p>{section.summary}</p>
        <ol className="wn-steps-list">
          {section.steps.map((item, stepIndex) => (
            <li key={stepIndex}>
              <button type="button" className={stepIndex === step ? "active" : stepIndex < step ? "done" : ""} onClick={() => goTo(stepIndex)} aria-current={stepIndex === step ? "step" : undefined}>
                <span className="wn-step-dot">{stepIndex + 1}</span>
                <span>{item.text}</span>
              </button>
            </li>
          ))}
        </ol>
        {section.notes.length > 0 && <ul className="wn-notes">{section.notes.map((note, noteIndex) => <li key={noteIndex}>{note}</li>)}</ul>}
      </div>
      <div className="wn-player">
        <div className="wn-stage" ref={stage} aria-hidden="true">
          <Demo step={step} elapsed={shownElapsed} />
          {cursor && (
            <span className={`demo-cursor ${clicking ? "clicking" : ""}`} style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}>
              <svg viewBox="0 0 24 24"><path d="M5 3.5 18.5 12l-6 1.3-3.2 5.7z" /></svg>
            </span>
          )}
        </div>
        <div className="wn-caption">{current.text}</div>
        <div className="wn-controls">
          <button type="button" className="wn-play" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause the demo" : "Play the demo"} title={playing ? "Pause" : "Play"}>
            {playing ? (
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9M11 3.5v9" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2 12.5 8 5 12.8z" /></svg>
            )}
          </button>
          <div className="wn-progress" aria-hidden="true">
            {section.steps.map((item, stepIndex) => (
              <span key={stepIndex}>
                <i style={{ width: stepIndex < step ? "100%" : stepIndex > step ? "0%" : `${Math.min(100, (running ? elapsed / item.ms : 1) * 100)}%` }} />
              </span>
            ))}
          </div>
          <button type="button" className="wn-replay" onClick={() => goTo(0)} aria-label="Replay the demo" title="Replay">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.6" /><path d="M3 2.5v2.5h2.5" /></svg>
          </button>
        </div>
      </div>
    </article>
  );
}

export function WhatsNew({ onClose }: { onClose: () => void }) {
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const jump = (id: string) => body?.querySelector(`#wn-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="modal-backdrop wn-backdrop">
      <section className="whats-new" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
        <header className="wn-header">
          <img src="/logo.svg" alt="" width={34} height={34} />
          <div>
            <h2 id="whats-new-title">What's new in B-Track</h2>
            <p>{RELEASE.date} · {SECTIONS.length} updates · each one with a short demo</p>
          </div>
          <button ref={closeButton} type="button" className="wn-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <nav className="wn-index" aria-label="Updates">
          {SECTIONS.map((section, index) => (
            <button key={section.id} type="button" onClick={() => jump(section.id)}>
              <span>{index + 1}</span>
              {section.title}
            </button>
          ))}
        </nav>
        <div className="wn-body" ref={setBody}>
          {body && SECTIONS.map((section, index) => <ReleaseSection key={section.id} section={section} index={index} root={body} />)}
          <p className="wn-again">You can open this again any time from the <span aria-hidden="true">🔔</span> notifications panel.</p>
        </div>
      </section>
    </div>
  );
}
