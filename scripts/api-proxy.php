<?php
// Salesvora API Proxy — auto-starts Node.js and proxies /api/ requests

// Find app directory dynamically
$appDir = null;
$possible = glob('/home/*/domains/*/public_html/.builds/source/repository');
if (!empty($possible)) {
    $appDir = $possible[0];
}

// Check if Node.js server is listening on port 3000
function isServerRunning() {
    $sock = @fsockopen('127.0.0.1', 3000, $errno, $errstr, 2);
    if ($sock) { fclose($sock); return true; }
    return false;
}

// Start Node.js server if not running
if ($appDir && !isServerRunning()) {
    $script  = $appDir . '/dist/boot.cjs';
    $logFile = sys_get_temp_dir() . '/salesvora.log';

    if (file_exists($script)) {
        // Try different node paths common on Hostinger
        $nodePaths = [
            '/usr/local/bin/node',
            '/usr/bin/node',
            '/opt/node/bin/node',
        ];
        $node = 'node';
        foreach ($nodePaths as $p) {
            if (file_exists($p)) { $node = $p; break; }
        }

        $cmd = sprintf(
            'cd %s && nohup %s dist/boot.cjs >> %s 2>&1 & echo $!',
            escapeshellarg($appDir),
            escapeshellarg($node),
            escapeshellarg($logFile)
        );
        exec($cmd);

        // Wait up to 8 seconds for server to start
        for ($i = 0; $i < 8; $i++) {
            sleep(1);
            if (isServerRunning()) break;
        }
    }
}

// If server still not running, return error
if (!isServerRunning()) {
    http_response_code(503);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'API server starting — please retry in a few seconds']);
    exit;
}

// Proxy request to Node.js
$uri    = $_SERVER['REQUEST_URI'];
$target = 'http://127.0.0.1:3000' . $uri;

$ch = curl_init($target);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $_SERVER['REQUEST_METHOD']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

// Forward request body
if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH'])) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
}

// Forward headers
$hdrs = [];
foreach (getallheaders() as $k => $v) {
    $low = strtolower($k);
    if ($low !== 'host') $hdrs[] = "$k: $v";
}
curl_setopt($ch, CURLOPT_HTTPHEADER, $hdrs);

$response  = curl_exec($ch);
$info      = curl_getinfo($ch);
$curlError = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(503);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Proxy error', 'detail' => $curlError]);
    exit;
}

// Split headers and body
$headerLen = $info['header_size'];
$respHdrs  = substr($response, 0, $headerLen);
$body      = substr($response, $headerLen);

http_response_code($info['http_code']);

// Forward response headers
foreach (explode("\r\n", $respHdrs) as $hdr) {
    if (empty($hdr) || str_starts_with($hdr, 'HTTP/')) continue;
    $low = strtolower($hdr);
    if (str_starts_with($low, 'transfer-encoding') || str_starts_with($low, 'connection')) continue;
    header($hdr);
}

echo $body;