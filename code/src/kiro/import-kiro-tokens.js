/**
 * Import token files from kiro directory to database
 */

import fs from 'fs/promises';
import path from 'path';
import { initDatabase, CredentialStore } from '../db.js';

const KIRO_DIR = 'D:\\personal-work\\ai\\kiro';

async function importKiroTokens() {
    console.log('Connecting to database 127.0.0.1:13306...');
    await initDatabase();
    const store = await CredentialStore.create();

    console.log(`Scanning directory: ${KIRO_DIR}`);

    const entries = await fs.readdir(KIRO_DIR, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && e.name.includes('kiro-auth-token'));

    console.log(`Found ${dirs.length} token directories`);

    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const dir of dirs) {
        const dirPath = path.join(KIRO_DIR, dir.name);
        const files = await fs.readdir(dirPath);
        const jsonFile = files.find(f => f.endsWith('.json'));

        if (!jsonFile) {
            console.log(`[Skip] ${dir.name}: JSON file not found`);
            skipped++;
            continue;
        }

        const filePath = path.join(dirPath, jsonFile);

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);

            // Generate unique name (using timestamp from directory name)
            const timestamp = dir.name.split('_')[0];
            const name = `kiro-${data.authMethod || 'builder-id'}-${timestamp}`;

            // Check if already exists
            const existing = await store.getByName(name);
            if (existing) {
                console.log(`[Skip] ${name}: already exists`);
                skipped++;
                continue;
            }

            // Insert into database
            const id = await store.add({
                name: name,
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                clientId: data.clientId || null,
                clientSecret: data.clientSecret || null,
                authMethod: data.authMethod || 'builder-id',
                provider: 'BuilderID',
                region: data.region || 'us-east-1',
                expiresAt: data.expiresAt || null
            });

            console.log(`[Import] ${name} (ID: ${id})`);
            imported++;

        } catch (error) {
            console.error(`[Failed] ${dir.name}: ${error.message}`);
            failed++;
        }
    }

    console.log('\n========== Import Complete ==========');
    console.log(`Successfully imported: ${imported}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${dirs.length}`);

    process.exit(0);
}

importKiroTokens().catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
});
