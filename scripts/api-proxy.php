<?php
// Salesvora API Proxy — PHP 7.4+ compatible
//
// This file does ONE job: forward /api traffic to the Node server on
// 127.0.0.1:3000. LiteSpeed owns port 443 and there is no way to point a
// vhost at a Node process on this plan, so something has to bridge the two,
// and PHP is what the host will run for us.
//
// It used to do a second job — find the build, construct the server's
// environment and spawn the process — and that is where essentially every
// outage came from: the checkout locator silently resolved to a different
// domain on the same account, the spawn was called with the wrong signature
// for the one shell function the host leaves enabled, and each of those
// surfaced identically as an unexplained 503. That logic now lives in
// scripts/keepalive.cjs, run by cron every minute: ordinary JavaScript that
// can be read, tested and executed by hand. All this file still knows about
// process management is how to ask the supervisor to run early, so a request
// arriving while Node is down does not have to wait out the cron minute.
//
// See README/deploy notes for the crontab line.

error_reporting(E_ALL);
ini_set('display_errors', 0);

const NODE_PORT = 3000;
const LOG_FILE  = '/salesvora.log';

/** Home directory of the account, independent of any checkout location. */
function accountHome() {
    $home = getenv('HOME');
    if (!$home && function_exists('posix_getpwuid')) {
        $pw = @posix_getpwuid(@posix_geteuid());
        if (!empty($pw['dir'])) $home = $pw['dir'];
    }
    if (!$home && preg_match('#^(/home/[^/]+)/#', __DIR__, $m)) $home = $m[1];
    return $home ?: null;
}

/** Where persistent data lives — outside the checkout, which every push wipes. */
function dataDir() {
    $home = accountHome();
    return $home ? $home . '/salesvora-data' : null;
}

function logFilePath() {
    $dir = dataDir();
    return ($dir && is_dir($dir)) ? $dir . LOG_FILE : sys_get_temp_dir() . LOG_FILE;
}

/** The cron supervisor. Mirrored into the data dir by hostinger-deploy.cjs. */
function supervisorPath() {
    $dir = dataDir();
    return $dir ? $dir . '/keepalive.cjs' : null;
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
 * proc_open takes (cmd, descriptors, &$pipes) — calling it like shell_exec
 * does nothing at all, silently. On this account proc_open is the ONLY one of
 * the three left enabled, so getting that signature wrong meant nothing ever
 * ran and there was no error to show for it.
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
        proc_close($proc);
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
    $home = accountHome();
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

// Check if Node.js is listening on the app port
function isServerRunning() {
    $sock = @fsockopen('127.0.0.1', NODE_PORT, $errno, $errstr, 2);
    if ($sock) { fclose($sock); return true; }
    return false;
}

/**
 * Ask the supervisor to start Node now rather than at the next cron tick.
 *
 * Cron already guarantees the server comes back within a minute; this only
 * shortens the wait for a request that happens to arrive during that window.
 * Everything about HOW to start — which bundle, which environment, which log —
 * belongs to keepalive.cjs and is deliberately not duplicated here.
 */
function triggerSupervisor() {
    $supervisor = supervisorPath();
    if (!$supervisor || !file_exists($supervisor)) return false;

    $node = findNode();
    if ($node === null) return false;

    $logFile = logFilePath();
    $cmd = 'nohup ' . escapeshellarg($node) . ' ' . escapeshellarg($supervisor)
         . ' >> ' . escapeshellarg($logFile) . ' 2>&1 &';
    if (!shellSpawn($cmd, $logFile)) return false;

    for ($i = 0; $i < 10; $i++) {
        sleep(1);
        if (isServerRunning()) return true;
    }
    return false;
}

// Who can actually log in. Returns the account count plus each account's email
// and role, or an error string when db.json is missing/unreadable/corrupt.
// Deliberately never touches the password or sipCredentials fields.
function dbAccountSummary($dbPath) {
    if (!$dbPath || !file_exists($dbPath)) return ['error' => 'db.json not found'];
    $raw = @file_get_contents($dbPath);
    if ($raw === false) return ['error' => 'db.json unreadable'];
    $data = json_decode($raw, true);
    if (!is_array($data)) return ['error' => 'db.json is not valid JSON'];
    $users = isset($data['users']) && is_array($data['users']) ? $data['users'] : [];
    return [
        'count'    => count($users),
        'accounts' => array_values(array_map(function ($u) {
            return [
                'email'  => isset($u['email'])  ? $u['email']  : null,
                'role'   => isset($u['role'])   ? $u['role']   : null,
                'status' => isset($u['status']) ? $u['status'] : null,
            ];
        }, $users)),
    ];
}

// Debug endpoint — visit /api-proxy.php?debug=1 to diagnose
if (isset($_GET['debug'])) {
    header('Content-Type: application/json');
    $dataDir = dataDir();
    $logFile = logFilePath();
    $dbPath  = $dataDir ? $dataDir . '/db.json' : null;
    $mailDb  = $dataDir ? $dataDir . '/mailsender.db' : null;
    $supervisor = supervisorPath();
    $node = findNode();

    // Ask the supervisor what IT sees. It owns build discovery now, so its
    // answer is the authoritative one — a second implementation here could
    // disagree with the thing actually starting the server, which is how the
    // old proxy came to report a checkout it could never boot from.
    $supervisorStatus = null;
    if ($node && $supervisor && file_exists($supervisor)) {
        $raw = shellCapture(escapeshellarg($node) . ' ' . escapeshellarg($supervisor) . ' --status');
        $decoded = json_decode(trim($raw), true);
        $supervisorStatus = is_array($decoded) ? $decoded : trim($raw);
    }

    echo json_encode([
        'php_version'    => PHP_VERSION,
        'curl_available' => function_exists('curl_init'),
        'exec_available' => availableShellFns(),
        'script_dir'     => __DIR__,
        'document_root'  => isset($_SERVER['DOCUMENT_ROOT']) ? $_SERVER['DOCUMENT_ROOT'] : null,
        'server_running' => isServerRunning(),
        'node_binary'    => $node,
        // The supervisor and what it reports. supervisor_installed=false means
        // cron has nothing to run and the API cannot restart itself; a
        // boot_script of null inside supervisor_status is the same fatal state.
        'supervisor_path'      => $supervisor,
        'supervisor_installed' => $supervisor ? file_exists($supervisor) : false,
        'supervisor_status'    => $supervisorStatus,
        // Persistent databases — must live OUTSIDE the deploy folder to survive pushes
        'data_dir'             => $dataDir,
        'data_dir_exists'      => $dataDir ? is_dir($dataDir) : false,
        'db_persistent_path'   => $dbPath,
        'db_persistent_exists' => $dbPath ? file_exists($dbPath) : false,
        'db_size_bytes'        => ($dbPath && file_exists($dbPath)) ? filesize($dbPath) : 0,
        'mail_db_persistent_exists' => $mailDb ? file_exists($mailDb) : false,
        // Everything in the data dir with sizes and mtimes. When db.json comes
        // back missing this is what says whether a .bak or an older copy
        // survived and is worth restoring, or whether the directory really was
        // emptied. Names and sizes only — no contents are exposed.
        'data_dir_files' => $dataDir && is_dir($dataDir)
            ? array_values(array_map(function ($f) use ($dataDir) {
                return [
                    'name'  => basename($f),
                    'bytes' => filesize($f),
                    'mtime' => date('c', filemtime($f)),
                ];
              }, array_filter(glob($dataDir . '/*') ?: [], 'is_file')))
            : [],
        // Account census. A db.json that exists and parses but holds ZERO users
        // is the state a lost data directory leaves behind, and it is invisible
        // from outside: every login just answers "invalid email or password",
        // exactly like a typo. Reporting the count (and the bootstrap file's
        // presence) turns "nobody can log in" into a one-request diagnosis.
        // Emails and roles only — password digests are never exposed.
        'db_accounts'      => dbAccountSummary($dbPath),
        'admin_seed_file'  => $dataDir ? file_exists($dataDir . '/app_admin') : false,
        // Present means a password reset is pending; it clears itself once the
        // app applies it, so a value still showing true after a restart means
        // the reset did not run (check log_tail).
        'admin_reset_file' => $dataDir ? file_exists($dataDir . '/app_admin_reset') : false,
        // Tail of the Node log — the only view into a boot that fails on start.
        'log_path' => $logFile,
        'log_tail' => file_exists($logFile)
            ? implode("\n", array_slice(explode("\n", (string)@file_get_contents($logFile)), -25))
            : null,
    ], JSON_PRETTY_PRINT);
    exit;
}

if (!isServerRunning()) {
    triggerSupervisor();
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

// Forward the client's headers, minus the ones that describe the hop.
//
// Host is dropped because curl sets its own (127.0.0.1:3000). That rewriting is
// what broke Mail Sender: its CSRF guard compares the browser's Origin against
// the Host the request arrived on, and behind this proxy those are
// "salesvora.online" and "127.0.0.1:3000" — never equal, so every POST/PUT/
// DELETE to /api/mail answered 403.
//
// The X-Forwarded-* headers below carry the original values instead. They are
// STRIPPED from the incoming request first and then set here, so a client
// cannot supply its own and talk the app into trusting a host it never saw —
// without that, forwarding them would hand over the very CSRF bypass the guard
// exists to prevent.
$dropped = ['host', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for'];
$hdrs = [];
foreach (getallheaders() as $k => $v) {
    if (!in_array(strtolower($k), $dropped, true)) $hdrs[] = "$k: $v";
}
if (!empty($_SERVER['HTTP_HOST'])) {
    $hdrs[] = 'X-Forwarded-Host: ' . $_SERVER['HTTP_HOST'];
}
$https = !empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off';
$hdrs[] = 'X-Forwarded-Proto: ' . ($https ? 'https' : 'http');
if (!empty($_SERVER['REMOTE_ADDR'])) {
    $hdrs[] = 'X-Forwarded-For: ' . $_SERVER['REMOTE_ADDR'];
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
