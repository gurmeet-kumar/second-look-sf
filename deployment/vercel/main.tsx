import { createRoot } from "react-dom/client";
import "@fontsource-variable/source-sans-3";
import "../../app/globals.css";
import "./vercel.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
