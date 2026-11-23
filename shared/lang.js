// Display language for labels made by the shared modules (stage names, team sources, bracket titles, document buttons).
// The Dashboard stays in English for the TV. Admin calls setLang("th") before it draws anything.
export let LANG = "en";
export const setLang = (l) => { LANG = l === "th" ? "th" : "en"; };
export const th = () => LANG === "th";
