import * as fs from 'fs';
import * as path from 'path';

async function sendRequest() {
    const markdownFilePath = path.join(import.meta.dir, 'request.md');
    const markdownContent = await fs.promises.readFile(markdownFilePath, 'utf-8');

    const userMessage = markdownContent.trim();

    const command = process.argv[2]; // Get the command from command line arguments
    const channelId = process.argv[3]; // Get the channel ID from command line arguments

    let requestBody: any;
    let endpoint: string;

    switch (command) {
        case 'new':
            endpoint = channelId
                ? `http://localhost:8765/responses/${channelId}/new`
                : 'http://localhost:8765/responses/new';
            requestBody = {
                input: [
                    {
                        role: 'user',
                        content: userMessage,
                    },
                ],
            };
            break;
        case 'message':
        default: // Default to send-message if no command or unknown command
            endpoint = channelId
                ? `http://localhost:8765/responses/${channelId}`
                : 'http://localhost:8765/responses';
            requestBody = {
                input: [
                    {
                        role: 'user',
                        content: userMessage,
                    },
                ],
            };
            break;
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Response:', data);
    } catch (error) {
        console.error('Error sending request:', error);
    }
}

sendRequest();
