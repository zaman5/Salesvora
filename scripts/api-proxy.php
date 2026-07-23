<?php
// Salesvora API Proxy — PHP 7.4+ compatible
// Auto-starts Node.js and proxies /api/ requests

error_reporting(E_ALL);
ini_set('display_errors', 0);

// Debug endpoint — visit /api-proxy.php?debug=1 to diagnose
if (isset($_GET['debug'])) {
    header('Content-Type: application/json');
    $possible = glob('/home/*/domains/*/public_html/.builds/source/repository');
    $appDir2  = !empty($possible) ? $possible[0] : null;
    $fns      = ['exec','shell_exec','system','passthru','proc_open'];
    $disabled = array_map('trim', explode(',', ini_get('disable_functions')));
    $avail    = array_filter($fns, function($f) use ($disabled) {
        return function_exists($f) && !in_array($f, $disabled);
    });
    $dbPath = null;
    $mailDbPath = null;
    if ($appDir2 && preg_match('#^(/home/[^/]+)/#', $appDir2, $m2)) {
        $dbPath = $m2[1] . '/salesvora-data/db.json';
        $mailDbPath = $m2[1] . '/salesvora-data/mailsender.db';
    }
    echo json_encode([
        'php_version'    => PHP_VERSION,
        'curl_available' => function_exists('curl_init'),
        'exec_available' => array_values($avail),
        'disabled_fns'   => $disabled,
        'app_dir'        => $appDir2,
        'boot_exists'    => $appDir2 ? file_exists($appDir2 . '/dist/boot.js') : false,
        'server_running' => isServerRunning(),
        'node_paths'     => array_filter(['/usr/local/bin/node','/usr/bin/node','/opt/node/bin/node'], 'file_exists'),
        // Persistent databases — must live OUTSIDE the deploy folder to survive pushes
        'db_persistent_path'   => $dbPath,
        'db_persistent_exists' => $dbPath ? file_exists($dbPath) : false,
        'db_size_bytes'        => ($dbPath && file_exists($dbPath)) ? filesize($dbPath) : 0,
        'mail_db_persistent_path'   => $mailDbPath,
        'mail_db_persistent_exists' => $mailDbPath ? file_exists($mailDbPath) : false,
        'mail_db_size_bytes'        => ($mailDbPath && file_exists($mailDbPath)) ? filesize($mailDbPath) : 0,
    ], JSON_PRETTY_PRINT);
    exit;
}

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
    $script  = $appDir . '/dist/boot.js';
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

    // Pin the database to a path deployments never touch. $appDir looks like
    // /home/<user>/domains/<domain>/public_html/.builds/source/repository —
    // that whole tree is replaced on every git push, so db.json must live in
    // /home/<user>/salesvora-data/ instead or all data is lost on deploy.
    $envVars = 'PORT=3000 NODE_ENV=production';
    if (preg_match('#^(/home/[^/]+)/#', $appDir, $m)) {
        $dataDir = $m[1] . '/salesvora-data';
        if (!is_dir($dataDir)) @mkdir($dataDir, 0755, true);
        $envVars .= ' DB_JSON_PATH=' . escapeshellarg($dataDir . '/db.json');
        // Mail Sender's SQLite file must live here too — this whole checkout
        // is replaced on every git push, so anywhere inside it loses data on deploy.
        $envVars .= ' MAIL_DB_PATH=' . escapeshellarg($dataDir . '/mailsender.db');
    }

    $cmd = 'cd ' . escapeshellarg($appDir) . ' && ' . $envVars . ' nohup ' . escapeshellarg($node) . ' dist/boot.js >> ' . escapeshellarg($logFile) . ' 2>&1 &';

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