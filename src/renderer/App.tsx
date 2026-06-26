import { useEffect, useState } from "react";
import { MainView } from "./views/MainView";
import { OverlayView } from "./views/OverlayView";

type Route = "main" | "overlay";

function getRoute(): Route {
  return window.location.hash.includes("overlay") ? "overlay" : "main";
}

export function App() {
  const [route] = useState<Route>(() => getRoute());

  useEffect(() => {
    const isOverlay = route === "overlay";
    document.documentElement.classList.toggle("overlay-route", isOverlay);
    document.body.classList.toggle("overlay-route", isOverlay);

    return () => {
      document.documentElement.classList.remove("overlay-route");
      document.body.classList.remove("overlay-route");
    };
  }, [route]);

  if (route === "overlay") {
    return <OverlayView />;
  }

  return <MainView />;
}
