// Runs after build on Hostinger — copies static files to public_html/
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const src = path.join(cwd, 'dist/public');

// Detect Hostinger by checking if .builds is in the path
const isHostinger = cwd.includes('.builds');

if (!isHostinger) {
  console.log('[deploy] Local environment detected — skipping copy.');
  process.exit(0);
}

// On Hostinger: .builds/source/ → ../../ = public_html/
const dest = path.resolve(cwd, '../../');

console.log('[deploy] Hostinger detected.');
console.log('[deploy] Copying from:', src);
console.log('[deploy] Copying to:', dest);

if (!fs.existsSync(src)) {
  console.error('[deploy] ERROR: dist/public not found. Build may have failed.');
  process.exit(1);
}

// Copy all static files to public_html/
fs.cpSync(src, dest, { recursive: true, force: true });
console.log('[deploy] ✓ Static files copied to public_html/');

// Create .htaccess for React Router (SPA) + API proxy
const htaccess = `# Salesvora - React SPA + Node.js API
Options -MultiViews
RewriteEngine On

# Serve existing files directly
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# Proxy API calls to Node.js server
RewriteCond %{REQUEST_URI} ^/api/ [OR]
RewriteCond %{REQUEST_URI} ^/trpc/
RewriteRule ^(.*)$ http://localhost:3000/$1 [P,L]

# All other routes → React app
RewriteRule ^ /index.html [L]
`;

fs.writeFileSync(path.join(dest, '.htaccess'), htaccess);
console.log('[deploy] ✓ .htaccess created in public_html/');

// Also copy the server file for Node.js
const serverSrc = path.join(cwd, 'dist/boot.cjs');
if (fs.existsSync(serverSrc)) {
  console.log('[deploy] ✓ dist/boot.cjs ready at:', serverSrc);
}

console.log('[deploy] ✓ Deployment complete!');
console.log('[deploy] Site is now accessible at your domain.');