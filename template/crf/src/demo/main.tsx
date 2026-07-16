import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./DemoApp";
import "./demo.css";

const root = document.getElementById("root");
if (!root) throw new Error("Demo root element was not found.");

createRoot(root).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>,
);
