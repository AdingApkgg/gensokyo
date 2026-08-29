<?php
declare(strict_types=1);
error_reporting(E_ERROR | E_PARSE);
ini_set('display_errors', '0');
require __DIR__ . '/vendor/autoload.php';

use Metowolf\Meting;

header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json; charset=utf-8');

$server = $_GET['server'] ?? 'netease';
$type   = $_GET['type']   ?? 'search';
$id     = $_GET['id']     ?? '';

$allowedServers = ['netease', 'tencent', 'kugou'];
$allowedTypes   = ['search', 'song', 'album', 'playlist', 'url', 'lyric', 'pic'];

if (!in_array($server, $allowedServers, true) || !in_array($type, $allowedTypes, true) || $id === '') {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_params']);
    exit;
}

try {
    $api = new Meting($server);
    $api->format(true);
    $result = $api->{$type}($id);
    // Meting returns JSON string
    echo $result;
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
