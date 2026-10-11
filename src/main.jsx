import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/home.css";
import "./styles/analyse.css";
import "./styles/history.css";
import "./styles/profile.css";
import "./styles/alterego.css";
import "./styles/archetype.css";
import "./styles/tour.css";
import "./styles/coach.css";
import "./styles/sources.css";
import "./styles/feed.css";
import "./styles/terrain.css";
import "./styles/cockpit.css";
import "./styles/shell.css";
import "./styles/ds.css";
import GPXAnalyzer from "./GPXAnalyzer.jsx";
import { getThemeState } from "./lib/theme.js";

getThemeState(); // initialise le store de thème (reprend la main sur le script précoce d'index.html)

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GPXAnalyzer />
  </React.StrictMode>
);
