// Documents stored in a2_doc (migration 014). auth is { p_pw } for admin or { p_pin } for referee
import { rpc, esc } from "./common.js";

export const listDocs = (auth) => rpc("a2_doc_list", auth);
export const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

// Open a document in a new tab. The tab is opened before the download so phones do not block it as a popup
export async function openDoc(id, auth) {
  const w = window.open("", "_blank");
  if (w) w.document.write('<p style="font-family:sans-serif;padding:20px">Loading...</p>');
  try {
    const r = (await rpc("a2_doc_get", { p_id: id, ...auth }))[0];
    if (!r) throw new Error("ไม่พบเอกสาร");
    const bin = atob(r.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
    if (w) w.location.href = url; else location.href = url;
  } catch (e) { if (w) w.close(); throw e; }
}

// Read a File as base64 without the data: prefix
export const fileToB64 = (file) => new Promise((ok, bad) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).split(",")[1] || "");
  fr.onerror = () => bad(fr.error);
  fr.readAsDataURL(file);
});

// Rows for a document list. withDelete adds the admin delete button
export const docRows = (docs, withDelete) => docs.length
  ? docs.map((d) => `<div class="docrow"><button class="btn small" data-doc="${d.id}">Open</button><div><b>${esc(d.title)}</b><div class="muted">${esc(d.file_name)} · ${fmtSize(d.size)}</div></div>${withDelete ? `<button class="btn small danger" data-docdel="${d.id}" data-t="${esc(d.title)}">Delete</button>` : ""}</div>`).join("")
  : `<p class="muted">ยังไม่มีเอกสาร</p>`;
