<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

// Data file to store messages
$dataFile = 'messages.json';

// Initialize data file if it doesn't exist
if (!file_exists($dataFile)) {
    file_put_contents($dataFile, json_encode(['messages' => [], 'lastUpdate' => time()]));
}

// Handle POST requests (adding new messages)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (isset($input['message']) && !empty(trim($input['message']))) {
        $data = json_decode(file_get_contents($dataFile), true);
        
        $newMessage = [
            'id' => uniqid(),
            'message' => htmlspecialchars(trim($input['message'])),
            'timestamp' => date('Y-m-d H:i:s'),
            'user' => isset($input['user']) ? htmlspecialchars($input['user']) : 'Anonymous'
        ];
        
        $data['messages'][] = $newMessage;
        $data['lastUpdate'] = time();
        
        file_put_contents($dataFile, json_encode($data));
        
        echo json_encode(['status' => 'success', 'message' => $newMessage]);
        exit;
    }
    
    echo json_encode(['status' => 'error', 'message' => 'Invalid message']);
    exit;
}

// Handle GET requests (long polling)
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $lastKnownTime = isset($_GET['lastUpdate']) ? (int)$_GET['lastUpdate'] : 0;
    $timeout = 30; // Maximum wait time in seconds
    $checkInterval = 1; // Check for updates every second
    $startTime = time();
    
    while (time() - $startTime < $timeout) {
        $data = json_decode(file_get_contents($dataFile), true);
        
        // If there's new data since the last known update
        if ($data['lastUpdate'] > $lastKnownTime) {
            // Filter messages that are newer than lastKnownTime
            $newMessages = array_filter($data['messages'], function($msg) use ($lastKnownTime) {
                return strtotime($msg['timestamp']) > $lastKnownTime;
            });
            
            echo json_encode([
                'status' => 'success',
                'messages' => array_values($newMessages),
                'lastUpdate' => $data['lastUpdate']
            ]);
            exit;
        }
        
        // Wait before checking again
        sleep($checkInterval);
    }
    
    // Timeout reached, return empty response
    echo json_encode([
        'status' => 'timeout',
        'messages' => [],
        'lastUpdate' => $lastKnownTime
    ]);
    exit;
}

// Handle other methods
http_response_code(405);
echo json_encode(['status' => 'error', 'message' => 'Method not allowed']);
?>