/**
 * Kiro Authentication CLI Tool
 * Used to obtain OAuth credentials
 */
import { KiroAuth } from './auth.js';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
    console.log('=== Kiro OAuth Authentication Tool ===\n');

    // Choose storage location
    console.log('Please select credential storage location:');
    console.log('1. Default location (~/.kiro/oauth_creds.json)');
    console.log('2. Project configs directory (configs/kiro/)');
    console.log('');

    const storageChoice = await question('Please enter option (1/2): ');
    const saveToConfigs = storageChoice.trim() === '2';

    console.log('\nPlease select authentication method:');
    console.log('1. Google account login (recommended)');
    console.log('2. GitHub account login');
    console.log('3. AWS Builder ID');
    console.log('');

    const choice = await question('Please enter option (1/2/3): ');

    const auth = new KiroAuth({ saveToConfigs });

    try {
        switch (choice.trim()) {
            case '1':
                console.log('\nStarting Google login...');
                const googleResult = await auth.startSocialAuth('Google');
                console.log('\nPlease open the following link in your browser to authorize:');
                console.log(googleResult.authUrl);
                console.log('\nWaiting for authorization...');
                break;

            case '2':
                console.log('\nStarting GitHub login...');
                const githubResult = await auth.startSocialAuth('Github');
                console.log('\nPlease open the following link in your browser to authorize:');
                console.log(githubResult.authUrl);
                console.log('\nWaiting for authorization...');
                break;

            case '3':
                console.log('\nStarting AWS Builder ID login...');
                const builderResult = await auth.startBuilderIDAuth();
                console.log('\nPlease open the following link in your browser:');
                console.log(builderResult.verificationUriComplete);
                console.log(`\nOr visit ${builderResult.verificationUri} and enter code: ${builderResult.userCode}`);
                console.log('\nWaiting for authorization...');
                break;

            default:
                console.log('Invalid option');
                rl.close();
                return;
        }

        // Wait for user to complete authorization
        if (saveToConfigs) {
            console.log('\nAfter authorization, credentials will be saved to project configs/kiro/ directory');
        } else {
            console.log('\nAfter authorization, credentials will be automatically saved to ~/.kiro/oauth_creds.json');
        }
        console.log('Press Ctrl+C to cancel\n');

    } catch (error) {
        console.error('Authentication failed:', error.message);
        auth.close();
        rl.close();
    }
}

main();
