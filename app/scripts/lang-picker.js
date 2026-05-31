
// scripts/lang-picker.js
import { loadLanguage } from "./lang.js"; // ton loader existant

// helper: mapping couleurs / gradients par code (simplifié — tu peux compléter)
const flagBackgrounds = {
    "fr": "linear-gradient(90deg,#0055A4,#EDF0F6, #C8102E)",            
    "en": "linear-gradient(45deg,#012169,#C8102E, #EDF0F6)", 
    "es": "linear-gradient(180deg,#C60B1E,#F1BF00, #C60B1E)",         
    "de": "linear-gradient(180deg,#000,#DD0000, #F1BF00)",              
    "it": "linear-gradient(90deg,#008C45,#F4F4F4, #C8102E)"
};

const manifestUrl = "/app/lang/manifest.json"; // must exist

async function loadLanguagesFromManifest() {
    try {
        const res = await fetch(manifestUrl, { cache: "no-cache" });
        if (!res.ok) throw new Error("manifest fetch error " + res.status);
        const data = await res.json();
        return data.languages || [];
    } catch (e) {
        console.error("Lang manifest load error:", e);
        return [];
    }
}

function createItem(lang) {
    const div = document.createElement("div");
    div.className = "lp-item";
    div.dataset.code = lang.code;

    // flag container
    const flag = document.createElement("div");
    flag.className = "flag";
    flag.textContent = lang.flag || "🌐";

    // apply background gradient if mapping exists
    const bg = flagBackgrounds[lang.code] || flagBackgrounds[lang.code.split("-")[0]] || flagBackgrounds.default;
    flag.style.background = bg;

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = lang.name || lang.code;

    div.appendChild(flag);
    div.appendChild(label);
    return div;
}

async function initLangPicker() {
    const openBtn = document.getElementById("lpOpenBtn");
    const popup = document.getElementById("lpPopup");
    const grid = document.getElementById("lpGrid");
    const search = document.getElementById("lpSearch");
    const currentFlag = document.getElementById("lpCurrentFlag");
    const currentLabel = document.getElementById("lpCurrentLabel");
    const count = document.getElementById("lpCount");

    const langs = await loadLanguagesFromManifest();

    // render all items
    function render(list) {
        grid.textContent = "";
        list.forEach(l => {
            const item = createItem(l);
            item.addEventListener("click", async () => {
                // deselect
                grid.querySelectorAll(".lp-item").forEach(i => i.classList.remove("active"));
                item.classList.add("active");

                // set current UI
                currentFlag.textContent = l.flag || "🌐";
                currentLabel.textContent = l.name || l.code;

                // save and call loader
                localStorage.setItem("lang", l.code);
                await loadLanguage(l.code);

                // close popup with a tiny delay for animation
                popup.classList.remove("open");
                openBtn.setAttribute("aria-expanded", "false");
            });
            grid.appendChild(item);
        });
        highlightActive(localStorage.getItem("lang") || "fr");
    }

    // highlight existing selection
    function highlightActive(code) {
        grid.querySelectorAll(".lp-item").forEach(i => {
            i.classList.toggle("active", i.dataset.code === code);
        });
        const active = grid.querySelector(`.lp-item[data-code="${code}"]`);
        if (active) {
            currentFlag.textContent = active.querySelector(".flag").textContent;
            currentLabel.textContent = active.querySelector(".label").textContent;
        }
    }

    // initial render
    render(langs);

    // open/close
    openBtn.addEventListener("click", (e) => {
        const isOpen = popup.classList.contains("open");
        popup.classList.toggle("open", !isOpen);
        openBtn.setAttribute("aria-expanded", String(!isOpen));
    });

    // click outside closes
    document.addEventListener("click", (e) => {
        if (!openBtn.contains(e.target) && !popup.contains(e.target)) {
            popup.classList.remove("open");
            openBtn.setAttribute("aria-expanded", "false");
        }
    });

    // keyboard accessibility: Esc to close
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            popup.classList.remove("open");
            openBtn.setAttribute("aria-expanded", "false");
        }
    });

    // ensure active highlight after languages load or change
    const initial = localStorage.getItem("lang") || "fr";
    highlightActive(initial);
}

// auto-init on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
    initLangPicker().catch(err => console.error(err));
});