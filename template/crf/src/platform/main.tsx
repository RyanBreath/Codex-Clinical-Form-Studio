import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./platform.css";
const PlatformApp = lazy(() => import("./PlatformApp").then(module => ({ default: module.PlatformApp })));
const EmbeddedForm = lazy(() => import("./EmbeddedForm").then(module => ({ default: module.EmbeddedForm })));
const IntegrationDemo = lazy(() => import("./EmbeddedForm").then(module => ({ default: module.IntegrationDemo })));
const params = new URLSearchParams(window.location.search);
const occurrence = params.get("occurrence");
createRoot(document.getElementById("root")!).render(<Suspense fallback={<main className="embedded-workspace">正在載入工作區…</main>}>{occurrence ? <EmbeddedForm occurrenceId={occurrence} /> : params.has("integration-demo") ? <IntegrationDemo /> : <PlatformApp />}</Suspense>);
