<?php
// server.php — PHP FAAS clone + Memcache-backed async queue (single-file; no extra workers)
// Notes:
// - Queue key (qid): q_<hash4>_<run>
//   * hash4 = first 4 hex of md5(ticket.description) — strictly the "description" string
//   * run   = incrementing integer per hash4
// - If no valid description string exists, default qid: "q_1234_1"
// - /run enqueues and spawns a background worker within THIS file: `php server.php process <qid> &`
// - /status returns the full memcache dump (all queue items) as a single object
// - Queue state lifecycle: idle → generating → complete
// - Errors are captured and propagated via the `errors` array on each queue item.
// - FIXES:
//   * Any request containing a qid: ensure the queue item exists; if it exists, update it “as it’s going”.
//   * If not existent, create with sane defaults.
//   * The lifecycle ends on disk write: when a task writes a file, mark that qid as complete in Memcache.
//   * /q_run now uses provided qid (if valid) and guarantees the lifecycle transitions with memcache updates.

ini_set('memory_limit', '-1');
ini_set('max_execution_time', 0);

// CORS/headers (kept simple; router returns JSON by default)
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Content-Type: application/json');

$logfile = "/tmp/q_chrome_extension.log";

// ---------- Logging ----------
function qlog($label, $data = null) {
    global $logfile;
    $ts = date('Y-m-d H:i:s');
    $dataStr = (is_array($data) || is_object($data)) ? json_encode($data, JSON_PRETTY_PRINT) : (string)$data;
    @file_put_contents($logfile, "[$ts] [$label]\n$dataStr\n\n", FILE_APPEND);
    error_log("[$label] $dataStr");
}

// ---------- Shell sanitization ----------
function sanitize_shell_input($input) {
    // be conservative; remove most shell metacharacters
    return str_replace(['\\', '\'', '"', '$', '&', '!', '`', ';', '|', '>', '<', '(', ')'], '', (string)$input);
}

// ---------- Memcache client ----------
function getCache() {
    static $cache = null;
    if ($cache) return $cache;

    if (class_exists('Memcached')) {
        $m = new Memcached();
        $m->addServer('127.0.0.1', 11211);
        $cache = $m;
        return $cache;
    }
    if (class_exists('Memcache')) {
        $m = new Memcache();
        @$m->connect('127.0.0.1', 11211);
        $cache = $m;
        return $cache;
    }

    http_response_code(500);
    $err = ['error' => 'Memcache(d) extension not found. Install php-memcached or php-memcache and run memcached on 127.0.0.1:11211'];
    qlog('ERROR', $err);
    echo json_encode($err);
    exit;
}

function cache_get($key) {
    $c = getCache();
    return $c->get($key);
}
function cache_set($key, $val, $ttl = 0) {
    $c = getCache();
    if ($c instanceof Memcached) return $c->set($key, $val, $ttl);
    return $c->set($key, $val, 0, $ttl);
}
function cache_add($key, $val, $ttl = 0) {
    $c = getCache();
    if ($c instanceof Memcached) return $c->add($key, $val, $ttl);
    return $c->add($key, $val, 0, $ttl);
}
function cache_delete($key) {
    $c = getCache();
    return $c->delete($key);
}

// ---------- Queue indexing ----------
const Q_INDEX         = 'q:index';     // JSON array of all qids
const Q_RUNCTR_PREFIX = 'q:ctr:';      // per-ticket counter (by hash4)
const Q_ITEM_PREFIX   = 'q:item:';     // queue item payload

function q_index_add($qid) {
    $idx = cache_get(Q_INDEX);
    $arr = is_array($idx) ? $idx : [];
    if (!in_array($qid, $arr, true)) {
        $arr[] = $qid;
        cache_set(Q_INDEX, $arr);
    }
}

function q_index_all() {
    $idx = cache_get(Q_INDEX);
    return is_array($idx) ? $idx : [];
}

function md5_first4_of_description($raw) {
    // Parse JSON; use the "description" string of the ticket.
    // Shapes supported:
    //   A) { "description": "..." }
    //   B) { "tickets": { "<id>": { "description": "..." } }, "title": "<id>" }
    $desc = null;

    $json = json_decode($raw, true);
    if (is_array($json)) {
        if (isset($json['description']) && is_string($json['description']) && $json['description'] !== '') {
            $desc = $json['description'];
        } else {
            $title = isset($json['title']) && is_string($json['title']) ? $json['title'] : null;
            if ($title && isset($json['tickets']) && is_array($json['tickets']) && isset($json['tickets'][$title])) {
                $ticket = $json['tickets'][$title];
                if (isset($ticket['description']) && is_string($ticket['description']) && $ticket['description'] !== '') {
                    $desc = $ticket['description'];
                }
            } else {
                if (isset($json['tickets']) && is_array($json['tickets'])) {
                    foreach ($json['tickets'] as $t) {
                        if (isset($t['description']) && is_string($t['description']) && $t['description'] !== '') {
                            $desc = $t['description'];
                            break;
                        }
                    }
                }
            }
        }
    }

    if (!is_string($desc) || $desc === '') {
        return null; // signal "no valid description"
    }

    $h = md5($desc);
    return substr($h, 0, 4);
}

function next_run_for_hash4($hash4) {
    $ctrKey = Q_RUNCTR_PREFIX . $hash4;
    $cur = cache_get($ctrKey);
    if (!is_numeric($cur)) $cur = 0;
    $cur = intval($cur) + 1;
    cache_set($ctrKey, $cur);
    return $cur;
}

function parse_qid_or_default($clientQid, $raw) {
    if (is_string($clientQid) && preg_match('/^q_[a-f0-9]{4}_[0-9]+$/i', $clientQid)) {
        return strtolower($clientQid);
    }
    $hash4 = md5_first4_of_description($raw);
    if ($hash4 && preg_match('/^[a-f0-9]{4}$/i', $hash4)) {
        $run = next_run_for_hash4(strtolower($hash4));
        return "q_" . strtolower($hash4) . "_{$run}";
    }
    return "q_1234_1";
}

function create_queue_item($qid, $raw) {
    $now = time();
    $item = [
        'qid'          => $qid,
        'created_at'   => $now,
        'updated_at'   => $now,
        'queue_status' => 'idle',
        'retry_count'  => 0,
        'result'       => null,
        'errors'       => [],
        'state'        => null,
        'raw'          => $raw
    ];
    cache_set(Q_ITEM_PREFIX . $qid, $item);
    q_index_add($qid);
    return $item;
}

function update_queue_item($qid, $patch) {
    $key = Q_ITEM_PREFIX . $qid;
    $item = cache_get($key);
    if (!is_array($item)) $item = ['qid' => $qid];
    foreach ($patch as $k => $v) $item[$k] = $v;
    $item['updated_at'] = time();
    cache_set($key, $item);
    return $item;
}

// Ensure a queue item exists; create if missing. Optionally set initial patch.
function ensure_queue_item($qid, $raw = '', $patch = []) {
    $key = Q_ITEM_PREFIX . $qid;
    $existing = cache_get($key);
    if (!is_array($existing)) {
        $existing = create_queue_item($qid, $raw);
    }
    if (!empty($patch)) {
        $existing = update_queue_item($qid, $patch);
    }
    return $existing;
}

// ---------- Worker runner (CLI mode inside this file) ----------
function run_worker_for_qid($qid) {
    qlog('WORKER START', $qid);
    ensure_queue_item($qid, '', ['queue_status' => 'generating']);

    $key  = Q_ITEM_PREFIX . $qid;
    $item = cache_get($key);
    if (!is_array($item)) {
        qlog('WORKER ABORT', "No item for $qid");
        update_queue_item($qid, [
            'queue_status' => 'complete',
            'result'       => [],
            'errors'       => ['Missing queue item']
        ]);
        return;
    }

    $raw = $item['raw'] ?? '';
    $input = json_decode($raw, true);
    if (!is_array($input)) {
        $input = ['prompt' => $raw, 'faas' => []];
    }

    $prompt = $input['prompt'] ?? $raw;
    $faas   = $input['faas'] ?? [];
    if (is_string($faas)) {
        $decoded = json_decode($faas, true);
        $faas = is_array($decoded) ? $decoded : [];
    }

    $results = [];
    $errors  = [];

    foreach ($faas as $index => $task) {
        $type    = $task['type']    ?? null;
        $subtype = $task['subtype'] ?? null;
        $content = $task['content'] ?? '';
        $meta    = $task['meta']    ?? [];

        // Progress snapshot “as it’s going”
        update_queue_item($qid, [
            'queue_status' => 'generating',
            'state' => [
                'step'   => 'faas_task',
                'index'  => $index,
                'type'   => $type,
                'subtype'=> $subtype,
                'at'     => date('c')
            ]
        ]);

        if (!$type || !$content) {
            $msg = "Task $index missing type or content";
            $results[] = ['error' => $msg];
            $errors[]  = $msg;
            continue;
        }

        $content = str_replace(["\\n", "\n"], ' ', trim($content));

        if ($type === 'command' && $subtype === 'yt-dlp') {

            qlog('YT DLP');
            $url = trim($content);
            if (!filter_var($url, FILTER_VALIDATE_URL)) {
                $msg = 'Invalid URL';
                $results[] = ['error' => $msg];
                $errors[]  = $msg;
                continue;
            }

            $dataDir = __DIR__ . "/data";
            if (!file_exists($dataDir)) {
                @mkdir($dataDir, 0777, true);
            }

            $ytBinary = escapeshellcmd(__DIR__ . '/q/yt-dlp');
            $safeUrl  = escapeshellarg($url);

            $audioFormat   = $meta['audioFormat'] ?? null;
            $formatOption  = "";
            if ($audioFormat) {
                $formatOption = "-x --audio-format " . escapeshellarg($audioFormat);
            }

            $cmd    = "$ytBinary $formatOption -P '$dataDir' $safeUrl";
            $output = shell_exec("$cmd 2>&1");

            $res = [
                'success' => true,
                'command' => $cmd,
                'stdout'  => $output,
                'dataDirContents' => @scandir($dataDir)
            ];
            $results[] = $res;
            qlog("YT-DLP DOWNLOAD", $res);
            continue;
        }

        if ($type === 'command') {
            try {
                $safeCmd = sanitize_shell_input($content);
                $output  = shell_exec("$safeCmd 2>&1");
                $res = ['success' => true, 'stdout' => $output];
                $results[] = $res;
                qlog("RUN $safeCmd", $output);
            } catch (Exception $e) {
                $msg = $e->getMessage();
                $res = ['error' => $msg];
                $results[] = $res;
                $errors[]  = $msg;
                qlog('ERROR', $msg);
            }
            continue;
        }

        if ($type === 'file' && $subtype === 'save') {
            $filepath = $meta['filepath'] ?? null;
            if (!$filepath) {
                $msg = "Task $index missing filepath";
                $results[] = ['error' => $msg];
                $errors[]  = $msg;
                continue;
            }
            if (strpos($filepath, './sandbox/') !== 0) {
                // Normalize slashes
                $filepath = ltrim($filepath, './');
                $filepath = ltrim($filepath, '/');
                $filepath = './sandbox/' . $filepath;
            }

            $content =  q_sanitize_content($content, $q_type);

            $skip_write = false;

            if (trim($content) === '') {
                if (file_exists($filepath)) {
                    $skip_write = true;
                }
            }
            
            if (!$skip_write) {
                @file_put_contents($filepath, $content);
            }
       
                        
            // Lifecycle ends on write → mark complete for this qid immediately
            update_queue_item($qid, [
                'queue_status' => 'complete',
                'result' => [
                    'success' => !$skip_write,
                    'message' => "Saved to $filepath",
                    'filepath' => $filepath,
                    'bytes_written' => is_string($content) ? strlen($content) : 0
                ],
                'state' => [
                    'step' => 'file_written',
                    'filepath' => $filepath,
                    'at' => date('c')
                ]
            ]);

            $res = ['success' => true, 'message' => "Saved to $filepath"];
            $results[] = $res;
            qlog("FILE WRITE", "Saved to $filepath");
            continue;
        }

        $msg = "Task $index unsupported type/subtype";
        $results[] = ['error' => $msg];
        $errors[]  = $msg;
    }

    // If not already completed by a file write, complete now with aggregate results
    $cur = cache_get(Q_ITEM_PREFIX . $qid);
    if (is_array($cur) && (($cur['queue_status'] ?? '') !== 'complete')) {
        update_queue_item($qid, [
            'queue_status' => 'complete',
            'result'       => $results,
            'errors'       => $errors,
            'state'        => [
                'prompt'     => is_string($prompt) ? mb_substr($prompt, 0, 4000) : null,
                'faas_count' => count($faas),
                'qid'        => $qid
            ]
        ]);
    }

    qlog('WORKER DONE', ['qid' => $qid, 'errors' => $errors]);
}

// ---------- CORS preflight ----------
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ---------- CLI worker mode ----------
if (php_sapi_name() === 'cli' && isset($argv) && isset($argv[1]) && $argv[1] === 'process' && !empty($argv[2])) {
    run_worker_for_qid($argv[2]);
    exit(0);
}

// ---------- HTTP routing ----------
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// Health
if ($_SERVER['REQUEST_METHOD'] === 'GET' && $uri === '/') {
    qlog('GET /', 'No action defined for root');
    echo json_encode(['message' => 'Q Server Running', 'timestamp' => date('c')]);
    exit;
}




function cache_dump_all() {
    $c = getCache();
    $out = [];
    $prefix = defined('Q_ITEM_PREFIX') ? Q_ITEM_PREFIX : 'q:'; // e.g., "q:"

    // ---- A) Memcached::getAllKeys (if available & allowed) ----
    if ($c instanceof Memcached && method_exists($c, 'getAllKeys')) {
        try {
            $keys = @$c->getAllKeys(); // returns array|false
            if (is_array($keys) && $keys) {
                foreach ($keys as $k) {
                    // only queue items under our prefix
                    if (is_string($k) && str_starts_with($k, $prefix)) {
                        $qid = substr($k, strlen($prefix)); // normalize to bare QID
                        $out[$qid] = $c->get($k);
                    }
                }
                return $out;
            }
        } catch (\Throwable $e) { /* fall through */ }
    }

    // ---- B) Memcache slab walk (Memcache extension only) ----
    if ($c instanceof Memcache) {
        try {
            $itemsStats = @$c->getExtendedStats('items');
            if (is_array($itemsStats)) {
                foreach ($itemsStats as $server => $slabs) {
                    if (!is_array($slabs)) continue;
                    foreach ($slabs as $slabIdKey => $slabMeta) {
                        if (!preg_match('/^items:(\d+):number$/', (string)$slabIdKey, $m)) continue;
                        $slabId = (int)$m[1];
                        // 0 = “no limit” in many builds; if it fails in your env, try a big number (e.g., 5000)
                        $cachedump = @$c->getExtendedStats('cachedump', $slabId, 0);
                        if (!is_array($cachedump)) continue;
                        foreach ($cachedump as $srv => $entries) {
                            if (!is_array($entries)) continue;
                            foreach ($entries as $keyName => $_meta) {
                                if (!is_string($keyName)) continue;
                                if (str_starts_with($keyName, $prefix)) {
                                    $qid = substr($keyName, strlen($prefix));
                                    $out[$qid] = $c->get($keyName);
                                }
                            }
                        }
                    }
                }
            }
            if ($out) return $out;
        } catch (\Throwable $e) { /* fall through */ }
    }

    // ---- C) Fallback: rely on our internal queue index (q_index_all) ----
    try {
        $ids = q_index_all(); // returns array of QIDs (e.g., ['q_status_1', ...])
        if (is_array($ids)) {
            foreach ($ids as $qid) {
                if (!is_string($qid) || $qid === '') continue;
                $key = $prefix . $qid;
                $out[$qid] = cache_get($key);
            }
        }
    } catch (\Throwable $e) { /* ignore */ }

    return $out;
}



// ---------- /restart: clear ALL Memcache/Memcached keys and return before/after dumps ----------
if ($_SERVER['REQUEST_METHOD'] === 'GET' && $uri === '/restart') {
    $before = cache_dump_all(); // Capture state before flush
    $method = 'none';
    $ok     = false;
    $error  = null;

    try {
        $c = getCache();

        if ($c instanceof Memcached) {
            $ok     = @$c->flush(); // Flush all keys instantly
            $method = 'memcached:flush_all';
        } elseif ($c instanceof Memcache) {
            $ok     = @$c->flush(); // Legacy Memcache flush
            $method = 'memcache:flush_all';
        } else {
            $method = 'unknown_client';
        }
    } catch (\Throwable $e) {
        $error = $e->getMessage();
        $ok    = false;
    }

    // Manual fallback if flush() fails
    if (!$ok) {
        try {
            if (isset($c) && ($c instanceof Memcache || $c instanceof Memcached)) {
                $stats = @$c->getExtendedStats('items');
                if (is_array($stats)) {
                    foreach ($stats as $server => $slabs) {
                        if (!is_array($slabs)) continue;
                        foreach ($slabs as $slabKey => $slabMeta) {
                            if (!preg_match('/^items:(\d+):number$/', $slabKey, $m)) continue;
                            $slabId = (int)$m[1];
                            $cachedump = @$c->getExtendedStats('cachedump', $slabId, 0);
                            if (!is_array($cachedump)) continue;
                            foreach ($cachedump as $srv => $entries) {
                                if (!is_array($entries)) continue;
                                foreach ($entries as $key => $_) {
                                    @$c->delete($key);
                                }
                            }
                        }
                    }
                }
            }
            $ok = true;
            $method .= '+manual_delete';
        } catch (\Throwable $e) {
            $error = $error ?: $e->getMessage();
        }
    }

    // Reset all known cache indices for good measure
    @cache_set(Q_INDEX, []);
    $after = cache_dump_all();

    qlog('GET /restart FULL CLEAR', [
        'method'        => $method,
        'ok'            => $ok,
        'error'         => $error,
        'before_count'  => $before['count'] ?? null,
        'after_count'   => $after['count'] ?? null
    ]);

    echo json_encode([
        'success'       => (bool)$ok,
        'method'        => $method,
        'error'         => $error,
        'timestamp'     => date('c'),
        'before'        => $before,
        'after'         => $after
    ]);
    exit;
}




// ---------- /test: POST heartbeat — upsert by qid with unix timestamp + dump ----------
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($uri === '/test' || $uri === '/up' || $uri === '/status')) {
    $raw  = file_get_contents('php://input');
    $post = json_decode($raw, true);

    // required: qid
    $qid = is_array($post) ? ($post['qid'] ?? null) : null;
    if (!is_string($qid) || $qid === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Missing qid']);
        exit;
    }

    // optional payloads
    $clientState = $post['state']    ?? null;
    $filepath    = $post['filepath'] ?? null;
    $content     = $post['content']  ?? null;

    $key = Q_ITEM_PREFIX . $qid;
    $now = time();
    $item = cache_get($key);

    if (is_array($item)) {
        $item['qid']           = $qid;
        $item['queue_status']  = 'view_all_status';
        $item['state']         = $clientState;

        if ($filepath !== null) $item['filepath'] = $filepath;
        if ($content  !== null) $item['content']  = $content;


        cache_set($key, $item);
    } else {
        $item = [
            'qid'          => $qid,

            'queue_status' => 'new',
            'state'        => $clientState,
            'state_ts'     => $now,
            'filepath'     => $filepath,
            'content'      => $content,
            'result'       => null,
            'errors'       => [],
            'raw'          => $raw
        ];
        cache_set($key, $item);
        q_index_add($qid);
    }

    // add full memcache dump
    $dump = cache_dump_all();

    $payload = [   
        'qid'       => $qid,
        'status'    => 'ok',
        'filepath'     => $item['filepath'],
        'content'     => $item['content'],
        'state'     => $item['state'],
        'dump'      => $dump,
        'timestamp' => date('c')
    ];

    if (isset($clientState['debug']) && $clientState['debug'] === 'true') {
        qlog('🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢  ');
        qlog('🟢🟢🟢🟢 POST to: ' . $uri, $payload);
        qlog("🟢🟢🟢🟢");
        qlog('🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢  ');
        qlog('🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦  ');
        qlog('🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦  ');
        qlog('🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦  ');
        qlog('🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦    END ' . $qid . '    🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦  ');
        
        
    }


    echo json_encode($payload);
    exit;
}


function q_sanitize_content($content = '', $type = 'write') {
    // finally remove "Copy code" if it is at the start
    $content = preg_replace('/^Copy code/', '', $content);


    $content = str_replace('ChatGPT said:', '', $content);
    $content = str_replace('ChatGPT said', '', $content);
    $content = str_replace('Do you like this personality?', '', $content);
            
    // remove "Thought for Xs" at start — X is any digits or any chars before literal "s"
    $content = preg_replace('/Thought for .*s/', '', $content);

    // remove all "xxxCopy code" prefixes for common file types
    $content_types = [
        'htmlCopy code',
        'jsonCopy code',
        'javascriptCopy code',
        'jsCopy code',
        'onCopy code',
        'phpCopy code',
        'cssCopy code',
        'bashCopy code',
        'sqlCopy code',
        'xmlCopy code',
        'yamlCopy code',
        'textCopy code',
        'dotenvCopy code',
        'typescriptCopy code',
        'jsxCopy code',

        // new ChatGPT-style labels
        'makefileCopy code',
        'yamlCopy code',
        'ymlCopy code',
        'gitignoreCopy code',
        'textCopy code',        // for .example
        'markdownCopy code'     // for .md
    ];

    foreach ($content_types as $t) {
        $content = preg_replace('/^' . preg_quote($t, '/') . '/i', '', $content);
    }

    // remove all "xxxCopy code" prefixes for common file types
    $endings = [
        'Is this conversation helpful so far?',
        'Updated saved memory'
    ];

    foreach ($endings as $e) {
        $content = preg_replace('/' . preg_quote($e, '/') . '/i', '', $content);
    }

    return $content;
}

// ---------- /q_run: strict qid parse + always save/update + type-aware handling + full memcache dump ----------
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $uri === '/q_run') {
    $raw = file_get_contents('php://input');
    qlog('POST /q_run RAW', $raw);

    $post     = json_decode($raw, true);

    $qid      = is_array($post) ? ($post['qid'] ?? null)      : null;
    $filepath = is_array($post) ? ($post['filepath'] ?? null) : null;
    $content  = is_array($post) ? ($post['content']  ?? '')   : '';
    $meta     = is_array($post) ? ($post['meta']     ?? [])   : [];
    qlog('POST /q_run $post', 'prev 0');

    $qid_parts = explode('_', $qid);

    if ($qid_parts > 1) {
        $q_type = $qid_parts[1];
    }
    else {
        $q_type = 'write';
    }
    
    $content =  q_sanitize_content($content, $q_type);




    // ---- qid validation & explode ----
    // Must be "q_<type>_<uuid>_<number>[...]" with 4+ parts
    if (!is_string($qid) || $qid === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Missing qid']);
        exit;
    }

    qlog('POST /q_run $post', 'prev 1');

    $parts = explode('_', $qid);
    if (count($parts) < 2) {
        qlog('POST /q_run $post', 'prev 2');
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid qid format: expected q_<type>_<uuid>_<number>']);
        exit;
    }
    if ($parts[0] !== 'q') {
        qlog('POST /q_run $post', 'prev 3');
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid qid: must start with "q_"']);
        exit;
    }
    qlog('POST /q_run $post', 1);
    $q_letter = $parts[0];                     // 'q'
    $q_type   = strtolower($parts[1]);         // command|download|write|status

    if (count($parts) > 2) {
        $q_uuid   = $parts[2];                     // project key (opaque)
        $q_runnum = $parts[count($parts) - 1];                     // numeric counter (string okay)
    }
    else {
        $q_uuid   = 'error';                     // project key (opaque)
        $q_runnum = $parts[count($parts) - 1];                     // numeric counter (string okay)
    }

    qlog('POST /q_run $post', 2);
    // Optional: allow additional underscore fragments after the 4th part; they’re ignored for routing
    $allowed_types = ['command','download','write','status', 'manifest'];
    if (!in_array($q_type, $allowed_types, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => "Invalid qid type '$q_type'"]);
        exit;
    }
    if (!ctype_digit((string)$q_runnum)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid qid number segment']);
        exit;
    }
    qlog('POST /q_run $post', 3);
    // ---- create/update queue item immediately (always save/update) ----
    $key      = Q_ITEM_PREFIX . $qid;
    $existing = cache_get($key);
    $is_new   = !is_array($existing);

    // Baseline snapshot before doing anything
    $initial_patch = [
        'qid'          => $qid,
        'queue_status' => 'generating',
        'errors'       => [],
        'state'        => [
            'step'      => 'q_run_start',
            'qid_parts' => ['q'=>$q_letter, 'type'=>$q_type, 'uuid'=>$q_uuid, 'number'=>$q_runnum],
            'filepath'  => $filepath,
            'at'        => date('c')
        ],
        'raw'          => $raw
    ];
    qlog('POST /q_run $post', 4);
    ensure_queue_item($qid, $raw, $initial_patch);

    // ---- Type-aware execution paths ----
    $result_payload = null;
    $errors         = [];

    // ---- collect full memcache dump for ALL RESPONSES ----
    $ids  = q_index_all();
    $dump = [];
    foreach ($ids as $id) {
        $it = cache_get(Q_ITEM_PREFIX . $id);
        if (is_array($it)) $dump[$id] = $it;
    }

    qlog('POST /q_run $post', 5);
    if ($q_type === 'command') {
        // Run the command EXACTLY as provided in $content; capture all output and exit code
        
    
        update_queue_item($qid, [
            'queue_status' => 'generating',
            'state' => ['step' => 'command_start', 'command' => $content, 'at' => date('c')]
        ]);

        $cmdOut = [];
        $cmdCode = 0;
        // Redirect stderr to stdout to capture everything
        exec($content . ' 2>&1', $cmdOut, $cmdCode);
        $fullOutput = implode("\n", $cmdOut);

        $result_payload = [
            'status'            => ($cmdCode === 0),
            'command'           => $content,
            'command_response'  => [
                'exit_code' => $cmdCode,
                'output'    => $fullOutput
            ]
        ];
        if ($cmdCode !== 0) {
            $errors[] = "Command exited with code $cmdCode";
        }

        update_queue_item($qid, [
            'queue_status' => 'complete',
            'result'       => $result_payload,
            'errors'       => $errors,
            'state'        => ['step' => 'command_complete', 'at' => date('c')]
        ]);

    } elseif ($q_type === 'write' || $q_type === 'manifest') {
        
    qlog('POST /q_run $post', 11);
        // Write file path/content (delete first) + git status (compatible with previous behavior)
        if (!is_string($filepath) || $filepath === '') {
            
    qlog('POST /q_run $post', 12);
            http_response_code(400);
            $err = ['success' => false, 'error' => 'Missing or invalid "filepath"'];
            update_queue_item($qid, [
                'errors' => array_merge((cache_get($key)['errors'] ?? []), ['Missing or invalid "filepath"']),
                'state'  => ['step' => 'q_run_error', 'at' => date('c')]
            ]);
            
    qlog('POST /q_run $post', 13);
            // Always dump memcache with error
            $ids  = q_index_all();
            $dump = [];
            foreach ($ids as $id) {
                $it = cache_get(Q_ITEM_PREFIX . $id);
                if (is_array($it)) $dump[$id] = $it;
            }
            
    qlog('POST /q_run $post', 14);
            echo json_encode(array_merge($err, [
                'qid'          => $qid,
                'server_state' => $dump,
                'timestamp'    => date('c'),
                'status'       => $is_new ? 'new' : 'error'
            ]));
            exit;
        }

        // ensure directory exists
        $dir = dirname($filepath);
        if (!is_dir($dir)) { @mkdir($dir, 0777, true); }

        // delete old file then write new
        if (file_exists($filepath)) { @unlink($filepath); }

        
        if (trim($content) === '') {
            if (file_exists($filepath)) {
                $skip_write = true;
            }
        }
        
        if (!$skip_write) {
            $bytes = @file_put_contents($filepath, $content);
        }
    

        // git status
        $gitLines = [];
        $gitCode  = 0;
        @exec('git status --porcelain=v1 2>&1', $gitLines, $gitCode);
        $gitOutput = implode("\n", $gitLines);

        $result_payload = [
            'status'         => $bytes !== false,
            'filepath'       => $filepath,
            'bytes_written'  => $bytes === false ? 0 : $bytes,
            'git_status'     => ['exit_code' => $gitCode, 'output' => $gitOutput]
        ];
        if ($bytes === false) {
            $errors[] = 'File write failed';
        }

        qlog('POST /q_run $post', 9);
        update_queue_item($qid, [
            'queue_status' => 'complete',
            'result'       => $result_payload,
            'errors'       => $errors,
            'state'        => ['step' => 'q_run_complete', 'timestamp' => date('c')]
        ]);

    }
    
    elseif ($q_type === 'status') {
        
    qlog('POST /q_run $post', 10);
        update_queue_item($qid, [
            'queue_status' => 'status',
            'result'       => $post['state'],
            'errors'       => $errors,
            'state'        => ['step' => 'q_run_complete', 'timestamp' => date('c')]
        ]);

        echo json_encode([
            'status'        => $is_new ? 'new' : 'ok',
            'qid'           => $qid,
            'type'          => $q_type,
            'server_state'  => $dump,
            'timestamp'     => date('c')
        ]);

        exit;
    }

    else {
        // For other types (download/status/unknown): just record flexible payload and mark complete
        update_queue_item($qid, [
            'queue_status' => 'generating',
            'state'        => ['step' => 'type_dispatch', 'type' => $q_type, 'at' => date('c')]
        ]);

        $result_payload = [
            'status'  => true,
            'message' => 'No-op for this type in /q_run; recorded state only',
            'type'    => $q_type,
            'meta'    => $meta
        ];

        update_queue_item($qid, [
            'queue_status' => 'complete',
            'result'       => $result_payload,
            'errors'       => [],
            'state'        => ['step' => 'generic_complete', 'at' => date('c')]
        ]);
    }

    qlog('POST /q_run $post', 6);

    qlog('POST /q_run updated queue', $qid);

    echo json_encode([
        'status'        => $is_new ? 'new' : 'ok',
        'qid'           => $qid,
        'type'          => $q_type,
        'result'        => $result_payload,
        'errors'        => $errors,
        'server_state'  => $dump,
        'timestamp'     => date('c')
    ]);

    qlog('POST /q_run $post', 7);
    exit;
}


// ---------- /run: enqueue + async process + return full dump ----------
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $uri === '/run') {
    $raw = file_get_contents('php://input');
    qlog('POST /run RAW', $raw);

    $maybe = json_decode($raw, true);
    $clientQid = is_array($maybe) ? ($maybe['qid'] ?? null) : null;

    $qid = parse_qid_or_default($clientQid, $raw);

    // Create or refresh queue item at 'idle' (if exists, keep original created_at)
    $existing = cache_get(Q_ITEM_PREFIX . $qid);
    if (is_array($existing)) {
        // Update raw/state but keep lifecycle sane
        update_queue_item($qid, [
            'raw'          => $raw,
            'queue_status' => 'idle',
            'state'        => ['step' => 're-enqueue', 'at' => date('c')]
        ]);
    } else {
        create_queue_item($qid, $raw);
    }

    // Spawn background worker (no output). Worker flips to 'generating' and then 'complete'
    $phpBin   = PHP_BINARY ?: 'php';
    $selfFile = escapeshellarg(__FILE__);
    $safeQid  = escapeshellarg($qid);
    $cmd = "$phpBin $selfFile process $safeQid > /dev/null 2>&1 &";
    @shell_exec($cmd);

    // Full memcache dump
    $ids = q_index_all();
    $dump = [];
    foreach ($ids as $id) {
        $it = cache_get(Q_ITEM_PREFIX . $id);
        if (is_array($it)) $dump[$id] = $it;
    }

    echo json_encode([
        'success'      => 'idle', // enqueue state
        'enqueued'     => cache_get(Q_ITEM_PREFIX . $qid),
        'qid'          => $qid,
        'server_state' => $dump,
        'timestamp'    => date('c')
    ]);
    exit;
}

// ---------- 404 ----------
http_response_code(404);
$err = ['error' => 'Route not found' . json_encode($_SERVER)];
qlog('404', $err);
echo json_encode($err);
