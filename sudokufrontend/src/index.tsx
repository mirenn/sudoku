import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {Ranking} from "./main"

// const dashboard = document.getElementById("dashboard_kari");
// if (dashboard !== null) {
//     const root = createRoot(dashboard);
//     root.render(
//         <StrictMode>
//             <DashBoard />
//         </StrictMode>
//     );
// }

const ranking = document.getElementById("ranking");
if (ranking !== null) {
    const root = createRoot(ranking);
    root.render(
        <StrictMode>
            <Ranking />
        </StrictMode>
    );
}