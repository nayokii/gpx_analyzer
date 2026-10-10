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
import GPXAnalyzer from "./GPXAnalyzer.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GPXAnalyzer />
  </React.StrictMode>
);
