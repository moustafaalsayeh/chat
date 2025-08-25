<?php
// Performance optimizations
ini_set('max_execution_time', 35);
ini_set('memory_limit', '32M');

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

// Optimized data storage
$dataFile = 'messages.json';
$lockFile = 'messages.lock';
$cacheFile = 'cache.json';

// Performance monitoring
$startTime = microtime(true);

// Initialize data file if it doesn't exist
if (!file_exists($dataFile)) {
    $initialData = ['messages' => [], 'lastUpdate' => time()];
    file_put_contents($dataFile, json_encode($initialData, JSON_UNESCAPED_UNICODE));
    file_put_contents($cacheFile, json_encode(['lastModified' => filemtime($dataFile), 'data' => $initialData]));
}

// Optimized file reading with caching
function readDataWithCache($dataFile, $cacheFile) {
    $fileModTime = filemtime($dataFile);
    
    if (file_exists($cacheFile)) {
        $cache = json_decode(file_get_contents($cacheFile), true);
        if ($cache && $cache['lastModified'] == $fileModTime) {
            return $cache['data']; // Return cached data
        }
    }
    
    // Read and cache new data
    $data = json_decode(file_get_contents($dataFile), true);
    file_put_contents($cacheFile, json_encode(['lastModified' => $fileModTime, 'data' => $data]));
    return $data;
}

// Thread-safe file writing
function writeDataSafe($dataFile, $cacheFile, $data) {
    $lockFile = $dataFile . '.lock';
    $fp = fopen($lockFile, 'w');
    
    if (flock($fp, LOCK_EX)) {
        file_put_contents($dataFile, json_encode($data, JSON_UNESCAPED_UNICODE));
        file_put_contents($cacheFile, json_encode(['lastModified' => filemtime($dataFile), 'data' => $data]));
        flock($fp, LOCK_UN);
    }
    
    fclose($fp);
    unlink($lockFile);
}

// Handle POST requests (adding new messages)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (isset($input['message']) && !empty(trim($input['message']))) {
        $data = readDataWithCache($dataFile, $cacheFile);
        
        $newMessage = [
            'id' => uniqid('msg_', true),
            'message' => htmlspecialchars(trim($input['message']), ENT_QUOTES, 'UTF-8'),
            'timestamp' => date('Y-m-d H:i:s'),
            'user' => isset($input['user']) ? htmlspecialchars(trim($input['user']), ENT_QUOTES, 'UTF-8') : 'Anonymous',
            'created_at' => time()
        ];
        
        // Limit messages to prevent memory issues (keep last 100)
        if (count($data['messages']) >= 100) {
            $data['messages'] = array_slice($data['messages'], -99);
        }
        
        $data['messages'][] = $newMessage;
        $data['lastUpdate'] = time();
        
        writeDataSafe($dataFile, $cacheFile, $data);
        
        // Performance logging
        $executionTime = round((microtime(true) - $startTime) * 1000, 2);
        
        echo json_encode([
            'status' => 'success', 
            'message' => $newMessage,
            'performance' => ['execution_time_ms' => $executionTime]
        ]);
        exit;
    }
    
    echo json_encode(['status' => 'error', 'message' => 'Invalid message']);
    exit;
}

// Handle GET requests (long polling) - OPTIMIZED
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $lastKnownTime = isset($_GET['lastUpdate']) ? (int)$_GET['lastUpdate'] : 0;
    $timeout = 25; // Reduced timeout for better performance
    $checkInterval = 0.5; // Optimized: Check every 500ms instead of 1s
    $pollStartTime = time();
    $lastFileCheck = 0;
    $cachedData = null;
    
    // Immediate check first
    $data = readDataWithCache($dataFile, $cacheFile);
    if ($data['lastUpdate'] > $lastKnownTime) {
        $newMessages = array_filter($data['messages'], function($msg) use ($lastKnownTime) {
            return isset($msg['created_at']) ? $msg['created_at'] > $lastKnownTime : strtotime($msg['timestamp']) > $lastKnownTime;
        });
        
        $executionTime = round((microtime(true) - $startTime) * 1000, 2);
        
        echo json_encode([
            'status' => 'success',
            'messages' => array_values($newMessages),
            'lastUpdate' => $data['lastUpdate'],
            'performance' => ['execution_time_ms' => $executionTime, 'immediate_response' => true]
        ]);
        exit;
    }
    
    // Long polling loop with optimizations
    while (time() - $pollStartTime < $timeout) {
        // Only check file if enough time has passed (reduce I/O)
        $currentTime = microtime(true);
        if ($currentTime - $lastFileCheck >= $checkInterval) {
            $lastFileCheck = $currentTime;
            
            // Use file modification time for quick check
            $fileModTime = filemtime($dataFile);
            if (!$cachedData || $cachedData['fileModTime'] != $fileModTime) {
                $data = readDataWithCache($dataFile, $cacheFile);
                $cachedData = ['data' => $data, 'fileModTime' => $fileModTime];
            } else {
                $data = $cachedData['data'];
            }
            
            // Check for new data
            if ($data['lastUpdate'] > $lastKnownTime) {
                $newMessages = array_filter($data['messages'], function($msg) use ($lastKnownTime) {
                    return isset($msg['created_at']) ? $msg['created_at'] > $lastKnownTime : strtotime($msg['timestamp']) > $lastKnownTime;
                });
                
                $executionTime = round((microtime(true) - $startTime) * 1000, 2);
                
                echo json_encode([
                    'status' => 'success',
                    'messages' => array_values($newMessages),
                    'lastUpdate' => $data['lastUpdate'],
                    'performance' => ['execution_time_ms' => $executionTime, 'polling_duration' => time() - $pollStartTime]
                ]);
                exit;
            }
        }
        
        // Micro-sleep to prevent high CPU usage
        usleep(100000); // 100ms
    }
    
    // Timeout reached
    $executionTime = round((microtime(true) - $startTime) * 1000, 2);
    
    echo json_encode([
        'status' => 'timeout',
        'messages' => [],
        'lastUpdate' => $lastKnownTime,
        'performance' => ['execution_time_ms' => $executionTime, 'timeout_reached' => true]
    ]);
    exit;
}

// Handle other methods
http_response_code(405);
echo json_encode(['status' => 'error', 'message' => 'Method not allowed']);
?>