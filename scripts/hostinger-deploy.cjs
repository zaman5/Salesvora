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

// Create .htaccess — routes API calls through PHP proxy (no mod_proxy needed)
const htaccess = `# Salesvora - React SPA + PHP API Proxy
Options -MultiViews
RewriteEngine On

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

fs.writeFileSync(path.join(dest, '.htaccess'), htaccess);
console.log('[deploy] ✓ .htaccess created in public_html/');

// Copy PHP proxy to public_html/
const phpSrc = path.join(cwd, 'scripts/api-proxy.php');
if (fs.existsSync(phpSrc)) {
  fs.copyFileSync(phpSrc, path.join(dest, 'api-proxy.php'));
  console.log('[deploy] ✓ api-proxy.php copied to public_html/');
}

// Also copy the server file for Node.js
const serverSrc = path.join(cwd, 'dist/boot.js');
if (fs.existsSync(serverSrc)) {
  console.log('[deploy] ✓ dist/boot.js ready at:', serverSrc);
}

console.log('[deploy] ✓ Deployment complete!');
console.log('[deploy] Site is now accessible at your domain.');