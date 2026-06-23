<?php
// Salesvora API Proxy — PHP 7.4+ compatible
// Auto-starts Node.js and proxies /api/ requests

error_reporting(0);
ini_set('display_errors', 0);

// Find app directory dynamically
$appDir = null;
$possible = glob('/home/*/domains/*/public_html/.builds/source/repository');
if (!empty($possible)) {
    $appDir = $possible[0];
}

// Check if Node.js is listening on port 3000
function isServerRunning() {
    $sock = @fsockopen('127.0.0.1', 3000, $errno, $errstr, 2);
    if ($sock) { fclose($sock); return true; }
    return false;
}

// Try to start Node.js server
function startServer($appDir) {
    $script  = $appDir . '/dist/boot.cjs';
    $logFile = sys_get_temp_dir() . '/salesvora.log';
    if (!file_exists($script)) return;

    $nodePaths = ['/usr/local/bin/node', '/usr/bin/node', '/opt/node/bin/node', 'node'];
    $node = 'node';
    foreach ($nodePaths as $p) {
        if ($p === 'node' || file_exists($p)) { $node = $p; break; }
    }

    $fns = ['exec', 'shell_exec', 'system', 'passthru', 'proc_open'];
    $available = array_filter($fns, function($f) {
        return function_exists($f) && !in_array($f, array_map('trim', explode(',', ini_get('disable_functions'))));
    });

    if (empty($available)) return;

    $cmd = 'cd ' . escapeshellarg($appDir) . ' && PORT=3000 NODE_ENV=production nohup ' . escapeshellarg($node) . ' dist/boot.cjs >> ' . escapeshellarg($logFile) . ' 2>&1 &';

    $fn = reset($available);
    @$fn($cmd);

    for ($i = 0; $i < 10; $i++) {
        sleep(1);
        if (isServerRunning()) break;
    }
}

if ($appDir && !isServerRunning()) {
    startServer($appDir);
}

if (!isServerRunning()) {
    http_response_code(503);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'API server is starting, please wait a moment and retry.']);
    exit;
}

// Proxy the request
$uri    = $_SERVER['REQUEST_URI'];
$target = 'http://127.0.0.1:3000' . $uri;

$ch = curl_init($target);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $_SERVER['REQUEST_METHOD']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH'])) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
}

$hdrs = [];
foreach (getallheaders() as $k => $v) {
    if (strtolower($k) !== 'host') $hdrs[] = "$k: $v";
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

$headerLen = $info['header_size'];
$respHdrs  = substr($response, 0, $headerLen);
$body      = substr($response, $headerLen);

http_response_code((int)$info['http_code']);

foreach (explode("\r\n", $respHdrs) as $hdr) {
    if (empty($hdr) || strpos($hdr, 'HTTP/') === 0) continue;
    $low = strtolower($hdr);
    if (strpos($low, 'transfer-encoding') === 0 || strpos($low, 'connection') === 0) continue;
    header($hdr, false);
}

echo $body;