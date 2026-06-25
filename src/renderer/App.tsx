import { useMemo, useState } from "react";
import { formatDuration } from "../shared/time";

type Route = "main" | "overlay";

function getRoute(): Route {
  return window.location.hash.includes("overlay") ? "overlay" : "main";
}

export function App() {
  const route = useMemo(getRoute, []);

  if (route === "overlay") {
    return <OverlayView />;
  }

  return <MainView />;
}

function MainView() {
  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Local-first desktop tracker</p>
          <h1>Timesheet Tracker</h1>
        </div>
        <button className="secondary-button" onClick={() => window.timesheetDesktop?.showMainWindow()}>
          Main Window
        </button>
      </section>

      <section className="today-layout">
        <div className="panel timer-panel">
          <p className="section-label">Current Task</p>
          <h2>Stage 1 Scaffold</h2>
          <p className="timer-readout">{formatDuration(0)}</p>
          <div className="button-row">
            <button className="primary-button">Start</button>
            <button className="secondary-button">Add Note</button>
          </div>
        </div>

        <div className="panel">
          <p className="section-label">Today</p>
          <h2>Ready for local tracking</h2>
          <p className="muted-copy">
            The foundation is in place for tasks, timers, notes, local storage, and the overlay window.
          </p>
        </div>
      </section>
    </main>
  );
}

function OverlayView() {
  const [pinned, setPinned] = useState(true);
  const [note, setNote] = useState("");

  async function togglePinned() {
    const nextPinned = !pinned;
    const actualPinned = await window.timesheetDesktop?.setOverlayPinned(nextPinned);
    setPinned(Boolean(actualPinned));
  }

  return (
    <main className="overlay-shell">
      <header className="overlay-header">
        <span>Timesheet</span>
        <div className="overlay-actions">
          <button aria-label="Show main window" onClick={() => window.timesheetDesktop?.showMainWindow()}>
            Open
          </button>
          <button aria-label="Pin overlay" onClick={togglePinned}>
            {pinned ? "Pinned" : "Pin"}
          </button>
          <button aria-label="Hide overlay" onClick={() => window.timesheetDesktop?.closeOverlay()}>
            Hide
          </button>
        </div>
      </header>

      <section className="overlay-task">
        <p className="section-label">Current</p>
        <h1>Choose a task</h1>
        <p className="overlay-time">{formatDuration(0)}</p>
        <button className="primary-button wide">Start</button>
      </section>

      <textarea
        aria-label="Quick note"
        placeholder="Add a quick note..."
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </main>
  );
}
