// Minimal test server — no npm packages needed
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000');

console.log('[server] Starting on port ' + PORT);
console.log('[server] Working directory: ' + process.cwd());
console.log('[server] Node version: ' + process.version);

const server = http.createServer(function(req, res) {
  console.log('[server] Request: ' + req.method + ' ' + req.url);

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', port: PORT, node: process.version }));
    return;
  }

  // Serve index.html for everything else
  const indexPath = path.join(process.cwd(), 'dist', 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(indexPath));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Salesvora server is running on port ' + PORT);
});

server.on('error', function(err) {
  console.error('[server] Error: ' + err.message);
});

server.listen(PORT, function() {
  console.log('[server] Ready! http://localhost:' + PORT);
});