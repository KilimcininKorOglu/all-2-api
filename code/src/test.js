/**
 * Kiro API Test Script
 */
import { KiroClient } from './kiro/client.js';
import { CredentialStore, initDatabase } from './db.js';

async function main() {
    console.log('=== Kiro Client Test ===\n');

    // Initialize database
    await initDatabase();
    const store = await CredentialStore.create();

    // Check if credentials exist
    const credentials = store.getAll();
    console.log(`Database has ${credentials.length} credentials\n`);

    if (credentials.length === 0) {
        console.log('No credentials found. Please add them using:');
        console.log('1. Start management interface: node src/server.js');
        console.log('2. Visit http://localhost:3000');
        console.log('3. Click "Import File" or "Add Credential"\n');
        return;
    }

    // Get active credential
    const active = store.getActive();
    if (!active) {
        console.log('No active credential. Please activate one first');
        return;
    }

    console.log(`Using credential: ${active.name}`);
    console.log(`Region: ${active.region}`);
    console.log(`Auth method: ${active.authMethod}\n`);

    try {
        // Create client from database
        const client = await KiroClient.fromDatabase();

        console.log('=== Supported Models ===');
        console.log(client.getModels());

        console.log('\n=== Sending Test Message ===');
        const messages = [
            { role: 'user', content: 'Hello, please introduce yourself in one sentence.' }
        ];

        // Non-streaming request
        console.log('\n--- Non-streaming Response ---');
        const response = await client.chat(messages);
        console.log('Response:', response);

        // Streaming request
        console.log('\n--- Streaming Response ---');
        process.stdout.write('Response: ');
        for await (const event of client.chatStream(messages)) {
            if (event.type === 'content') {
                process.stdout.write(event.content);
            }
        }
        console.log('\n');

        console.log('=== Test Complete ===');

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Status code:', error.response.status);
        }
    }
}

main();
