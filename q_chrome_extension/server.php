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

    $post = json_decode($raw, true);

    // ---- qid extraction ----
    $qid = is_array($post) ? ($post['qid'] ?? null) : null;

    if (!is_string($qid) || $qid === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Missing qid']);
        exit;
    }

    // ---- qid parse: q_<type>_<uuid>_<number>[...] ----
    $parts = explode('_', $qid);
    if (count($parts) < 3 || $parts[0] !== 'q') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid qid format']);
        exit;
    }

    $q_letter = $parts[0];
    $q_type   = strtolower($parts[1]); // command | write | manifest | status | download
    $q_uuid   = $parts[2];
    $q_runnum = $parts[count($parts) - 1];

    if (!ctype_digit((string)$q_runnum)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid qid number segment']);
        exit;
    }

    $allowed_types = ['command', 'write', 'manifest', 'status', 'download'];
    if (!in_array($q_type, $allowed_types, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => "Invalid qid type '$q_type'"]);
        exit;
    }

    // ---- payload extraction (type-aware) ----
    $filepath = null;
    $content  = '';
    $meta     = [];
    $command  = null;

    if ($q_type === 'command') {
        // explicit: command is a bash command string
        $command = is_array($post) ? ($post['command'] ?? null) : null;
        if (!is_string($command) || trim($command) === '') {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Missing or invalid "command"']);
            exit;
        }
    } else {
        // default + write/manifest path
        $filepath = is_array($post) ? ($post['filepath'] ?? null) : null;
        $content  = is_array($post) ? ($post['content']  ?? '')   : '';
        $meta     = is_array($post) ? ($post['meta']     ?? [])   : [];
        $content  = q_sanitize_content($content, $q_type);
    }

    // ---- queue bootstrap (always save/update) ----
    $key      = Q_ITEM_PREFIX . $qid;
    $existing = cache_get($key);
    $is_new   = !is_array($existing);

    $initial_patch = [
        'qid'          => $qid,
        'queue_status' => 'generating',
        'errors'       => [],
        'state'        => [
            'step'      => 'q_run_start',
            'qid_parts' => [
                'q'      => $q_letter,
                'type'   => $q_type,
                'uuid'   => $q_uuid,
                'number' => $q_runnum
            ],
            'filepath' => $filepath,
            'at'       => date('c')
        ],
        'raw'          => $raw
    ];

    ensure_queue_item($qid, $raw, $initial_patch);

    // ---- full memcache dump helper ----
    $dump_all = function () {
        $ids  = q_index_all();
        $dump = [];
        foreach ($ids as $id) {
            $it = cache_get(Q_ITEM_PREFIX . $id);
            if (is_array($it)) {
                $dump[$id] = $it;
            }
        }
        return $dump;
    };

    $result_payload = null;
    $errors         = [];

    // ======================================================
    // COMMAND PATH (explicit, forked, no write bleed-through)
    // ======================================================
    if ($q_type === 'command') {
        update_queue_item($qid, [
            'queue_status' => 'generating',
            'state'        => [
                'step'    => 'command_start',
                'command' => $command,
                'at'      => date('c')
            ]
        ]);

        $output = [];
        $exit   = 0;

        // run EXACT bash command, capture stdout + stderr
        exec($command . ' 2>&1', $output, $exit);
        $outText = implode("\n", $output);

        $result_payload = [
            'status'   => ($exit === 0),
            'type'     => 'command',
            'command'  => $command,
            'response' => [
                'exit_code' => $exit,
                'output'    => $outText
            ]
        ];

        if ($exit !== 0) {
            $errors[] = "Command exited with code $exit";
        }

        update_queue_item($qid, [
            'queue_status' => 'complete',
            'result'       => $result_payload,
            'errors'       => $errors,
            'state'        => [
                'step' => 'command_complete',
                'at'   => date('c')
            ]
        ]);

        echo json_encode([
            'status'       => $is_new ? 'new' : 'ok',
            'qid'          => $qid,
            'type'         => 'command',
            'result'       => $result_payload,
            'errors'       => $errors,
            'server_state' => $dump_all(),
            'timestamp'    => date('c')
        ]);
        exit;
    }

    // ======================================================
    // WRITE / MANIFEST PATH (DEFAULT, UNCHANGED BEHAVIOR)
    // ======================================================
    if ($q_type === 'write' || $q_type === 'manifest') {
        if (!is_string($filepath) || $filepath === '') {
            update_queue_item($qid, [
                'errors' => ['Missing or invalid "filepath"'],
                'state'  => ['step' => 'q_run_error', 'at' => date('c')]
            ]);

            echo json_encode([
                'success'      => false,
                'qid'          => $qid,
                'error'        => 'Missing or invalid "filepath"',
                'server_state' => $dump_all(),
                'timestamp'    => date('c')
            ]);
            exit;
        }

        $dir = dirname($filepath);
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }

        if (file_exists($filepath)) {
            @unlink($filepath);
        }

        $bytes = null;
        if (trim($content) !== '') {
            $bytes = @file_put_contents($filepath, $content);
        } else {
            $bytes = 0;
        }

        $gitLines = [];
        $gitCode  = 0;
        @exec('git status --porcelain=v1 2>&1', $gitLines, $gitCode);

        $result_payload = [
            'status'        => ($bytes !== false),
            'type'          => 'write',
            'filepath'      => $filepath,
            'bytes_written' => ($bytes === false ? 0 : $bytes),
            'git_status'    => [
                'exit_code' => $gitCode,
                'output'    => implode("\n", $gitLines)
            ]
        ];

        if ($bytes === false) {
            $errors[] = 'File write failed';
        }

        update_queue_item($qid, [
            'queue_status' => 'complete',
            'result'       => $result_payload,
            'errors'       => $errors,
            'state'        => [
                'step' => 'q_run_complete',
                'at'   => date('c')
            ]
        ]);

        echo json_encode([
            'status'       => $is_new ? 'new' : 'ok',
            'qid'          => $qid,
            'type'         => $q_type,
            'result'       => $result_payload,
            'errors'       => $errors,
            'server_state' => $dump_all(),
            'timestamp'    => date('c')
        ]);
        exit;
    }

    // ======================================================
    // STATUS / FALLBACK
    // ======================================================
    update_queue_item($qid, [
        'queue_status' => 'complete',
        'result'       => $post['state'] ?? null,
        'errors'       => [],
        'state'        => [
            'step' => 'status_complete',
            'at'   => date('c')
        ]
    ]);

    echo json_encode([
        'status'       => $is_new ? 'new' : 'ok',
        'qid'          => $qid,
        'type'         => $q_type,
        'server_state' => $dump_all(),
        'timestamp'    => date('c')
    ]);
    exit;
}


















// ---------- 404 ----------
http_response_code(404);
$err = ['error' => 'Route not found' . json_encode($_SERVER)];
qlog('404', $err);
echo json_encode($err);
