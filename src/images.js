// Image data for image-based questions. SVGs live under /public/img.
// Q55 (Swiss flag) and Q110 (Zürich arms) options match the four images in the official
// catalogue; the rest reference open-licensed assets (see Help → Image credits).
// Prefix with Vite's base URL so paths resolve under a GitHub Pages sub-path too.
const B = (import.meta.env && import.meta.env.BASE_URL) || "/"; // "/" locally / under Node; "/<repo>/" on GitHub Pages
const img = (p) => B + p.replace(/^\//, "");
export const Q_IMAGES = {
  55: ["/img/flag-denmark.svg", "/img/flag-redcross.svg", "/img/flag-switzerland.svg", "/img/arms-schwyz.svg"].map(img),
  110: ["/img/arms-zh-vert-bw.svg", "/img/arms-zh-fess-b.svg", "/img/arms-zurich.svg", "/img/arms-zh-vert-rb.svg"].map(img),
  289: ["/img/loc-geneva.svg", "/img/loc-zurich.svg", "/img/loc-ticino.svg", "/img/loc-vaud.svg"].map(img),
};
