import "./styles.css";
import "../../src/brand.css";
import "../../src/styles.css";
import "./workbench.css";
import { createRoot } from "react-dom/client";
import { initTheme } from "../../src/shell/theme";
import { Workbench } from "./workbench";

initTheme();
createRoot(document.getElementById("root")!).render(<Workbench />);
