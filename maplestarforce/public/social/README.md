# Starforce link preview

`starforce-star.svg` uses the same path and colors as the Starforce menu icon in
`src/shared/tool-nav.js` and `src/style.css`. The 1200 × 630 PNG is its browser-rendered
export for Open Graph and Twitter link previews, with the star centered so it also
fits square thumbnail crops. The main page points to the PNG using an absolute URL.

When changing the icon, update the SVG and export the PNG at its original dimensions.
