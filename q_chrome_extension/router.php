<?php
$path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);
$fullPath = __DIR__ . $path;

// Serve static files with proper CORS headers
if (php_sapi_name() === "cli-server") {
    if ($path !== '/' && file_exists($fullPath) && !is_dir($fullPath)) {
        $ext = pathinfo($fullPath, PATHINFO_EXTENSION);
        $mimeTypes = [
            'json' => 'application/json',
            'js' => 'application/javascript',
            'css' => 'text/css',
            'html' => 'text/html',
            'txt' => 'text/plain',
        ];
        $contentType = $mimeTypes[$ext] ?? 'application/octet-stream';
        header("Content-Type: $contentType");
        header("Access-Control-Allow-Origin: *");
        readfile($fullPath);
        return true;
    }
}

// Route to dynamic handler
require __DIR__ . '/server.php';
