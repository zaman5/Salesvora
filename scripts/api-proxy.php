<?php
// Salesvora API Proxy — PHP 7.4+ compatible
// Auto-starts Node.js and proxies /api/ requests

error_reporting(E_ALL);
ini_set('display_errors', 0);

const NODE_PORT = 3000;
const LOG_FILE  = '/salesvora.log';

/**
 * Locate the deploy checkout for THIS domain.
 *
 * This used to glob('/home/*\/domains/*\/public_html/.builds/source/repository')
 * and take $possible[0]. PHP sorts glob results, so as soon as a second domain
 * was added to the hosting account the first hit alphabetically won — the proxy
 * on salesvora.online resolved to pawsphere.io's checkout, found no dist/boot.js
 * there and never started Node, so every /api call failed. This file is copied
 * into public_html, so __DIR__ is already the right docroot; derive from that
 * and only fall back to the glob if the checkout is somewhere unexpected.
 */
function findAppDir() {
    $suffix = '/.builds/source/repository';
    $roots  = [__DIR__];
    if (!empty($_SERVER['DOCUMENT_ROOT'])) $roots[] = rtrim($_SERVER['DOCUMENT_ROOT'], '/');
    foreach ($roots as $root) {
        if (is_dir($root . $suffix)) return $root . $suffix;
    }
    // Last resort: prefer a match that actually has a build in it.
    $possible = glob('/home/*/domains/*/public_html' . $suffix) ?: [];
    foreach ($possible as $p) {
        if (file_exists($p . '/dist/boot.js')) return $p;
    }
    return !empty($possible) ? $possible[0] : null;
}

/** Shell functions this host actually allows us to call. */
function availableShellFns() {
    $disabled = array_map('trim', explode(',', (string)ini_get('disable_functions')));
    return array_values(array_filter(['exec', 'shell_exec', 'proc_open'], function ($f) use ($disabled) {
        return function_exists($f) && !in_array($f, $disabled, true);
    }));
}

/**
 * Run a command and return its stdout.
 *
 * proc_open takes (cmd, descriptors, &$pipes) — the old code called whichever
 * function it found as `$fn($cmd)`, which is only correct for exec/shell_exec.
 * On a host where proc_open is the ONLY one left enabled (which is the case on
 * this account) that call silently did nothing and Node was never launched.
 */
function shellCapture($cmd) {
    $fns = availableShellFns();
    if (in_array('shell_exec', $fns, true)) {
        return (string)@shell_exec($cmd . ' 2>/dev/null');
    }
    if (in_array('exec', $fns, true)) {
        $out = [];
        @exec($cmd . ' 2>/dev/null', $out);
        return implode("\n", $out);
    }
    if (in_array('proc_open', $fns, true)) {
        $desc = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $pipes = [];
        $proc = @proc_open($cmd, $desc, $pipes);
        if (!is_resource($proc)) return '';
        fclose($pipes[0]);
        $out = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);
        return (string)$out;
    }
    return '';
}

/** Launch a detached background command. Returns true if it could be issued. */
function shellSpawn($cmd, $logFile) {
    $fns = availableShellFns();
    if (in_array('shell_exec', $fns, true)) { @shell_exec($cmd); return true; }
    if (in_array('exec', $fns, true))       { @exec($cmd);       return true; }
    if (in_array('proc_open', $fns, true)) {
        // stdin from /dev/null, stdout+stderr appended to the log, so the child
        // holds no pipe to this PHP request and survives it exiting.
        $desc = [
            0 => ['file', '/dev/null', 'r'],
            1 => ['file', $logFile, 'a'],
            2 => ['file', $logFile, 'a'],
        ];
        $pipes = [];
        $proc = @proc_open($cmd, $desc, $pipes);
        if (!is_resource($proc)) return false;
        proc_close($proc); // the wrapping sh backgrounds Node and exits at once
        return true;
    }
    return false;
}

/**
 * Find the node binary. The fixed /usr/bin, /usr/local/bin, /opt/node list
 * matched nothing on this host, and bare "node" depends on a PATH that the
 * non-login shell behind proc_open does not necessarily have. Search the
 * layouts Hostinger actually uses, then ask the shell.
 */
function findNode() {
    $candidates = ['/usr/local/bin/node', '/usr/bin/node', '/opt/node/bin/node'];
    // CloudLinux alt-node (Hostinger's usual layout) and per-user nvm installs.
    foreach (['/opt/alt/alt-nodejs*/root/usr/bin/node', '/opt/cpanel/ea-nodejs*/bin/node'] as $g) {
        foreach ((glob($g) ?: []) as $hit) $candidates[] = $hit;
    }
    $home = getenv('HOME');
    if (!$home && function_exists('posix_getpwuid')) {
        $pw = @posix_getpwuid(@posix_geteuid());
        if (!empty($pw['dir'])) $home = $pw['dir'];
    }
    if ($home) {
        foreach ((glob($home . '/.nvm/versions/node/*/bin/node') ?: []) as $hit) $candidates[] = $hit;
        $candidates[] = $home . '/bin/node';
    }
    // Newest first, natural order so alt-nodejs20 beats alt-nodejs9 — plain
    // rsort compares "9" > "2" and would hand back a Node the app cannot run on.
    usort($candidates, function ($a, $b) { return strnatcmp($b, $a); });
    foreach ($candidates as $p) {
        if (@is_executable($p)) return $p;
    }
    $found = trim(shellCapture('command -v node || which node'));
    if ($found !== '') {
        $lines = array_filter(array_map('trim', explode("\n", $found)));
        foreach ($lines as $line) {
            if ($line !== '' && @is_executable($line)) return $line;
        }
    }
    return null;
}

/** Where persistent data lives — outside the checkout, which every push wipes. */
function dataDir($appDir) {
    if ($appDir && preg_match('#^(/home/[^/]+)/#', $appDir, $m)) return $m[1] . '/salesvora-data';
    $home = getenv('HOME');
    return $home ? $home . '/salesvora-data' : null;
}

function logFilePath($appDir) {
    $dir = dataDir($appDir);
    return ($dir && is_dir($dir)) ? $dir . LOG_FILE : sys_get_temp_dir() . LOG_FILE;
}

// Check if Node.js is listening on the app port
function isServerRunning() {
    $sock = @fsockopen('127.0.0.1', NODE_PORT, $errno, $errstr, 2);
    if ($sock) { fclose($sock); return true; }
    return false;
}

// Build the environment the Node process needs, creating the data dir and
// generating the signing secret on first run.
function buildEnv($appDir) {
    $envVars = 'PORT=' . NODE_PORT . ' NODE_ENV=production';
    $dataDir = dataDir($appDir);
    if (!$dataDir) return $envVars;

    if (!is_dir($dataDir)) @mkdir($dataDir, 0755, true);
    // db.json and Mail Sender's SQLite file must live here: the checkout is
    // replaced on every git push, so anywhere inside it loses data on deploy.
    $envVars .= ' DB_JSON_PATH=' . escapeshellarg($dataDir . '/db.json');
    $envVars .= ' MAIL_DB_PATH=' . escapeshellarg($dataDir . '/mailsender.db');

    // APP_SECRET signs session tokens. The app refuses to boot in production
    // without one (a known default key is forgeable). Rather than commit a
    // secret to the repo, generate a strong random one on first run and persist
    // it here, OUTSIDE the deploy checkout and the web root, so it survives
    // every git push and stays private.
    $secretFile = $dataDir . '/app_secret';
    if (!file_exists($secretFile)) {
        file_put_contents($secretFile, bin2hex(random_bytes(32))); // 256-bit
        @chmod($secretFile, 0600);
    }
    $appSecret = trim((string)@file_get_contents($secretFile));
    if ($appSecret !== '') $envVars .= ' APP_SECRET=' . escapeshellarg($appSecret);

    // Optional bootstrap admin: if the operator drops an app_admin file
    // ("email:password" on one line) into the data dir, pass it through so a
    // fresh db.json can seed the first superadmin. Ignored once db.json exists.
    $adminFile = $dataDir . '/app_admin';
    if (file_exists($adminFile)) {
        $adminLine = trim((string)@file_get_contents($adminFile));
        $sep = strpos($adminLine, ':');
        if ($sep !== false) {
            $adminEmail = substr($adminLine, 0, $sep);
            $adminPass  = substr($adminLine, $sep + 1);
            if ($adminEmail !== '' && $adminPass !== '') {
                $envVars .= ' ADMIN_EMAIL=' . escapeshellarg($adminEmail);
                $envVars .= ' ADMIN_PASSWORD=' . escapeshellarg($adminPass);
            }
        }
    }
    return $envVars;
}

// Try to start Node.js server
function startServer($appDir) {
    $script = $appDir . '/dist/boot.js';
    if (!file_exists($script)) return;

    $node = findNode();
    if ($node === null) return;

    $logFile = logFilePath($appDir);
    $cmd = 'cd ' . escapeshellarg($appDir) . ' && ' . buildEnv($appDir)
         . ' nohup ' . escapeshellarg($node) . ' dist/boot.js >> ' . escapeshellarg($logFile) . ' 2>&1 &';

    if (!shellSpawn($cmd, $logFile)) return;

    for ($i = 0; $i < 10; $i++) {
        sleep(1);
        if (isServerRunning()) break;
    }
}

$appDir = findAppDir();

// Debug endpoint — visit /api-proxy.php?debug=1 to diagnose
if (isset($_GET['debug'])) {
    header('Content-Type: application/json');
    $dataDir = dataDir($appDir);
    $logFile = logFilePath($appDir);
    $dbPath  = $dataDir ? $dataDir . '/db.json' : null;
    $mailDb  = $dataDir ? $dataDir . '/mailsender.db' : null;
    echo json_encode([
        'php_version'    => PHP_VERSION,
        'curl_available' => function_exists('curl_init'),
        'exec_available' => availableShellFns(),
        'app_dir'        => $appDir,
        'boot_exists'    => $appDir ? file_exists($appDir . '/dist/boot.js') : false,
        'server_running' => isServerRunning(),
        'node_binary'    => findNode(),
        // Persistent databases — must live OUTSIDE the deploy folder to survive pushes
        'data_dir'             => $dataDir,
        'data_dir_exists'      => $dataDir ? is_dir($dataDir) : false,
        'db_persistent_path'   => $dbPath,
        'db_persistent_exists' => $dbPath ? file_exists($dbPath) : false,
        'db_size_bytes'        => ($dbPath && file_exists($dbPath)) ? filesize($dbPath) : 0,
        'mail_db_persistent_exists' => $mailDb ? file_exists($mailDb) : false,
        // Tail of the Node log — the only view into a boot that fails on start.
        'log_path' => $logFile,
        'log_tail' => file_exists($logFile)
            ? implode("\n", array_slice(explode("\n", (string)@file_get_contents($logFile)), -25))
            : null,
    ], JSON_PRETTY_PRINT);
    exit;
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
$target = 'http://127.0.0.1:' . NODE_PORT . $uri;

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
