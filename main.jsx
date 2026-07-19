import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// If anything crashes, show it on screen instead of a blank page
function showError(msg) {
  let el = document.getElementById("crash");
  if (!el) {
    el = document.createElement("pre");
    el.id = "crash";
    el.style.cssText = "position:fixed;inset:auto 0 0 0;max-height:50vh;overflow:auto;background:#2b1414;color:#ffb4a8;padding:12px;margin:0;font-size:11px;z-index:9999;white-space:pre-wrap;";
    document.body.appendChild(el);
  }
  el.textContent += msg + "\n";
}
window.addEventListener("error", (e) => showError("Error: " + (e.error?.stack || e.message)));
window.addEventListener("unhandledrejection", (e) => showError("Promise: " + (e.reason?.stack || e.reason)));

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) return React.createElement("pre", { style: { color: "#ffb4a8", background: "#2b1414", padding: 16, whiteSpace: "pre-wrap", fontSize: 12 } }, "App crashed:\n" + (this.state.err?.stack || String(this.state.err)));
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>
);

// Offline mode retired on this build — the device wipes caches on reboot,
// making a service worker a liability. Clean out any old registration.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
}
