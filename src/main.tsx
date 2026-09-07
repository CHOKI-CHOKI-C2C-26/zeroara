import { Buffer } from "buffer";
// Same Uint8Array hex/base64 polyfills the pdf.js worker gets (public/pdf.polyfills.mjs).
import "./polyfills/uint8array";

if (typeof window !== "undefined") {
  (window as any).global = window;
  (window as any).Buffer = Buffer;
}

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Landing } from "./pages/Landing";
import { currentRoute, type Route } from "./pages/router";

/* "/" shows the landing page. Everything that carries a request or a view
   (SDK popups, deep links, ?view=DEMO, the hidden audit frame, /app) boots
   straight into the app, so integrations are unaffected. */
function Root() {
  const [route, setRoute] = useState<Route>(() => currentRoute());
  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return route === "landing" ? <Landing /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
