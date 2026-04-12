const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const htmlPath = path.join(projectRoot, 'index.html');

console.log('Reading index.html...');
let html = fs.readFileSync(htmlPath, 'utf8');

// 1. Inline CSS
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"?]+)">/g, (match, href) => {
    console.log(`Inlining CSS: ${href}`);
    const cssPath = path.join(projectRoot, href);
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    return `<style>\n/* ${href} */\n${cssContent}\n</style>`;
});

// 2. Inline JS
html = html.replace(/<script\s+src="([^"]+?)(?:\?v=[0-9]+)?"><\/script>/g, (match, src) => {
    console.log(`Inlining JS: ${src}`);
    const jsPath = path.join(projectRoot, src);
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    // Escape script tags inside the javascript to prevent closing the wrapper early
    const safeContent = jsContent.replace(/<\/script>/g, '<\\/script>');
    return `<script>\n/* ${src} */\n${safeContent}\n</script>`;
});

// 3. Inline images and manifest as base64 data URIs
console.log('Inlining icon.svg and manifest.json...');
const svgPath = path.join(projectRoot, 'icon.svg');
const svgData = fs.readFileSync(svgPath).toString('base64');
const svgUri = `data:image/svg+xml;base64,${svgData}`;
html = html.replace(/href="icon\.svg"/g, `href="${svgUri}"`);

const manifestPath = path.join(projectRoot, 'manifest.json');
const manifestData = fs.readFileSync(manifestPath).toString('base64');
const manifestUri = `data:application/json;base64,${manifestData}`;
html = html.replace(/href="manifest\.json"/g, `href="${manifestUri}"`);

// 4. Remove Service Worker Registration block
console.log('Stripping out service worker registration...');
html = html.replace(/<script>\s*if\s*\('serviceWorker'\s*in\s*navigator\)\s*\{[\s\S]*?\}\s*<\/script>/g, '');

const outPath = path.join(projectRoot, 'noteview.html');
fs.writeFileSync(outPath, html);

const stats = fs.statSync(outPath);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
console.log(`\nSuccessfully built noteview.html! (${sizeMB} MB)`);
