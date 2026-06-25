import { useState } from "react";
import { MainView } from "./views/MainView";
import { OverlayView } from "./views/OverlayView";

type Route = "main" | "overlay";

function getRoute(): Route {
  return window.location.hash.includes("overlay") ? "overlay" : "main";
}

export function App() {
  const [route] = useState<Route>(() => getRoute());

  if (route === "overlay") {
    return <OverlayView />;
  }

  return <MainView />;
}
