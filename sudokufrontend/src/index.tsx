import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Main } from "./main"

const dashboard = document.getElementById("main");
if (dashboard !== null) {
    const root = createRoot(dashboard);
    root.render(
        <StrictMode>
            <Main />
        </StrictMode>
    );
}

// const ranking = document.getElementById("ranking");
// if (ranking !== null) {
//     const root = createRoot(ranking);
//     root.render(
//         <StrictMode>
//             <Ranking />
//         </StrictMode>
//     );
// }