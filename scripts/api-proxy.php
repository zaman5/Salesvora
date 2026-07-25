<?php
// Salesvora API Proxy — PHP 7.4+ compatible
// Auto-starts Node.js and proxies /api/ requests

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

/** Every place this domain's deploy checkout could plausibly be. */
function appDirCandidates() {
    $suffix = '/.builds/source/repository';
    $c = [];
    // The proxy is copied into public_html, so the checkout normally sits
    // directly beneath it. Checked first so THIS domain always wins.
    $c[] = __DIR__ . $suffix;
    if (!empty($_SERVER['DOCUMENT_ROOT'])) $c[] = rtrim($_SERVER['DOCUMENT_ROOT'], '/') . $suffix;
    // ...but the proxy may also be served from inside the checkout itself.
    $c[] = __DIR__;
    $c[] = dirname(__DIR__);
    // Sibling domains on the same account, last: these belong to other sites.
    foreach ((glob('/home/*/domains/*/public_html' . $suffix) ?: []) as $p) $c[] = $p;
    return array_values(array_unique($c));
}

/** Path of the note recording the last checkout we successfully booted from. */
function appDirMemoPath() {
    $home = accountHome();
    return $home ? $home . '/salesvora-data/app_dir' : null;
}

/**
 * Locate the deploy checkout for THIS domain.
 *
 * Two bugs lived here. It used to glob and take $possible[0]; PHP sorts glob
 * results, so once a second domain existed on the account the first hit
 * alphabetically won and salesvora.online resolved to pawsphere.io. The fix
 * for that preferred __DIR__ — but it accepted the directory merely because
 * is_dir() was true, without checking a build was in it, and still fell back
 * to $possible[0] otherwise. That is how the proxy came to report
 * app_dir=pawsphere.io with boot_exists=false: a directory it can never start
 * Node from. startServer() then returns immediately, so once the running Node
 * exits nothing can ever bring the API back.
 *
 * A candidate is only accepted if it actually contains dist/boot.js. The
 * winner is remembered outside the checkout, so a deploy that is mid-flight
 * (checkout deleted and not yet re-cloned) still has somewhere to boot from
 * instead of falling back to another site's directory.
 */
function findAppDir() {
    $candidates = appDirCandidates();
    foreach ($candidates as $p) {
        if (file_exists($p . '/dist/boot.js')) {
            $memo = appDirMemoPath();
            if ($memo && is_dir(dirname($memo)) && trim((string)@file_get_contents($memo)) !== $p) {
                @file_put_contents($memo, $p);
            }
            return $p;
        }
    }
    // Nothing has a build right now — reuse the last checkout that did.
    $memo = appDirMemoPath();
    if ($memo && file_exists($memo)) {
        $last = trim((string)@file_get_contents($memo));
        if ($last !== '' && file_exists($last . '/dist/boot.js')) return $last;
    }
    // Truly nothing to run. Return a directory belonging to THIS domain rather
    // than a sibling site's, so the debug output points at the real problem.
    foreach ($candidates as $p) {
        if (is_dir($p)) return $p;
    }
    return null;
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
    // Falling back to the account home keeps this working even when no
    // checkout can be found at all, which is exactly when the data directory
    // (holding the secret, the database and the fallback boot.js) matters most.
    $home = accountHome();
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
    $seed = readCredentialFile($adminFile);
    if ($seed) {
        $envVars .= ' ADMIN_EMAIL=' . escapeshellarg($seed[0]);
        $envVars .= ' ADMIN_PASSWORD=' . escapeshellarg($seed[1]);
    }

    // Password recovery for an account that ALREADY exists. app_admin above
    // only seeds an empty database, so once the superadmin exists with a
    // password that does not work there is otherwise no way back in — not by
    // logging in, and not by seeding. Dropping app_admin_reset ("email:password")
    // rewrites that account's password on the next start. The app deletes the
    // file once applied, so the plaintext does not linger.
    $resetFile = $dataDir . '/app_admin_reset';
    $reset = readCredentialFile($resetFile);
    if ($reset) {
        $envVars .= ' ADMIN_RESET_EMAIL=' . escapeshellarg($reset[0]);
        $envVars .= ' ADMIN_RESET_PASSWORD=' . escapeshellarg($reset[1]);
        $envVars .= ' ADMIN_RESET_FILE=' . escapeshellarg($resetFile);
    }
    return $envVars;
}

/**
 * Parse an "email:password" credential file into [email, password].
 *
 * Splits on the FIRST colon so passwords may contain colons.
 *
 * Both halves are trimmed of surrounding whitespace. Writing the file as
 * "you@example.com: secret" — the way anyone naturally types a pair — used to
 * store the password as " secret", which then never matched anything the user
 * could type into the login form, with no error to explain why. Interior
 * characters are untouched; a bootstrap password whose leading space is
 * meaningful is not a real case, and losing one is far cheaper than an account
 * nobody can ever sign into.
 */
function readCredentialFile($path) {
    if (!file_exists($path)) return null;
    $line = (string)@file_get_contents($path);
    // Strip a UTF-8 BOM: file managers add one invisibly and it becomes part of
    // the email address, so the seeded account can never be logged into.
    $line = preg_replace('/^\xEF\xBB\xBF/', '', $line);
    $line = trim($line, "\r\n \t");
    $sep = strpos($line, ':');
    if ($sep === false) return null;
    $email = trim(substr($line, 0, $sep));
    $pass  = trim(substr($line, $sep + 1));
    if ($email === '' || $pass === '') return null;
    return [$email, $pass];
}

/**
 * Every boot.js this proxy could start, best first.
 *
 * Hostinger DELETES .builds/source/repository once a deploy finishes, so the
 * checkout is not somewhere the server can be relied on to exist: the proxy
 * can only start Node during the brief window between the build and that
 * cleanup. Miss it — because Node crashed later, or was killed — and there is
 * no boot.js left anywhere to restart from, which is a silent one-way trip to
 * a permanently 503 API.
 *
 * The deploy therefore keeps a copy in the data directory, which nothing ever
 * cleans, and that is the fallback here. It works only because boot.js is now
 * a self-contained bundle (see hostinger-deploy.cjs) — the old external-
 * packages shim could not have run from outside the checkout at all.
 *
 * The checkout still wins when it exists: mid-deploy it is the freshest build,
 * and preferring it avoids booting a stale copy.
 */
function bootScriptCandidates() {
    $out = [];
    foreach (appDirCandidates() as $d) $out[] = $d . '/dist/boot.js';
    $home = accountHome();
    if ($home) $out[] = $home . '/salesvora-data/boot.js';
    return array_values(array_unique($out));
}

function findBootScript() {
    foreach (bootScriptCandidates() as $p) {
        if (file_exists($p)) return $p;
    }
    return null;
}

// Try to start Node.js server
function startServer($appDir) {
    $script = findBootScript();
    if ($script === null) return;

    $node = findNode();
    if ($node === null) return;

    // Run from the script's own directory. Every path the app actually needs
    // (db.json, the mail database, the log) is passed as an absolute env var,
    // so this only has to be somewhere that exists.
    $workDir = dirname($script);
    $logFile = logFilePath($appDir);
    $cmd = 'cd ' . escapeshellarg($workDir) . ' && ' . buildEnv($appDir)
         . ' nohup ' . escapeshellarg($node) . ' ' . escapeshellarg($script)
         . ' >> ' . escapeshellarg($logFile) . ' 2>&1 &';

    if (!shellSpawn($cmd, $logFile)) return;

    for ($i = 0; $i < 10; $i++) {
        sleep(1);
        if (isServerRunning()) break;
    }
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
        // Why app_dir resolved where it did. When the API cannot restart, the
        // question is always "which of these does the deploy actually write to,
        // and can PHP see it" — guessing that from a single resolved path is
        // impossible, so show the whole search with what each candidate offers.
        'app_dir_search' => array_map(function ($p) {
            return [
                'path'      => $p,
                'is_dir'    => is_dir($p),
                'readable'  => @is_readable($p),
                'has_build' => file_exists($p . '/dist/boot.js'),
            ];
        }, appDirCandidates()),
        'app_dir_memo'   => ($m = appDirMemoPath()) && file_exists($m)
            ? trim((string)@file_get_contents($m)) : null,
        // Which boot.js a restart would actually use. boot_script === null is
        // the fatal state: Node cannot be started again by any request.
        'boot_script'    => findBootScript(),
        'boot_script_search' => array_map(function ($p) {
            return ['path' => $p, 'exists' => file_exists($p)];
        }, bootScriptCandidates()),
        'script_dir'     => __DIR__,
        'document_root'  => isset($_SERVER['DOCUMENT_ROOT']) ? $_SERVER['DOCUMENT_ROOT'] : null,
        'server_running' => isServerRunning(),
        'node_binary'    => findNode(),
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
