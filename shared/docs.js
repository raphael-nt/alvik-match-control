// Documents stored in a2_doc (migration 014). auth is { p_pw } for admin or { p_pin } for referee
import { rpc, esc } from "./common.js";

export const listDocs = (auth) => rpc("a2_doc_list", auth);
export const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

// ---------- Popup viewer: PDF pages drawn with PDF.js, images shown directly ----------
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
let pdfjsP = null;
const loadPdfJs = () => pdfjsP || (pdfjsP = new Promise((ok, bad) => {
  const sc = document.createElement("script"); sc.src = PDFJS + "pdf.min.js";
  // Workers from another origin are blocked, so load the worker code into a same-origin blob URL
  sc.onload = async () => { try { const js = await (await fetch(PDFJS + "pdf.worker.min.js")).text(); window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([js], { type: "text/javascript" })); ok(window.pdfjsLib); } catch (e) { pdfjsP = null; bad(new Error("โหลดตัวแสดง PDF ไม่ได้ ตรวจอินเทอร์เน็ต")); } };
  sc.onerror = () => { pdfjsP = null; bad(new Error("โหลดตัวแสดง PDF ไม่ได้ ตรวจอินเทอร์เน็ต")); };
  document.head.append(sc);
}));
const b64bytes = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export const closeX = `<button class="xbtn" data-xclose aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg><span>Close</span></button>`;

export function closeDoc() { const m = document.getElementById("docpop"); if (m) m.remove(); }
export async function showDoc(id, auth, title) {
  closeDoc();
  const m = document.createElement("div"); m.id = "docpop"; m.className = "pop";
  m.innerHTML = `<div class="pop-h"><b>${esc(title || "Document")}</b><button class="pz" data-pz="-1" aria-label="Zoom out">−</button><button class="pz" data-pz="1" aria-label="Zoom in">+</button>${closeX}</div><div class="pop-b" id="docbody"><p class="pop-msg">Loading...</p></div>`;
  document.body.append(m);
  const body = m.querySelector("#docbody");
  try {
    const r = (await rpc("a2_doc_get", { p_id: id, ...auth }))[0];
    if (!r) throw new Error("ไม่พบเอกสาร");
    if (!document.body.contains(m)) return;
    if (r.mime.startsWith("image/")) { body.innerHTML = `<img class="pop-img" src="data:${r.mime};base64,${r.data}" alt="">`; return; }
    if (r.mime !== "application/pdf") { body.innerHTML = `<p class="pop-msg">แสดงไฟล์ชนิดนี้ไม่ได้</p>`; return; }
    const lib = await loadPdfJs(), pdf = await lib.getDocument({ data: b64bytes(r.data) }).promise;
    body.innerHTML = "";
    // Pages are drawn at up to 3x screen pixels so zoom stays fairly sharp without using too much phone memory; the + and - buttons only change the CSS width
    const w = body.clientWidth - 16, dpr = Math.min(3, (window.devicePixelRatio || 1) * 1.5);
    for (let i = 1; i <= pdf.numPages; i++) {
      if (!document.body.contains(m)) return;
      const pg = await pdf.getPage(i), v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: (w / v1.width) * dpr });
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; c.style.width = `calc(${w}px * var(--pz, 1))`; c.className = "pop-page";
      body.append(c); await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    }
  } catch (e) { body.innerHTML = `<p class="pop-msg">${esc(e.message || "เปิดเอกสารไม่ได้")}</p>`; }
}
document.addEventListener("click", (e) => {
  if (e.target.closest("#docpop [data-xclose]")) return closeDoc();
  const z = e.target.closest("#docpop [data-pz]"); if (!z) return;
  const m = document.getElementById("docpop"), cur = +m.style.getPropertyValue("--pz") || 1;
  m.style.setProperty("--pz", Math.max(1, Math.min(2.5, cur + (z.dataset.pz === "1" ? 0.5 : -0.5))));
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDoc(); });

// Read a File as base64 without the data: prefix
export const fileToB64 = (file) => new Promise((ok, bad) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).split(",")[1] || "");
  fr.onerror = () => bad(fr.error);
  fr.readAsDataURL(file);
});

// Rows for a document list. withDelete adds the admin delete button
export const docRows = (docs, withDelete) => docs.length
  ? docs.map((d) => `<div class="docrow"><button class="btn small" data-doc="${d.id}" data-t="${esc(d.title)}">Open</button><div><b>${esc(d.title)}</b><div class="muted">${esc(d.file_name)} · ${fmtSize(d.size)}</div></div>${withDelete ? `<button class="btn small danger" data-docdel="${d.id}" data-t="${esc(d.title)}">Delete</button>` : ""}</div>`).join("")
  : `<p class="muted">ยังไม่มีเอกสาร</p>`;
