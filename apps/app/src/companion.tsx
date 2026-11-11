import React from "react";
import { createRoot } from "react-dom/client";
import { bootstrapTheme } from "./app/theme";
import { Companion } from "./react-app/domains/desktop-companion/companion";
import "./app/index.css";
import "./react-app/domains/desktop-companion/companion.css";

bootstrapTheme();
const root = document.getElementById("root");
if (root) createRoot(root).render(<React.StrictMode><Companion /></React.StrictMode>);
