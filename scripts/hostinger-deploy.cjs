// Runs after build on Hostinger — copies static files to public_html/
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const src = path.join(cwd, 'dist/public');

// Detect Hostinger by checking if public_html is in the path
const isHostinger = cwd.includes('public_html');

if (!isHostinger) {
  console.log('[deploy] Local environment detected — skipping copy.');
  process.exit(0);
}

// Find public_html directory dynamically regardless of subdirectory depth
const parts = cwd.split('/');
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

// Copy all static files to public_html/
fs.cpSync(src, dest, { recursive: true, force: true });
console.log('[deploy] ✓ Static files copied to public_html/');

// Create .htaccess for React Router (SPA) + API proxy
const htaccess = `# Salesvora - React SPA + Node.js API
Options -MultiViews
RewriteEngine On

# Serve existing static files directly
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# Proxy API and tRPC calls to Node.js server on port 3000
RewriteCond %{REQUEST_URI} ^/api [NC,OR]
RewriteCond %{REQUEST_URI} ^/health [NC]
RewriteRule ^(.*)$ http://127.0.0.1:3000/$1 [P,L,QSA]

# All other routes → React SPA
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