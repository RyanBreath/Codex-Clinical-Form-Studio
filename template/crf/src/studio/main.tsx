import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioApp } from "./StudioApp";
import "./studio.css";

const root = document.getElementById("root");
if (!root) throw new Error("Studio root element was not found.");

createRoot(root).render(
  <StrictMode>
    <StudioApp />
  </StrictMode>,
);
