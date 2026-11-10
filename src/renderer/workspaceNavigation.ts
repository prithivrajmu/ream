import { useCallback, useEffect, useState } from "react";

const sections = ["home", "insights", "timesheet", "entries", "tasks", "notes", "journal", "projects", "backup", "dev", "profile"] as const;
export type ActiveSection = typeof sections[number];

function readSection(): ActiveSection {
  const section = window.location.hash.replace(/^#\/?/, "");
  return sections.find((candidate) => candidate === section) ?? "home";
}

export function useWorkspaceNavigation() {
  const [section, setSection] = useState(readSection);
  useEffect(() => {
    const sync = () => setSection(readSection());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    document.querySelector(".dashboard-page")?.scrollTo(0, 0);
  }, [section]);

  const navigate = useCallback((next: ActiveSection) => {
    window.location.hash = `/${next}`;
    setSection(next);
  }, []);
  return [section, navigate] as const;
}
