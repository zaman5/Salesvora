// Runs after build on Hostinger — copies static files to public_html/
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const src = path.join(cwd, 'dist/public');

// INVARIANT: dist/boot.js must be a SELF-CONTAINED bundle.
//
// The server build deliberately does not use esbuild's --packages=external.
// With it, boot.js was a thin 364kb shim that resolved every dependency from
// the checkout's node_modules at runtime, which made booting only as reliable
// as that directory. On 2026-07-25 it wasn't: an interrupted/partial npm
// install left @trpc/server holding chunks from two different versions, so
// Node died at startup with
//   ERR_MODULE_NOT_FOUND: .../@trpc/server/dist/codes-DagpWZLc.mjs
//   imported from .../@trpc/server/dist/getErrorShape-BPSzUA7W.mjs
// and the whole API answered 503. Nothing in the app could detect or recover
// from that, because the failure happened before any of the app's own code ran.
//
// Bundling every JS dependency in makes the running server independent of
// node_modules entirely (verified by booting it in an empty directory). Only
// better-sqlite3 stays external, and only as the unreachable fallback arm of
// api/mailsender/db.ts — the host's Node 24 provides node:sqlite. If you ever
// reintroduce --packages=external, you are also reintroducing this outage.

// Detect Hostinger by checking if public_html is in the path
const isHostinger = cwd.includes('public_html');

if (!isHostinger) {
  console.log('[deploy] Local environment detected — skipping copy.');
  process.exit(0);
}

// Find public_html directory dynamically regardless of subdirectory depth.
// Normalise separators first so this is exercisable off-Linux too.
const parts = cwd.replace(/\\/g, '/').split('/');
const pubIndex = parts.indexOf('public_html');
const dest = parts.slice(0, pubIndex + 1).join('/');

console.log('[deploy] Detected path parts:', parts.slice(pubIndex));


console.log('[deploy] Hostinger detected.');
console.log('[deploy] Copying from:', src);
console.log('[deploy] Copying to:', dest);

if (!fs.existsSync(src)) {
  console.error('[deploy] ERROR: dist/public not found. Build may have failed.');
  process.exit(1);
}

// Stage the PHP proxy INTO the build output before copying.
//
// The proxy used to be copied to public_html on its own, after .htaccess was
// written. That ordering is what took the site down on 2026-07-25: .htaccess
// landed, the separate proxy copy did not, and every /api request was then
// rewritten to a file that was not there — LiteSpeed answered a bare 404 for
// auth.login, auth.me and every other tRPC call while the SPA itself loaded
// fine. Shipping the proxy as part of dist/public means it rides the same
// fs.cpSync as index.html: if the site's HTML landed, the proxy landed too.
const phpSrc = path.join(cwd, 'scripts/api-proxy.php');
if (!fs.existsSync(phpSrc)) {
  console.error('[deploy] ERROR: scripts/api-proxy.php is missing from the checkout.');
  console.error('[deploy]   Without it every /api request 404s. Refusing to deploy.');
  process.exit(1);
}
fs.copyFileSync(phpSrc, path.join(src, 'api-proxy.php'));
console.log('[deploy] ✓ api-proxy.php staged into dist/public/');

// Copy all static files to public_html/
fs.cpSync(src, dest, { recursive: true, force: true });
console.log('[deploy] ✓ Static files copied to public_html/');

// Keep a copy of the server bundle where nothing ever deletes it.
//
// Hostinger removes .builds/source/repository once a deploy completes, so the
// checkout is NOT a durable home for dist/boot.js. The proxy can only start
// Node in the window between this script running and that cleanup; if the
// process later dies there is no boot.js left to restart from and the API is
// permanently 503 with no way back short of pushing another commit. That is
// the state the site was found in.
//
// The data directory is outside both the checkout and the web root, and is
// where db.json and app_secret already live for the same reason. Copying the
// bundle there is only possible because it is now self-contained — see the
// INVARIANT note above.
const bootSrc = path.join(cwd, 'dist/boot.js');
const homeMatch = cwd.replace(/\\/g, '/').match(/^(\/home\/[^/]+)\//);
if (homeMatch && fs.existsSync(bootSrc)) {
  const dataDir = path.join(homeMatch[1], 'salesvora-data');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    // Write beside the target then rename, so a restart that happens during
    // this copy sees either the old bundle or the new one, never a half file.
    const tmp = path.join(dataDir, 'boot.js.tmp');
    fs.copyFileSync(bootSrc, tmp);
    fs.renameSync(tmp, path.join(dataDir, 'boot.js'));
    const kb = Math.round(fs.statSync(path.join(dataDir, 'boot.js')).size / 1024);
    console.log(`[deploy] ✓ Server bundle mirrored to ${dataDir}/boot.js (${kb} kb)`);
  } catch (err) {
    // Non-fatal: the checkout copy still works for this deploy's boot window.
    console.log(`[deploy] Note: could not mirror boot.js (${err.message}).`);
    console.log('[deploy]   The API will not survive a restart once the checkout is cleaned.');
  }
} else if (!fs.existsSync(bootSrc)) {
  console.log('[deploy] Note: dist/boot.js not found — server bundle not mirrored.');
}

// Permissions the web server needs: 0755 on directories, 0644 on files.
//
// This is not belt-and-braces — fs.cpSync copies the SOURCE mode onto the
// destination, and because `dest` is public_html itself, the docroot inherits
// whatever mode dist/public was built with. Under a restrictive umask that
// leaves public_html unreadable by the web server, and LiteSpeed reports an
// unreadable docroot as a bare "403 Forbidden". Reassert the modes explicitly
// so a deploy can never lock the site out this way.
const DIR_MODE = 0o755;
const FILE_MODE = 0o644;

function chmodTree(target) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return; // vanished between readdir and stat — nothing to do
  }
  if (stat.isDirectory()) {
    fs.chmodSync(target, DIR_MODE);
    for (const entry of fs.readdirSync(target)) chmodTree(path.join(target, entry));
  } else {
    fs.chmodSync(target, FILE_MODE);
  }
}

// Only walk what we just copied. public_html also contains the .builds/
// checkout (source + node_modules) and recursing into that would be slow and
// pointless — it is never served.
fs.chmodSync(dest, DIR_MODE);
for (const entry of fs.readdirSync(src)) chmodTree(path.join(dest, entry));
console.log('[deploy] ✓ Permissions set (dirs 755, files 644)');

// Gate the .htaccess on the proxy actually being in the docroot.
//
// The .htaccess below rewrites every /api and /health request to
// /api-proxy.php. Installing it while that file is absent is strictly worse
// than not deploying at all: the SPA loads and then every API call answers a
// bare LiteSpeed 404. So confirm the proxy is there — retrying the copy
// directly if the bundle copy somehow missed it — and bail out before
// touching .htaccess if it still is not, leaving the previous working
// .htaccess and proxy in place.
const phpDest = path.join(dest, 'api-proxy.php');
if (!fs.existsSync(phpDest)) {
  console.log('[deploy] api-proxy.php not found in public_html — copying directly.');
  fs.copyFileSync(phpSrc, phpDest);
}
fs.chmodSync(phpDest, FILE_MODE);

if (!fs.existsSync(phpDest) || fs.statSync(phpDest).size === 0) {
  console.error('[deploy] ✗ api-proxy.php is missing or empty in public_html.');
  console.error('[deploy]   Every /api request would answer 404. Aborting before');
  console.error('[deploy]   .htaccess is written so the previous deploy keeps serving.');
  process.exit(1);
}
console.log(`[deploy] ✓ api-proxy.php in public_html/ (${fs.statSync(phpDest).size} bytes)`);

// Create .htaccess — routes API calls through PHP proxy (no mod_proxy needed)
const htaccess = `# Salesvora - React SPA + PHP API Proxy
Options -MultiViews

# Be explicit rather than relying on the server default: with no usable
# DirectoryIndex and directory listing disabled, a request for "/" is answered
# with 403 Forbidden, not 404.
DirectoryIndex index.html

RewriteEngine On

# The deploy checkout lives at public_html/.builds/ — it holds the full source
# tree, node_modules and .env, all of which would otherwise be downloadable.
# Block it and every other dotfile, but keep /.well-known/ reachable so
# certificate issuance and renewal still work.
RewriteCond %{REQUEST_URI} !^/\\.well-known/
RewriteRule (^|/)\\. - [F]

# Serve existing static files directly
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# Route API calls through PHP proxy (auto-starts Node.js server)
RewriteCond %{REQUEST_URI} ^/api [NC,OR]
RewriteCond %{REQUEST_URI} ^/health [NC]
RewriteRule ^(.*)$ /api-proxy.php [L,QSA]

# All other routes → React SPA
RewriteRule ^ /index.html [L]
`;

const htaccessPath = path.join(dest, '.htaccess');
fs.writeFileSync(htaccessPath, htaccess);
fs.chmodSync(htaccessPath, FILE_MODE);
console.log('[deploy] ✓ .htaccess created in public_html/');

// Also copy the server file for Node.js
const serverSrc = path.join(cwd, 'dist/boot.js');
if (fs.existsSync(serverSrc)) {
  console.log('[deploy] ✓ dist/boot.js ready at:', serverSrc);
}

// Stop the previous Node.js server so the next API request starts the NEW
// build (api-proxy.php only launches Node when port 3000 is not answering —
// without this, the old process keeps serving stale code after every push).
// Data is safe: db.json lives in ~/salesvora-data/, outside this checkout.
try {
  const { execSync } = require('child_process');
  // pkill exits 1 when nothing matched, which is the normal case on a first
  // deploy — `|| true` keeps that from being reported as a failure. Anything
  // else (pkill missing, no permission) is worth seeing.
  execSync('pkill -f "dist/boot.js" || true', { stdio: 'ignore' });
  console.log('[deploy] ✓ Old Node.js server stopped — will restart on next request.');
} catch (err) {
  console.log(`[deploy] Note: could not run pkill (${err.message}).`);
  console.log('[deploy]   The previous Node process may still be serving the OLD build.');
  console.log('[deploy]   Fix: SSH in and run  pkill -f dist/boot.js');
}

// Verify what actually landed. Without this the script reports success even
// when the docroot is in a state the web server will refuse to serve.
let ok = true;
const indexPath = path.join(dest, 'index.html');
const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);

if (fs.existsSync(indexPath)) {
  console.log(`[deploy] ✓ index.html present (mode ${mode(indexPath)})`);
} else {
  ok = false;
  console.error('[deploy] ✗ index.html is MISSING from public_html.');
  console.error('[deploy]   The site will answer "403 Forbidden" until it exists.');
}

// index.html landing is not enough to call a deploy good — the site can serve
// its HTML perfectly while every API call 404s. Check the proxy too.
if (fs.existsSync(phpDest)) {
  console.log(`[deploy] ✓ api-proxy.php present (mode ${mode(phpDest)})`);
} else {
  ok = false;
  console.error('[deploy] ✗ api-proxy.php is MISSING from public_html.');
  console.error('[deploy]   Every /api request will answer 404 until it exists.');
}
console.log(`[deploy] public_html mode: ${mode(dest)}`);

if (ok) {
  console.log('[deploy] ✓ Deployment complete!');
  console.log('[deploy] Site is now accessible at your domain.');
} else {
  console.error('[deploy] ✗ Deployment finished with problems — see above.');
  process.exitCode = 1;
}