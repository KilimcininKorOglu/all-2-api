import mysql from 'mysql2/promise';
import path from 'path';
import crypto from 'crypto';

// MySQL connection configuration
const DB_CONFIG = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'kiro_api',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: process.env.MYSQL_TIMEZONE || '+00:00',
    dateStrings: true
};

let pool = null;

/**
 * Initialize database connection pool
 */
export async function initDatabase() {
    if (pool) return pool;

    pool = mysql.createPool(DB_CONFIG);

    // Create credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            profile_arn VARCHAR(512),
            client_id VARCHAR(255),
            client_secret TEXT,
            auth_method VARCHAR(50) DEFAULT 'social',
            provider VARCHAR(50) DEFAULT 'Google',
            region VARCHAR(50) DEFAULT 'us-east-1',
            expires_at VARCHAR(50),
            is_active TINYINT DEFAULT 1,
            usage_data JSON,
            usage_updated_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Add provider column (if not exists)
    try {
        await pool.execute(`ALTER TABLE credentials ADD COLUMN provider VARCHAR(50) DEFAULT 'Google' AFTER auth_method`);
    } catch (e) {
        // Column already exists, ignore error
    }

    // Add sso_start_url column for IAM Identity Center (if not exists)
    try {
        await pool.execute(`ALTER TABLE credentials ADD COLUMN sso_start_url VARCHAR(512) COMMENT 'IAM Identity Center start URL' AFTER region`);
    } catch (e) {
        // Column already exists, ignore error
    }

    // Create error credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS error_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            original_id INT,
            name VARCHAR(255) NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            profile_arn VARCHAR(512),
            client_id VARCHAR(255),
            client_secret TEXT,
            auth_method VARCHAR(50) DEFAULT 'social',
            region VARCHAR(50) DEFAULT 'us-east-1',
            expires_at VARCHAR(50),
            error_message TEXT,
            error_count INT DEFAULT 1,
            last_error_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Add sso_start_url column to error_credentials for IAM Identity Center (if not exists)
    try {
        await pool.execute(`ALTER TABLE error_credentials ADD COLUMN sso_start_url VARCHAR(512) COMMENT 'IAM Identity Center start URL' AFTER region`);
    } catch (e) {
        // Column already exists, ignore error
    }

    // Create users table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INT PRIMARY KEY AUTO_INCREMENT,
            username VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            is_admin TINYINT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create API keys table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS api_keys (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            key_value VARCHAR(255) NOT NULL,
            key_hash VARCHAR(255) NOT NULL UNIQUE,
            key_prefix VARCHAR(50) NOT NULL,
            is_active TINYINT DEFAULT 1,
            last_used_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            daily_limit INT DEFAULT 0,
            monthly_limit INT DEFAULT 0,
            total_limit INT DEFAULT 0,
            concurrent_limit INT DEFAULT 0,
            rate_limit INT DEFAULT 0,
            daily_cost_limit DECIMAL(10,2) DEFAULT 0,
            monthly_cost_limit DECIMAL(10,2) DEFAULT 0,
            total_cost_limit DECIMAL(10,2) DEFAULT 0,
            expires_in_days INT DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create API logs table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS api_logs (
            id INT PRIMARY KEY AUTO_INCREMENT,
            request_id VARCHAR(100) NOT NULL,
            api_key_id INT,
            api_key_prefix VARCHAR(50),
            credential_id INT,
            credential_name VARCHAR(255),
            ip_address VARCHAR(50),
            user_agent TEXT,
            method VARCHAR(10) DEFAULT 'POST',
            path VARCHAR(255) DEFAULT '/v1/messages',
            model VARCHAR(100),
            stream TINYINT DEFAULT 0,
            input_tokens INT DEFAULT 0,
            output_tokens INT DEFAULT 0,
            request_messages MEDIUMTEXT,
            response_content MEDIUMTEXT,
            status_code INT DEFAULT 200,
            error_message TEXT,
            duration_ms INT DEFAULT 0,
            source VARCHAR(50) DEFAULT 'api',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_created_at (created_at),
            INDEX idx_api_key_id (api_key_id),
            INDEX idx_ip_address (ip_address),
            INDEX idx_request_id (request_id),
            INDEX idx_source (source)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create Gemini Antigravity credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS gemini_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255),
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            project_id VARCHAR(255),
            expires_at VARCHAR(50),
            is_active TINYINT DEFAULT 1,
            usage_data JSON,
            usage_updated_at DATETIME,
            quota_data JSON COMMENT 'Model-based quota info: {modelId: {remainingFraction, resetTime}}',
            quota_updated_at DATETIME COMMENT 'When quota was last fetched',
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Add quota columns to gemini_credentials if not exists (migration)
    try {
        await pool.execute(`ALTER TABLE gemini_credentials ADD COLUMN quota_data JSON COMMENT 'Model-based quota info' AFTER usage_updated_at`);
    } catch (e) { /* Column may already exist */ }
    try {
        await pool.execute(`ALTER TABLE gemini_credentials ADD COLUMN quota_updated_at DATETIME COMMENT 'When quota was last fetched' AFTER quota_data`);
    } catch (e) { /* Column may already exist */ }

    // Add source column to api_logs (migration)
    try {
        await pool.execute(`ALTER TABLE api_logs ADD COLUMN source VARCHAR(50) DEFAULT 'api' AFTER duration_ms`);
    } catch (e) { /* Column may already exist */ }
    try {
        await pool.execute(`ALTER TABLE api_logs ADD INDEX idx_source (source)`);
    } catch (e) { /* Index may already exist */ }

    // Create Gemini error credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS gemini_error_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            original_id INT,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            project_id VARCHAR(255),
            expires_at VARCHAR(50),
            error_message TEXT,
            error_count INT DEFAULT 1,
            last_error_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create Orchids credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS orchids_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255),
            client_jwt TEXT NOT NULL,
            clerk_session_id VARCHAR(255),
            user_id VARCHAR(255),
            expires_at VARCHAR(50),
            is_active TINYINT DEFAULT 1,
            weight INT DEFAULT 1,
            request_count BIGINT DEFAULT 0,
            success_count BIGINT DEFAULT 0,
            failure_count BIGINT DEFAULT 0,
            last_used_at DATETIME,
            usage_data JSON,
            usage_updated_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Add Orchids credentials table new fields (migration compatible)
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN weight INT DEFAULT 1 AFTER is_active`);
    } catch (e) { /* Field may already exist */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN request_count BIGINT DEFAULT 0 AFTER weight`);
    } catch (e) { /* Field may already exist */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN success_count BIGINT DEFAULT 0 AFTER request_count`);
    } catch (e) { /* Field may already exist */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN failure_count BIGINT DEFAULT 0 AFTER success_count`);
    } catch (e) { /* Field may already exist */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN last_used_at DATETIME AFTER failure_count`);
    } catch (e) { /* Field may already exist */ }

    // Create Orchids error credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS orchids_error_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            original_id INT,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            client_jwt TEXT NOT NULL,
            clerk_session_id VARCHAR(255),
            user_id VARCHAR(255),
            expires_at VARCHAR(50),
            error_message TEXT,
            error_count INT DEFAULT 1,
            last_error_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create Warp credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS warp_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255),
            refresh_token TEXT NOT NULL,
            access_token TEXT,
            token_expires_at DATETIME,
            is_active TINYINT DEFAULT 1,
            use_count INT DEFAULT 0,
            last_used_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            quota_limit INT DEFAULT 0,
            quota_used INT DEFAULT 0,
            quota_updated_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // Add quota fields (if not exists)
    try {
        await pool.execute(`ALTER TABLE warp_credentials ADD COLUMN quota_limit INT DEFAULT 0`);
    } catch (e) { /* Field already exists */ }
    try {
        await pool.execute(`ALTER TABLE warp_credentials ADD COLUMN quota_used INT DEFAULT 0`);
    } catch (e) { /* Field already exists */ }
    try {
        await pool.execute(`ALTER TABLE warp_credentials ADD COLUMN quota_updated_at DATETIME`);
    } catch (e) { /* Field already exists */ }

    // Create Warp request statistics table (without message content)
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS warp_request_stats (
            id INT PRIMARY KEY AUTO_INCREMENT,
            credential_id INT NOT NULL,
            api_key_id INT,
            endpoint VARCHAR(100) NOT NULL,
            model VARCHAR(100) NOT NULL,
            is_stream TINYINT DEFAULT 0,
            input_tokens INT DEFAULT 0,
            output_tokens INT DEFAULT 0,
            total_tokens INT DEFAULT 0,
            duration_ms INT DEFAULT 0,
            status VARCHAR(20) DEFAULT 'success',
            error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_credential_id (credential_id),
            INDEX idx_api_key_id (api_key_id),
            INDEX idx_created_at (created_at),
            INDEX idx_model (model)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create Warp error credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS warp_error_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            original_id INT,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            refresh_token TEXT NOT NULL,
            access_token TEXT,
            error_message TEXT,
            error_count INT DEFAULT 1,
            last_error_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create site settings table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS site_settings (
            id INT PRIMARY KEY DEFAULT 1,
            site_name VARCHAR(50) DEFAULT 'Kiro',
            site_logo VARCHAR(10) DEFAULT 'K',
            site_subtitle VARCHAR(100) DEFAULT 'Account Manager',
            log_level ENUM('DEBUG','INFO','WARN','ERROR') DEFAULT 'INFO',
            log_enabled TINYINT DEFAULT 1,
            log_console TINYINT DEFAULT 1,
            disable_credential_lock TINYINT DEFAULT 0,
            warp_debug TINYINT DEFAULT 0,
            orchids_debug TINYINT DEFAULT 0,
            token_refresh_interval INT DEFAULT 30 COMMENT 'Token refresh interval in minutes',
            token_refresh_threshold INT DEFAULT 10 COMMENT 'Refresh tokens expiring within N minutes',
            quota_refresh_interval INT DEFAULT 5 COMMENT 'Quota refresh interval in minutes',
            selection_strategy ENUM('hybrid','sticky','round-robin') DEFAULT 'hybrid' COMMENT 'Pool selection strategy',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migration: Add new columns to existing site_settings table
    const newColumns = [
        { name: 'log_level', sql: "ADD COLUMN log_level ENUM('DEBUG','INFO','WARN','ERROR') DEFAULT 'INFO'" },
        { name: 'log_enabled', sql: 'ADD COLUMN log_enabled TINYINT DEFAULT 1' },
        { name: 'log_console', sql: 'ADD COLUMN log_console TINYINT DEFAULT 1' },
        { name: 'disable_credential_lock', sql: 'ADD COLUMN disable_credential_lock TINYINT DEFAULT 0' },
        { name: 'warp_debug', sql: 'ADD COLUMN warp_debug TINYINT DEFAULT 0' },
        { name: 'orchids_debug', sql: 'ADD COLUMN orchids_debug TINYINT DEFAULT 0' },
        { name: 'token_refresh_interval', sql: "ADD COLUMN token_refresh_interval INT DEFAULT 30 COMMENT 'Token refresh interval in minutes'" },
        { name: 'token_refresh_threshold', sql: "ADD COLUMN token_refresh_threshold INT DEFAULT 10 COMMENT 'Refresh tokens expiring within N minutes'" },
        { name: 'quota_refresh_interval', sql: "ADD COLUMN quota_refresh_interval INT DEFAULT 5 COMMENT 'Quota refresh interval in minutes'" },
        { name: 'selection_strategy', sql: "ADD COLUMN selection_strategy ENUM('hybrid','sticky','round-robin') DEFAULT 'hybrid' COMMENT 'Pool selection strategy'" },
        { name: 'default_provider', sql: "ADD COLUMN default_provider VARCHAR(20) DEFAULT 'kiro' COMMENT 'Default provider for routing'" },
        { name: 'enabled_providers', sql: "ADD COLUMN enabled_providers JSON COMMENT 'List of enabled providers'" },
        { name: 'provider_priority', sql: "ADD COLUMN provider_priority JSON COMMENT 'Provider fallback priority order'" },
        { name: 'model_routing', sql: "ADD COLUMN model_routing JSON COMMENT 'Custom model to provider mapping rules'" }
    ];
    for (const col of newColumns) {
        try {
            await pool.execute(`ALTER TABLE site_settings ${col.sql}`);
        } catch (e) { /* Column may already exist */ }
    }

    // Ensure site settings table has default record
    try {
        await pool.execute(`INSERT IGNORE INTO site_settings (id, site_name, site_logo, site_subtitle) VALUES (1, 'Hermes', 'H', 'Account Manager')`);
    } catch (e) {
        // Ignore error
    }

    // Create Vertex AI credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS vertex_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            project_id VARCHAR(255) NOT NULL,
            client_email VARCHAR(255) NOT NULL,
            private_key TEXT NOT NULL,
            region VARCHAR(50) DEFAULT 'global',
            is_active TINYINT DEFAULT 1,
            use_count INT DEFAULT 0,
            last_used_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create model pricing configuration table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS model_pricing (
            id INT PRIMARY KEY AUTO_INCREMENT,
            model_name VARCHAR(255) NOT NULL UNIQUE,
            display_name VARCHAR(255),
            provider VARCHAR(50) DEFAULT 'anthropic',
            input_price DECIMAL(10, 4) NOT NULL COMMENT 'Input price (USD per million tokens)',
            output_price DECIMAL(10, 4) NOT NULL COMMENT 'Output price (USD per million tokens)',
            is_active TINYINT DEFAULT 1,
            sort_order INT DEFAULT 0,
            source ENUM('default', 'remote', 'manual') DEFAULT 'manual' COMMENT 'Price source',
            is_custom TINYINT DEFAULT 0 COMMENT 'User has customized this price',
            remote_updated_at DATETIME COMMENT 'When remote price was last synced',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migration: Add new columns to model_pricing if not exists
    try {
        await pool.execute(`ALTER TABLE model_pricing ADD COLUMN source ENUM('default', 'remote', 'manual') DEFAULT 'manual' COMMENT 'Price source'`);
    } catch (e) { /* Column already exists */ }
    try {
        await pool.execute(`ALTER TABLE model_pricing ADD COLUMN is_custom TINYINT DEFAULT 0 COMMENT 'User has customized this price'`);
    } catch (e) { /* Column already exists */ }
    try {
        await pool.execute(`ALTER TABLE model_pricing ADD COLUMN remote_updated_at DATETIME COMMENT 'When remote price was last synced'`);
    } catch (e) { /* Column already exists */ }

    // Create model aliases table for unified model name mapping
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS model_aliases (
            id INT PRIMARY KEY AUTO_INCREMENT,
            alias VARCHAR(255) NOT NULL COMMENT 'User-facing model name (e.g., opus-4.5, gpt-4)',
            provider VARCHAR(50) NOT NULL COMMENT 'Target provider (kiro, anthropic, gemini, etc.)',
            target_model VARCHAR(255) NOT NULL COMMENT 'Actual model name for the provider',
            description VARCHAR(500) COMMENT 'Optional description',
            is_active TINYINT DEFAULT 1,
            priority INT DEFAULT 0 COMMENT 'Higher priority aliases are checked first',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_alias_provider (alias, provider),
            INDEX idx_provider (provider),
            INDEX idx_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Note: remote_pricing_cache table is deprecated, keeping for backward compatibility
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS remote_pricing_cache (
            id INT PRIMARY KEY AUTO_INCREMENT,
            model_id VARCHAR(255) NOT NULL UNIQUE COMMENT 'Model identifier (lowercase)',
            input_price DECIMAL(10, 4) NOT NULL COMMENT 'Input price (USD per million tokens)',
            output_price DECIMAL(10, 4) NOT NULL COMMENT 'Output price (USD per million tokens)',
            vendor VARCHAR(100) DEFAULT 'unknown',
            fetched_at DATETIME NOT NULL COMMENT 'When the data was fetched from remote',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_vendor (vendor),
            INDEX idx_fetched_at (fetched_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create Anthropic API credentials table (direct API access with custom endpoints)
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS anthropic_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255),
            access_token TEXT NOT NULL COMMENT 'Anthropic API key (sk-ant-*)',
            api_base_url VARCHAR(500) COMMENT 'Custom API base URL (optional)',
            expires_at VARCHAR(50),
            is_active TINYINT DEFAULT 1,
            use_count INT DEFAULT 0,
            last_used_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            rate_limits JSON COMMENT 'Rate limit info from API',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create Anthropic error credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS anthropic_error_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            original_id INT,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            access_token TEXT NOT NULL,
            api_base_url VARCHAR(500),
            error_message TEXT,
            error_count INT DEFAULT 1,
            last_error_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create Amazon Bedrock credentials table
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS bedrock_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            access_key_id VARCHAR(255) NOT NULL,
            secret_access_key TEXT NOT NULL,
            session_token TEXT,
            region VARCHAR(50) DEFAULT 'us-east-1',
            is_active TINYINT DEFAULT 1,
            use_count INT DEFAULT 0,
            last_used_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create account health tracking table (for selection module)
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS account_health (
            id INT PRIMARY KEY AUTO_INCREMENT,
            provider VARCHAR(50) NOT NULL,
            credential_id INT NOT NULL,
            health_score INT DEFAULT 70,
            consecutive_failures INT DEFAULT 0,
            last_success_at DATETIME,
            last_failure_at DATETIME,
            last_error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_provider_credential (provider, credential_id),
            INDEX idx_provider (provider),
            INDEX idx_health_score (health_score)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create token bucket rate limiting table (for selection module)
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS token_buckets (
            id INT PRIMARY KEY AUTO_INCREMENT,
            provider VARCHAR(50) NOT NULL,
            credential_id INT NOT NULL,
            tokens DECIMAL(5,2) DEFAULT 50.00,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_provider_credential (provider, credential_id),
            INDEX idx_provider (provider)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create selection configuration table (for selection module)
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS selection_config (
            id INT PRIMARY KEY AUTO_INCREMENT,
            provider VARCHAR(50) NOT NULL UNIQUE,
            strategy VARCHAR(50) DEFAULT 'hybrid',
            health_weight DECIMAL(3,1) DEFAULT 2.0,
            token_weight DECIMAL(3,1) DEFAULT 5.0,
            quota_weight DECIMAL(3,1) DEFAULT 3.0,
            lru_weight DECIMAL(3,1) DEFAULT 0.1,
            min_health_threshold INT DEFAULT 50,
            token_bucket_max INT DEFAULT 50,
            token_regen_per_minute DECIMAL(5,2) DEFAULT 6.00,
            quota_low_threshold DECIMAL(3,2) DEFAULT 0.10,
            quota_critical_threshold DECIMAL(3,2) DEFAULT 0.05,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create thinking signature cache table (for selection module)
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS thinking_signature_cache (
            id INT PRIMARY KEY AUTO_INCREMENT,
            signature_hash VARCHAR(64) NOT NULL UNIQUE,
            signature_value TEXT NOT NULL,
            model_family VARCHAR(20),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            INDEX idx_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create sessions table (for persistent login sessions)
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
            token VARCHAR(64) PRIMARY KEY,
            user_id INT NOT NULL,
            user_agent VARCHAR(512),
            ip_address VARCHAR(45),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            INDEX idx_user_id (user_id),
            INDEX idx_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Add columns if they don't exist (for existing databases)
    try {
        await pool.execute(`ALTER TABLE sessions ADD COLUMN user_agent VARCHAR(512) AFTER user_id`);
    } catch (e) { /* column already exists */ }
    try {
        await pool.execute(`ALTER TABLE sessions ADD COLUMN ip_address VARCHAR(45) AFTER user_agent`);
    } catch (e) { /* column already exists */ }

    return pool;
}

/**
 * Get database connection pool
 */
export async function getDatabase() {
    if (!pool) {
        await initDatabase();
    }
    return pool;
}

/**
 * Close database connection pool
 */
export async function closeDatabase() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

/**
 * Credential management class
 */
export class CredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new CredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO credentials (name, access_token, refresh_token, profile_arn, client_id, client_secret, auth_method, provider, region, sso_start_url, expires_at, usage_data, usage_updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.accessToken,
            credential.refreshToken || null,
            credential.profileArn || null,
            credential.clientId || null,
            credential.clientSecret || null,
            credential.authMethod || 'social',
            credential.provider || 'Google',
            credential.region || 'us-east-1',
            credential.ssoStartUrl || null,
            credential.expiresAt || null,
            credential.usageData ? JSON.stringify(credential.usageData) : null,
            credential.usageData ? new Date() : null
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const toNull = (val) => val === undefined ? null : val;
        await this.db.execute(`
            UPDATE credentials SET
                name = COALESCE(?, name),
                access_token = COALESCE(?, access_token),
                refresh_token = COALESCE(?, refresh_token),
                profile_arn = COALESCE(?, profile_arn),
                client_id = COALESCE(?, client_id),
                client_secret = COALESCE(?, client_secret),
                auth_method = COALESCE(?, auth_method),
                provider = COALESCE(?, provider),
                region = COALESCE(?, region),
                sso_start_url = COALESCE(?, sso_start_url),
                expires_at = COALESCE(?, expires_at)
            WHERE id = ?
        `, [
            toNull(credential.name),
            toNull(credential.accessToken),
            toNull(credential.refreshToken),
            toNull(credential.profileArn),
            toNull(credential.clientId),
            toNull(credential.clientSecret),
            toNull(credential.authMethod),
            toNull(credential.provider),
            toNull(credential.region),
            toNull(credential.ssoStartUrl),
            toNull(credential.expiresAt),
            id
        ]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM credentials WHERE is_active = 1 ORDER BY error_count ASC, updated_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async toggleActive(id) {
        const [rows] = await this.db.execute('SELECT is_active FROM credentials WHERE id = ?', [id]);
        if (rows.length === 0) return false;
        const newStatus = rows[0].is_active === 1 ? 0 : 1;
        await this.db.execute('UPDATE credentials SET is_active = ? WHERE id = ?', [newStatus, id]);
        return newStatus === 1;
    }

    async enable(id) {
        await this.db.execute('UPDATE credentials SET is_active = 1 WHERE id = ?', [id]);
    }

    async disable(id) {
        await this.db.execute('UPDATE credentials SET is_active = 0 WHERE id = ?', [id]);
    }

    async importFromFile(filePath, name) {
        const fs = await import('fs');

        // Security: Validate file path to prevent path traversal attacks
        const normalizedPath = path.normalize(filePath);

        // Block path traversal attempts
        if (normalizedPath.includes('..')) {
            throw new Error('Invalid file path: path traversal not allowed');
        }

        // Block access to sensitive system directories
        const blockedPaths = ['/etc/', '/var/', '/proc/', '/sys/', '/root/', '/home/'];
        const lowerPath = normalizedPath.toLowerCase();
        for (const blocked of blockedPaths) {
            if (lowerPath.startsWith(blocked)) {
                throw new Error('Invalid file path: access to system directories not allowed');
            }
        }

        // Verify file exists and is readable
        if (!fs.existsSync(normalizedPath)) {
            throw new Error('File does not exist');
        }

        const content = fs.readFileSync(normalizedPath, 'utf8');
        const creds = JSON.parse(content);

        return this.add({
            name: name || `imported_${Date.now()}`,
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            profileArn: creds.profileArn,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            authMethod: creds.authMethod,
            region: creds.region,
            expiresAt: creds.expiresAt
        });
    }

    async batchImportSocialAccounts(accounts, region = 'us-east-1') {
        const results = {
            success: 0,
            failed: 0,
            errors: [],
            imported: []
        };

        for (const account of accounts) {
            try {
                if (!account.email || !account.refreshToken) {
                    results.failed++;
                    results.errors.push({
                        email: account.email || 'unknown',
                        error: 'Missing email or refreshToken'
                    });
                    continue;
                }

                const provider = account.provider || 'Google';

                const existing = await this.getByName(account.email);
                if (existing) {
                    await this.update(existing.id, {
                        refreshToken: account.refreshToken,
                        authMethod: 'social',
                        provider: provider,
                        region: region
                    });
                    results.success++;
                    results.imported.push({
                        email: account.email,
                        id: existing.id,
                        action: 'updated'
                    });
                } else {
                    const id = await this.add({
                        name: account.email,
                        accessToken: account.refreshToken,
                        refreshToken: account.refreshToken,
                        authMethod: 'social',
                        provider: provider,
                        region: region
                    });
                    results.success++;
                    results.imported.push({
                        email: account.email,
                        id: id,
                        action: 'created'
                    });
                }
            } catch (error) {
                results.failed++;
                results.errors.push({
                    email: account.email || 'unknown',
                    error: error.message
                });
            }
        }

        return results;
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            email: row.name,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            profileArn: row.profile_arn,
            clientId: row.client_id,
            clientSecret: row.client_secret,
            authMethod: row.auth_method,
            provider: row.provider || 'Google',
            region: row.region,
            ssoStartUrl: row.sso_start_url,
            expiresAt: row.expires_at,
            isActive: row.is_active === 1,
            usageData: row.usage_data ? (typeof row.usage_data === 'string' ? JSON.parse(row.usage_data) : row.usage_data) : null,
            usageUpdatedAt: row.usage_updated_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    async updateUsage(id, usageData) {
        const usageJson = JSON.stringify(usageData);
        await this.db.execute(`
            UPDATE credentials SET
                usage_data = ?,
                usage_updated_at = NOW()
            WHERE id = ?
        `, [usageJson, id]);
    }

    _mapErrorRow(row) {
        return {
            id: row.id,
            originalId: row.original_id,
            name: row.name,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            profileArn: row.profile_arn,
            clientId: row.client_id,
            clientSecret: row.client_secret,
            authMethod: row.auth_method,
            region: row.region,
            ssoStartUrl: row.sso_start_url,
            expiresAt: row.expires_at,
            errorMessage: row.error_message,
            errorCount: row.error_count,
            lastErrorAt: row.last_error_at,
            createdAt: row.created_at
        };
    }

    async moveToError(id, errorMessage) {
        const credential = await this.getById(id);
        if (!credential) return null;

        const [existingError] = await this.db.execute(
            'SELECT id, error_count FROM error_credentials WHERE original_id = ?',
            [id]
        );

        if (existingError.length > 0) {
            const errorId = existingError[0].id;
            const errorCount = existingError[0].error_count + 1;
            await this.db.execute(`
                UPDATE error_credentials SET
                    error_message = ?,
                    error_count = ?,
                    last_error_at = NOW()
                WHERE id = ?
            `, [errorMessage, errorCount, errorId]);
        } else {
            await this.db.execute(`
                INSERT INTO error_credentials (
                    original_id, name, access_token, refresh_token, profile_arn,
                    client_id, client_secret, auth_method, region, sso_start_url, expires_at,
                    error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                credential.id,
                credential.name,
                credential.accessToken,
                credential.refreshToken,
                credential.profileArn,
                credential.clientId,
                credential.clientSecret,
                credential.authMethod,
                credential.region,
                credential.ssoStartUrl,
                credential.expiresAt,
                errorMessage,
                credential.createdAt
            ]);
        }

        await this.delete(id);
        return credential;
    }

    async restoreFromError(errorId, newAccessToken, newRefreshToken, newExpiresAt) {
        const [rows] = await this.db.execute('SELECT * FROM error_credentials WHERE id = ?', [errorId]);
        if (rows.length === 0) return null;

        const errorCred = this._mapErrorRow(rows[0]);

        const [result] = await this.db.execute(`
            INSERT INTO credentials (
                name, access_token, refresh_token, profile_arn,
                client_id, client_secret, auth_method, region, sso_start_url, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            errorCred.name,
            newAccessToken || errorCred.accessToken,
            newRefreshToken || errorCred.refreshToken,
            errorCred.profileArn,
            errorCred.clientId,
            errorCred.clientSecret,
            errorCred.authMethod,
            errorCred.region,
            errorCred.ssoStartUrl,
            newExpiresAt || errorCred.expiresAt,
            errorCred.createdAt
        ]);

        await this.db.execute('DELETE FROM error_credentials WHERE id = ?', [errorId]);
        return result.insertId;
    }

    async getAllErrors() {
        const [rows] = await this.db.execute('SELECT * FROM error_credentials ORDER BY last_error_at DESC');
        return rows.map(row => this._mapErrorRow(row));
    }

    async getErrorById(id) {
        const [rows] = await this.db.execute('SELECT * FROM error_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapErrorRow(rows[0]);
    }

    async deleteError(id) {
        await this.db.execute('DELETE FROM error_credentials WHERE id = ?', [id]);
    }

    async incrementUseCount(id) {
        await this.db.execute(`
            UPDATE credentials SET use_count = use_count + 1 WHERE id = ?
        `, [id]);
    }

    async updateErrorToken(id, accessToken, refreshToken, expiresAt) {
        const toNull = (val) => val === undefined ? null : val;
        await this.db.execute(`
            UPDATE error_credentials SET
                access_token = COALESCE(?, access_token),
                refresh_token = COALESCE(?, refresh_token),
                expires_at = COALESCE(?, expires_at)
            WHERE id = ?
        `, [toNull(accessToken), toNull(refreshToken), toNull(expiresAt), id]);
    }
}

/**
 * User management class
 */
export class UserStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new UserStore(database);
    }

    async create(username, passwordHash, isAdmin = false) {
        try {
            const [result] = await this.db.execute(`
                INSERT INTO users (username, password_hash, is_admin)
                VALUES (?, ?, ?)
            `, [username, passwordHash, isAdmin ? 1 : 0]);
            return result.insertId;
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('Username already exists');
            }
            throw error;
        }
    }

    async getByUsername(username) {
        const [rows] = await this.db.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM users WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM users ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async updatePassword(id, passwordHash) {
        await this.db.execute(`
            UPDATE users SET password_hash = ?
            WHERE id = ?
        `, [passwordHash, id]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM api_keys WHERE user_id = ?', [id]);
        await this.db.execute('DELETE FROM users WHERE id = ?', [id]);
    }

    async hasUsers() {
        const [rows] = await this.db.execute('SELECT COUNT(*) as count FROM users');
        return rows[0].count > 0;
    }

    _mapRow(row) {
        return {
            id: row.id,
            username: row.username,
            passwordHash: row.password_hash,
            isAdmin: row.is_admin === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * API key management class
 */
export class ApiKeyStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new ApiKeyStore(database);
    }

    async create(userId, name, keyValue, keyHash, keyPrefix) {
        const [result] = await this.db.execute(`
            INSERT INTO api_keys (user_id, name, key_value, key_hash, key_prefix)
            VALUES (?, ?, ?, ?, ?)
        `, [userId, name, keyValue, keyHash, keyPrefix]);
        return result.insertId;
    }

    async getByKeyHash(keyHash) {
        const [rows] = await this.db.execute('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1', [keyHash]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByUserId(userId) {
        const [rows] = await this.db.execute('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC', [userId]);
        return rows.map(row => this._mapRow(row));
    }

    async getAll() {
        const [rows] = await this.db.execute(`
            SELECT ak.*, u.username
            FROM api_keys ak
            LEFT JOIN users u ON ak.user_id = u.id
            ORDER BY ak.created_at DESC
        `);
        return rows.map(row => this._mapRowWithUser(row));
    }

    async updateLastUsed(id) {
        await this.db.execute(`
            UPDATE api_keys SET last_used_at = NOW()
            WHERE id = ?
        `, [id]);
    }

    async disable(id) {
        await this.db.execute('UPDATE api_keys SET is_active = 0 WHERE id = ?', [id]);
    }

    async enable(id) {
        await this.db.execute('UPDATE api_keys SET is_active = 1 WHERE id = ?', [id]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM api_keys WHERE id = ?', [id]);
    }

    async updateLimits(id, limits) {
        const { dailyLimit, monthlyLimit, totalLimit, concurrentLimit, rateLimit, dailyCostLimit, monthlyCostLimit, totalCostLimit, expiresInDays } = limits;
        await this.db.execute(`
            UPDATE api_keys SET
                daily_limit = COALESCE(?, daily_limit),
                monthly_limit = COALESCE(?, monthly_limit),
                total_limit = COALESCE(?, total_limit),
                concurrent_limit = COALESCE(?, concurrent_limit),
                rate_limit = COALESCE(?, rate_limit),
                daily_cost_limit = COALESCE(?, daily_cost_limit),
                monthly_cost_limit = COALESCE(?, monthly_cost_limit),
                total_cost_limit = COALESCE(?, total_cost_limit),
                expires_in_days = COALESCE(?, expires_in_days)
            WHERE id = ?
        `, [
            dailyLimit ?? null,
            monthlyLimit ?? null,
            totalLimit ?? null,
            concurrentLimit ?? null,
            rateLimit ?? null,
            dailyCostLimit ?? null,
            monthlyCostLimit ?? null,
            totalCostLimit ?? null,
            expiresInDays ?? null,
            id
        ]);
    }

    /**
     * Renew - add validity period days
     * @param {number} id - API key ID
     * @param {number} days - Days to add
     * @returns {object} Renewal result, containing new expiration information
     */
    async renew(id, days) {
        if (!days || days <= 0) {
            throw new Error('Renewal days must be greater than 0');
        }

        const key = await this.getById(id);
        if (!key) {
            throw new Error('Key does not exist');
        }

        // Add to existing days directly
        const previousDays = key.expiresInDays || 0;
        const newExpiresInDays = previousDays + days;

        await this.db.execute(`
            UPDATE api_keys SET expires_in_days = ? WHERE id = ?
        `, [newExpiresInDays, id]);

        // Calculate new expiration date and remaining days (for display)
        // createdAt is a Beijing time string stored in database "YYYY-MM-DD HH:mm:ss"
        const now = new Date();
        const createDateStr = key.createdAt.replace(' ', 'T') + '+08:00';
        const createDate = new Date(createDateStr);
        const newExpireDate = new Date(createDate.getTime() + newExpiresInDays * 24 * 60 * 60 * 1000);
        const remainingDays = Math.max(0, Math.ceil((newExpireDate - now) / (24 * 60 * 60 * 1000)));

        // Format expiration time as Beijing time string
        const expireDateLocal = new Date(newExpireDate.getTime() + 8 * 60 * 60 * 1000);
        const expireDateStr = expireDateLocal.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

        return {
            previousExpiresInDays: previousDays,
            newExpiresInDays: newExpiresInDays,
            addedDays: days,
            expireDate: expireDateStr,
            remainingDays: remainingDays
        };
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM api_keys WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    _mapRow(row) {
        return {
            id: row.id,
            userId: row.user_id,
            name: row.name,
            keyValue: row.key_value,
            keyHash: row.key_hash,
            keyPrefix: row.key_prefix,
            isActive: row.is_active === 1,
            lastUsedAt: row.last_used_at,
            createdAt: row.created_at,
            dailyLimit: row.daily_limit || 0,
            monthlyLimit: row.monthly_limit || 0,
            totalLimit: row.total_limit || 0,
            concurrentLimit: row.concurrent_limit || 0,
            rateLimit: row.rate_limit || 0,
            dailyCostLimit: parseFloat(row.daily_cost_limit) || 0,
            monthlyCostLimit: parseFloat(row.monthly_cost_limit) || 0,
            totalCostLimit: parseFloat(row.total_cost_limit) || 0,
            expiresInDays: row.expires_in_days || 0
        };
    }

    _mapRowWithUser(row) {
        return {
            id: row.id,
            userId: row.user_id,
            username: row.username,
            name: row.name,
            keyValue: row.key_value,
            keyHash: row.key_hash,
            keyPrefix: row.key_prefix,
            isActive: row.is_active === 1,
            lastUsedAt: row.last_used_at,
            createdAt: row.created_at,
            dailyLimit: row.daily_limit || 0,
            monthlyLimit: row.monthly_limit || 0,
            totalLimit: row.total_limit || 0,
            concurrentLimit: row.concurrent_limit || 0,
            rateLimit: row.rate_limit || 0,
            dailyCostLimit: parseFloat(row.daily_cost_limit) || 0,
            monthlyCostLimit: parseFloat(row.monthly_cost_limit) || 0,
            totalCostLimit: parseFloat(row.total_cost_limit) || 0,
            expiresInDays: row.expires_in_days || 0
        };
    }
}

/**
 * API log management class
 */
export class ApiLogStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new ApiLogStore(database);
    }

    async create(logData) {
        const [result] = await this.db.execute(`
            INSERT INTO api_logs (
                request_id, api_key_id, api_key_prefix, credential_id, credential_name,
                ip_address, user_agent, method, path, model, stream,
                input_tokens, output_tokens,
                status_code, error_message, duration_ms, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            logData.requestId || null,
            logData.apiKeyId !== undefined ? logData.apiKeyId : null,
            logData.apiKeyPrefix !== undefined ? logData.apiKeyPrefix : null,
            logData.credentialId !== undefined ? logData.credentialId : null,
            logData.credentialName !== undefined ? logData.credentialName : null,
            logData.clientIp || logData.ipAddress || null,
            logData.userAgent !== undefined ? logData.userAgent : null,
            logData.method || 'POST',
            logData.endpoint || logData.path || '/v1/messages',
            logData.model !== undefined ? logData.model : null,
            logData.isStream || logData.stream ? 1 : 0,
            logData.inputTokens || 0,
            logData.outputTokens || 0,
            logData.statusCode || 200,
            logData.errorMessage !== undefined ? logData.errorMessage : null,
            logData.durationMs || 0,
            logData.source || 'api'
        ]);
        return result.insertId;
    }

    async getAll(options = {}) {
        const { page = 1, pageSize = 100, apiKeyId, ipAddress, startDate, endDate } = options;
        const limit = parseInt(pageSize) || 100;
        const offset = ((parseInt(page) || 1) - 1) * limit;

        let query = 'SELECT * FROM api_logs WHERE 1=1';
        const params = [];

        if (apiKeyId) {
            query += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (ipAddress) {
            query += ' AND ip_address = ?';
            params.push(ipAddress);
        }
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        // Get total count
        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
        const [countRows] = await this.db.execute(countQuery, params);
        const total = Number(countRows[0].total) || 0;

        query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        const [rows] = await this.db.execute(query, params);

        return {
            logs: rows.map(row => this._mapRow(row)),
            total,
            page: parseInt(page) || 1,
            pageSize: limit,
            totalPages: Math.ceil(total / limit)
        };
    }

    async getByApiKeyId(apiKeyId, limit = 100) {
        const [rows] = await this.db.execute(
            `SELECT * FROM api_logs WHERE api_key_id = ? ORDER BY created_at DESC LIMIT ${parseInt(limit)}`,
            [apiKeyId]
        );
        return rows.map(row => this._mapRow(row));
    }

    async getStats(options = {}) {
        const { apiKeyId, startDate, endDate } = options;
        let query = `
            SELECT
                COUNT(*) as total_requests,
                COALESCE(SUM(input_tokens), 0) as total_input_tokens,
                COALESCE(SUM(output_tokens), 0) as total_output_tokens,
                COALESCE(AVG(duration_ms), 0) as avg_duration_ms,
                SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count
            FROM api_logs
            WHERE 1=1
        `;
        const params = [];

        if (apiKeyId) {
            query += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        const [rows] = await this.db.execute(query, params);
        const row = rows[0];
        return {
            totalRequests: Number(row.total_requests) || 0,
            totalInputTokens: Number(row.total_input_tokens) || 0,
            totalOutputTokens: Number(row.total_output_tokens) || 0,
            avgDuration: Math.round(Number(row.avg_duration_ms) || 0),
            errorCount: Number(row.error_count) || 0
        };
    }

    _mapRow(row) {
        return {
            id: row.id,
            requestId: row.request_id,
            apiKeyId: row.api_key_id,
            apiKeyPrefix: row.api_key_prefix,
            credentialId: row.credential_id,
            credentialName: row.credential_name,
            ipAddress: row.ip_address,
            userAgent: row.user_agent,
            method: row.method,
            path: row.path,
            model: row.model,
            stream: row.stream === 1,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            requestMessages: row.request_messages,
            responseContent: row.response_content,
            statusCode: row.status_code,
            errorMessage: row.error_message,
            durationMs: row.duration_ms,
            source: row.source || 'api',
            createdAt: row.created_at
        };
    }

    async getStatsForApiKey(apiKeyId, options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens,
                COALESCE(AVG(duration_ms), 0) as avgDurationMs
            FROM api_logs
            WHERE api_key_id = ?
        `;
        const params = [apiKeyId];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        const [rows] = await this.db.execute(query, params);
        return {
            requestCount: Number(rows[0].requestCount) || 0,
            inputTokens: Number(rows[0].inputTokens) || 0,
            outputTokens: Number(rows[0].outputTokens) || 0,
            avgDurationMs: Number(rows[0].avgDurationMs) || 0
        };
    }

    async getStatsByModel(apiKeyId, options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                model,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE api_key_id = ?
        `;
        const params = [apiKeyId];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY model';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            model: row.model,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getAllStatsByModel(options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                model,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY model';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            model: row.model,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getStatsByApiKey(options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                al.api_key_id,
                ak.name as apiKeyName,
                ak.key_prefix as apiKeyPrefix,
                COUNT(*) as requestCount,
                COALESCE(SUM(al.input_tokens), 0) as inputTokens,
                COALESCE(SUM(al.output_tokens), 0) as outputTokens
            FROM api_logs al
            LEFT JOIN api_keys ak ON al.api_key_id = ak.id
            WHERE al.api_key_id IS NOT NULL
        `;
        const params = [];

        if (startDate) {
            query += ' AND al.created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND al.created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY al.api_key_id, ak.name, ak.key_prefix ORDER BY requestCount DESC';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            apiKeyId: row.api_key_id,
            apiKeyName: row.apiKeyName || 'Unknown',
            apiKeyPrefix: row.apiKeyPrefix || '',
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getErrorLogs(options = {}) {
        const { limit = 100, offset = 0, startDate, endDate } = options;
        let query = `
            SELECT * FROM api_logs
            WHERE status_code >= 400
        `;
        const params = [];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ` ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

        const [rows] = await this.db.execute(query, params);
        return {
            logs: rows.map(row => this._mapRow(row)),
            total: rows.length
        };
    }

    async getByRequestId(requestId) {
        const [rows] = await this.db.execute(
            'SELECT * FROM api_logs WHERE request_id = ?',
            [requestId]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async update(requestId, data) {
        const fields = [];
        const params = [];

        if (data.outputTokens !== undefined) {
            fields.push('output_tokens = ?');
            params.push(data.outputTokens);
        }
        if (data.statusCode !== undefined) {
            fields.push('status_code = ?');
            params.push(data.statusCode);
        }
        if (data.errorMessage !== undefined) {
            fields.push('error_message = ?');
            params.push(data.errorMessage);
        }
        if (data.durationMs !== undefined) {
            fields.push('duration_ms = ?');
            params.push(data.durationMs);
        }

        if (fields.length === 0) return;

        params.push(requestId);
        await this.db.execute(
            `UPDATE api_logs SET ${fields.join(', ')} WHERE request_id = ?`,
            params
        );
    }

    async delete(id) {
        await this.db.execute('DELETE FROM api_logs WHERE id = ?', [id]);
    }

    async cleanOldLogs(daysToKeep) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        await this.db.execute(
            'DELETE FROM api_logs WHERE created_at < ?',
            [cutoffDate.toISOString()]
        );
    }

    async getStatsByIp(options = {}) {
        const { startDate, endDate, limit = 100 } = options;
        let query = `
            SELECT
                ip_address as ipAddress,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ` GROUP BY ip_address ORDER BY requestCount DESC LIMIT ${parseInt(limit)}`;

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            ipAddress: row.ipAddress,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
  }

    async getStatsByApiKey(options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                al.api_key_id as apiKeyId,
                al.api_key_prefix as apiKeyPrefix,
                ak.name as apiKeyName,
                COUNT(*) as requestCount,
                COALESCE(SUM(al.input_tokens), 0) as inputTokens,
                COALESCE(SUM(al.output_tokens), 0) as outputTokens
            FROM api_logs al
            LEFT JOIN api_keys ak ON al.api_key_id = ak.id
            WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            query += ' AND al.created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND al.created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY al.api_key_id, al.api_key_prefix, ak.name';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            apiKeyId: row.apiKeyId,
            apiKeyPrefix: row.apiKeyPrefix,
            apiKeyName: row.apiKeyName,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getCostByApiKey(options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                al.api_key_id as apiKeyId,
                al.api_key_prefix as apiKeyPrefix,
                ak.name as apiKeyName,
                COUNT(*) as requestCount,
                COALESCE(SUM(al.input_tokens), 0) as inputTokens,
                COALESCE(SUM(al.output_tokens), 0) as outputTokens
            FROM api_logs al
            LEFT JOIN api_keys ak ON al.api_key_id = ak.id
            WHERE al.api_key_id IS NOT NULL
        `;
        const params = [];

        if (startDate) {
            query += ' AND al.created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND al.created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY al.api_key_id, al.api_key_prefix, ak.name';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            apiKeyId: row.apiKeyId,
            apiKeyPrefix: row.apiKeyPrefix,
            apiKeyName: row.apiKeyName,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getStatsByDate(options = {}) {
        const { startDate, endDate, apiKeyId } = options;
        let query = `
            SELECT
                DATE(created_at) as date,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE 1=1
        `;
        const params = [];

        if (apiKeyId) {
            query += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY DATE(created_at) ORDER BY date DESC';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            date: row.date,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getStatsByTimeInterval(options = {}) {
        const { startDate, endDate, apiKeyId, intervalMinutes = 20 } = options;
        let query = `
            SELECT
                FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(created_at) / (? * 60)) * (? * 60)) as time_slot,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE 1=1
        `;
        const params = [intervalMinutes, intervalMinutes];

        if (apiKeyId) {
            query += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY time_slot ORDER BY time_slot ASC';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            timeSlot: row.time_slot,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }
}

/**
 * Gemini Antigravity credential management class
 */
export class GeminiCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new GeminiCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO gemini_credentials (name, email, access_token, refresh_token, project_id, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.email || null,
            credential.accessToken,
            credential.refreshToken || null,
            credential.projectId || null,
            credential.expiresAt || null
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const toNull = (val) => val === undefined ? null : val;
        await this.db.execute(`
            UPDATE gemini_credentials SET
                name = COALESCE(?, name),
                email = COALESCE(?, email),
                access_token = COALESCE(?, access_token),
                refresh_token = COALESCE(?, refresh_token),
                project_id = COALESCE(?, project_id),
                expires_at = COALESCE(?, expires_at),
                error_count = COALESCE(?, error_count),
                last_error_at = COALESCE(?, last_error_at),
                last_error_message = COALESCE(?, last_error_message)
            WHERE id = ?
        `, [
            toNull(credential.name),
            toNull(credential.email),
            toNull(credential.accessToken),
            toNull(credential.refreshToken),
            toNull(credential.projectId),
            toNull(credential.expiresAt),
            toNull(credential.errorCount),
            toNull(credential.lastErrorAt),
            toNull(credential.lastErrorMessage),
            id
        ]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM gemini_credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM gemini_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM gemini_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM gemini_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getActive() {
        const [rows] = await this.db.execute('SELECT * FROM gemini_credentials WHERE is_active = 1 LIMIT 1');
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM gemini_credentials WHERE is_active = 1 ORDER BY error_count ASC, updated_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async toggleActive(id) {
        const [rows] = await this.db.execute('SELECT is_active FROM gemini_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return false;
        const newStatus = rows[0].is_active === 1 ? 0 : 1;
        await this.db.execute('UPDATE gemini_credentials SET is_active = ? WHERE id = ?', [newStatus, id]);
        return newStatus === 1;
    }

    async enable(id) {
        await this.db.execute('UPDATE gemini_credentials SET is_active = 1 WHERE id = ?', [id]);
    }

    async disable(id) {
        await this.db.execute('UPDATE gemini_credentials SET is_active = 0 WHERE id = ?', [id]);
    }

    async updateUsage(id, usageData) {
        const usageJson = JSON.stringify(usageData);
        await this.db.execute(`
            UPDATE gemini_credentials SET
                usage_data = ?,
                usage_updated_at = NOW()
            WHERE id = ?
        `, [usageJson, id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE gemini_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async resetErrorCount(id) {
        await this.db.execute(`
            UPDATE gemini_credentials SET
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL
            WHERE id = ?
        `, [id]);
    }

    // ============ Quota Management ============

    /**
     * Update quota data for a credential
     * @param {number} id - Credential ID
     * @param {object} quotaData - Quota data { modelId: { remainingFraction, resetTime } }
     */
    async updateQuota(id, quotaData) {
        const quotaJson = JSON.stringify(quotaData);
        await this.db.execute(`
            UPDATE gemini_credentials SET
                quota_data = ?,
                quota_updated_at = NOW()
            WHERE id = ?
        `, [quotaJson, id]);
    }

    /**
     * Get credentials with quota info, sorted by quota (highest first)
     * @param {string} modelId - Model ID to check quota for
     * @returns {Promise<Array>} Credentials sorted by quota
     */
    async getActiveByQuota(modelId) {
        const [rows] = await this.db.execute(`
            SELECT *,
                JSON_EXTRACT(quota_data, ?) as model_quota
            FROM gemini_credentials
            WHERE is_active = 1
            ORDER BY
                CASE
                    WHEN JSON_EXTRACT(quota_data, ?) IS NULL THEN 0.5
                    ELSE CAST(JSON_EXTRACT(quota_data, ?) AS DECIMAL(10,4))
                END DESC,
                error_count ASC
        `, [
            `$."${modelId}".remainingFraction`,
            `$."${modelId}".remainingFraction`,
            `$."${modelId}".remainingFraction`
        ]);
        return rows.map(row => this._mapRow(row));
    }

    /**
     * Get quota remaining fraction for a credential and model
     * @param {number} id - Credential ID
     * @param {string} modelId - Model ID
     * @returns {Promise<number|null>} Remaining fraction (0-1) or null if unknown
     */
    async getQuotaFraction(id, modelId) {
        const credential = await this.getById(id);
        if (!credential || !credential.quotaData) return null;
        const modelQuota = credential.quotaData[modelId];
        return modelQuota?.remainingFraction ?? null;
    }

    /**
     * Check if quota data is fresh (less than 5 minutes old)
     * @param {number} id - Credential ID
     * @returns {Promise<boolean>}
     */
    async isQuotaFresh(id) {
        const [rows] = await this.db.execute(`
            SELECT quota_updated_at FROM gemini_credentials WHERE id = ?
        `, [id]);
        if (rows.length === 0 || !rows[0].quota_updated_at) return false;
        const updatedAt = new Date(rows[0].quota_updated_at).getTime();
        const staleMs = 5 * 60 * 1000; // 5 minutes
        return (Date.now() - updatedAt) < staleMs;
    }

    /**
     * Get all credentials that need quota refresh
     * @returns {Promise<Array>} Credentials with stale or missing quota data
     */
    async getCredentialsNeedingQuotaRefresh() {
        const staleTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
        const [rows] = await this.db.execute(`
            SELECT * FROM gemini_credentials
            WHERE is_active = 1
            AND (quota_updated_at IS NULL OR quota_updated_at < ?)
            ORDER BY quota_updated_at ASC
        `, [staleTime]);
        return rows.map(row => this._mapRow(row));
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            projectId: row.project_id,
            expiresAt: row.expires_at,
            isActive: row.is_active === 1,
            usageData: row.usage_data ? (typeof row.usage_data === 'string' ? JSON.parse(row.usage_data) : row.usage_data) : null,
            usageUpdatedAt: row.usage_updated_at,
            quotaData: row.quota_data ? (typeof row.quota_data === 'string' ? JSON.parse(row.quota_data) : row.quota_data) : null,
            quotaUpdatedAt: row.quota_updated_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    // ============ Error Credential Management ============

    async moveToError(id, errorMessage) {
        const credential = await this.getById(id);
        if (!credential) return null;

        const [existingError] = await this.db.execute(
            'SELECT id, error_count FROM gemini_error_credentials WHERE original_id = ?',
            [id]
        );

        if (existingError.length > 0) {
            const errorId = existingError[0].id;
            const errorCount = existingError[0].error_count + 1;
            await this.db.execute(`
                UPDATE gemini_error_credentials SET
                    error_message = ?,
                    error_count = ?,
                    last_error_at = NOW()
                WHERE id = ?
            `, [errorMessage, errorCount, errorId]);
        } else {
            await this.db.execute(`
                INSERT INTO gemini_error_credentials (
                    original_id, name, email, access_token, refresh_token,
                    project_id, expires_at, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                credential.id,
                credential.name,
                credential.email,
                credential.accessToken,
                credential.refreshToken,
                credential.projectId,
                credential.expiresAt,
                errorMessage,
                credential.createdAt
            ]);
        }

        await this.delete(id);
        return credential;
    }

    async restoreFromError(errorId, newAccessToken, newRefreshToken, newExpiresAt) {
        const [rows] = await this.db.execute('SELECT * FROM gemini_error_credentials WHERE id = ?', [errorId]);
        if (rows.length === 0) return null;

        const errorCred = this._mapErrorRow(rows[0]);

        const [result] = await this.db.execute(`
            INSERT INTO gemini_credentials (
                name, email, access_token, refresh_token, project_id, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            errorCred.name,
            errorCred.email,
            newAccessToken || errorCred.accessToken,
            newRefreshToken || errorCred.refreshToken,
            errorCred.projectId,
            newExpiresAt || errorCred.expiresAt,
            errorCred.createdAt
        ]);

        await this.db.execute('DELETE FROM gemini_error_credentials WHERE id = ?', [errorId]);
        return result.insertId;
    }

    async getAllErrors() {
        const [rows] = await this.db.execute('SELECT * FROM gemini_error_credentials ORDER BY last_error_at DESC');
        return rows.map(row => this._mapErrorRow(row));
    }

    async getErrorById(id) {
        const [rows] = await this.db.execute('SELECT * FROM gemini_error_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapErrorRow(rows[0]);
    }

    async deleteError(id) {
        await this.db.execute('DELETE FROM gemini_error_credentials WHERE id = ?', [id]);
    }

    _mapErrorRow(row) {
        return {
            id: row.id,
            originalId: row.original_id,
            name: row.name,
            email: row.email,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            projectId: row.project_id,
            expiresAt: row.expires_at,
            errorMessage: row.error_message,
            errorCount: row.error_count,
            lastErrorAt: row.last_error_at,
            createdAt: row.created_at
        };
    }
}

/**
 * Anthropic API credential management class (direct API with custom endpoints)
 */
export class AnthropicCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new AnthropicCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO anthropic_credentials (name, email, access_token, api_base_url, expires_at, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.email || null,
            credential.accessToken,
            credential.apiBaseUrl || null,
            credential.expiresAt || null,
            credential.isActive !== false ? 1 : 0
        ]);
        return result.insertId;
    }

    async getAll() {
        const [rows] = await this.db.execute(`
            SELECT * FROM anthropic_credentials ORDER BY is_active DESC, last_used_at DESC
        `);
        return rows.map(row => this._mapRow(row));
    }

    async getActive() {
        const [rows] = await this.db.execute(`
            SELECT * FROM anthropic_credentials WHERE is_active = 1 ORDER BY error_count ASC, last_used_at ASC
        `);
        return rows.map(row => this._mapRow(row));
    }

    async getById(id) {
        const [rows] = await this.db.execute(`
            SELECT * FROM anthropic_credentials WHERE id = ?
        `, [id]);
        return rows.length > 0 ? this._mapRow(rows[0]) : null;
    }

    async getByName(name) {
        const [rows] = await this.db.execute(`
            SELECT * FROM anthropic_credentials WHERE name = ?
        `, [name]);
        return rows.length > 0 ? this._mapRow(rows[0]) : null;
    }

    async update(id, updates) {
        const fields = [];
        const values = [];

        if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
        if (updates.email !== undefined) { fields.push('email = ?'); values.push(updates.email); }
        if (updates.accessToken !== undefined) { fields.push('access_token = ?'); values.push(updates.accessToken); }
        if (updates.apiBaseUrl !== undefined) { fields.push('api_base_url = ?'); values.push(updates.apiBaseUrl); }
        if (updates.expiresAt !== undefined) { fields.push('expires_at = ?'); values.push(updates.expiresAt); }
        if (updates.isActive !== undefined) { fields.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
        if (updates.rateLimits !== undefined) { fields.push('rate_limits = ?'); values.push(JSON.stringify(updates.rateLimits)); }

        if (fields.length === 0) return false;

        values.push(id);
        await this.db.execute(`UPDATE anthropic_credentials SET ${fields.join(', ')} WHERE id = ?`, values);
        return true;
    }

    async updateApiBaseUrl(id, apiBaseUrl) {
        await this.db.execute(`
            UPDATE anthropic_credentials SET api_base_url = ? WHERE id = ?
        `, [apiBaseUrl || null, id]);
        return true;
    }

    async updateRateLimits(id, rateLimits) {
        try {
            const jsonStr = JSON.stringify(rateLimits);
            await this.db.execute(`
                UPDATE anthropic_credentials SET rate_limits = ? WHERE id = ?
            `, [jsonStr, id]);
            return true;
        } catch (error) {
            console.error('[AnthropicStore] Failed to update rate limits:', error.message, rateLimits);
            return false;
        }
    }

    async recordUsage(id) {
        await this.db.execute(`
            UPDATE anthropic_credentials SET use_count = use_count + 1, last_used_at = NOW(), error_count = 0 WHERE id = ?
        `, [id]);
    }

    async recordError(id, errorMessage) {
        await this.db.execute(`
            UPDATE anthropic_credentials SET error_count = error_count + 1, last_error_at = NOW(), last_error_message = ? WHERE id = ?
        `, [errorMessage, id]);
    }

    async delete(id) {
        const [result] = await this.db.execute(`DELETE FROM anthropic_credentials WHERE id = ?`, [id]);
        return result.affectedRows > 0;
    }

    async moveToError(id, errorMessage) {
        const credential = await this.getById(id);
        if (!credential) return false;

        await this.db.execute(`
            INSERT INTO anthropic_error_credentials (original_id, name, email, access_token, api_base_url, error_message)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id, credential.name, credential.email, credential.accessToken, credential.apiBaseUrl, errorMessage]);

        await this.delete(id);
        return true;
    }

    async getErrorCredentials() {
        const [rows] = await this.db.execute(`
            SELECT * FROM anthropic_error_credentials ORDER BY last_error_at DESC
        `);
        return rows.map(row => this._mapErrorRow(row));
    }

    async recoverFromError(errorId) {
        const [rows] = await this.db.execute(`
            SELECT * FROM anthropic_error_credentials WHERE id = ?
        `, [errorId]);
        if (rows.length === 0) return null;

        const row = rows[0];
        const insertId = await this.add({
            name: row.name,
            email: row.email,
            accessToken: row.access_token,
            apiBaseUrl: row.api_base_url
        });

        await this.db.execute(`DELETE FROM anthropic_error_credentials WHERE id = ?`, [errorId]);
        return insertId;
    }

    async deleteErrorCredential(errorId) {
        const [result] = await this.db.execute(`DELETE FROM anthropic_error_credentials WHERE id = ?`, [errorId]);
        return result.affectedRows > 0;
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            accessToken: row.access_token,
            apiBaseUrl: row.api_base_url,
            expiresAt: row.expires_at,
            isActive: row.is_active === 1,
            useCount: row.use_count,
            lastUsedAt: row.last_used_at,
            errorCount: row.error_count,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            rateLimits: row.rate_limits ? (typeof row.rate_limits === 'string' ? JSON.parse(row.rate_limits) : row.rate_limits) : null,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    _mapErrorRow(row) {
        return {
            id: row.id,
            originalId: row.original_id,
            name: row.name,
            email: row.email,
            accessToken: row.access_token,
            apiBaseUrl: row.api_base_url,
            errorMessage: row.error_message,
            errorCount: row.error_count,
            lastErrorAt: row.last_error_at,
            createdAt: row.created_at
        };
    }
}

/**
 * Orchids credential management class
 */
export class OrchidsCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new OrchidsCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO orchids_credentials (name, email, client_jwt, clerk_session_id, user_id, expires_at, weight, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.email || null,
            credential.clientJwt,
            credential.clerkSessionId || null,
            credential.userId || null,
            credential.expiresAt || null,
            credential.weight || 1,
            credential.isActive !== false ? 1 : 0
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const toNull = (val) => val === undefined ? null : val;
        
        // Build dynamic update statement
        const updates = [];
        const values = [];
        
        if (credential.name !== undefined) { updates.push('name = ?'); values.push(credential.name); }
        if (credential.email !== undefined) { updates.push('email = ?'); values.push(credential.email); }
        if (credential.clientJwt !== undefined) { updates.push('client_jwt = ?'); values.push(credential.clientJwt); }
        if (credential.clerkSessionId !== undefined) { updates.push('clerk_session_id = ?'); values.push(credential.clerkSessionId); }
        if (credential.userId !== undefined) { updates.push('user_id = ?'); values.push(credential.userId); }
        if (credential.expiresAt !== undefined) { updates.push('expires_at = ?'); values.push(credential.expiresAt); }
        if (credential.isActive !== undefined) { updates.push('is_active = ?'); values.push(credential.isActive ? 1 : 0); }
        if (credential.weight !== undefined) { updates.push('weight = ?'); values.push(credential.weight); }
        if (credential.errorCount !== undefined) { updates.push('error_count = ?'); values.push(credential.errorCount); }
        if (credential.lastErrorAt !== undefined) { updates.push('last_error_at = ?'); values.push(credential.lastErrorAt); }
        if (credential.lastErrorMessage !== undefined) { updates.push('last_error_message = ?'); values.push(credential.lastErrorMessage); }
        
        if (updates.length === 0) return;
        
        values.push(id);
        await this.db.execute(`UPDATE orchids_credentials SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM orchids_credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM orchids_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM orchids_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM orchids_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getActive() {
        const [rows] = await this.db.execute('SELECT * FROM orchids_credentials WHERE is_active = 1 LIMIT 1');
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM orchids_credentials WHERE is_active = 1 ORDER BY error_count ASC, updated_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async toggleActive(id) {
        const [rows] = await this.db.execute('SELECT is_active FROM orchids_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return false;
        const newStatus = rows[0].is_active === 1 ? 0 : 1;
        await this.db.execute('UPDATE orchids_credentials SET is_active = ? WHERE id = ?', [newStatus, id]);
        return newStatus === 1;
    }

    async enable(id) {
        await this.db.execute('UPDATE orchids_credentials SET is_active = 1 WHERE id = ?', [id]);
    }

    async disable(id) {
        await this.db.execute('UPDATE orchids_credentials SET is_active = 0 WHERE id = ?', [id]);
    }

    async updateUsage(id, usageData) {
        const usageJson = JSON.stringify(usageData);
        await this.db.execute(`
            UPDATE orchids_credentials SET
                usage_data = ?,
                usage_updated_at = NOW()
            WHERE id = ?
        `, [usageJson, id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE orchids_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async resetErrorCount(id) {
        await this.db.execute(`
            UPDATE orchids_credentials SET
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL
            WHERE id = ?
        `, [id]);
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            clientJwt: row.client_jwt,
            clerkSessionId: row.clerk_session_id,
            userId: row.user_id,
            expiresAt: row.expires_at,
            isActive: row.is_active === 1,
            weight: row.weight || 1,
            requestCount: row.request_count || 0,
            successCount: row.success_count || 0,
            failureCount: row.failure_count || 0,
            lastUsedAt: row.last_used_at,
            usageData: row.usage_data ? (typeof row.usage_data === 'string' ? JSON.parse(row.usage_data) : row.usage_data) : null,
            usageUpdatedAt: row.usage_updated_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    // ============ Load Balancing Related Methods ============

    /**
     * Get all enabled accounts (for load balancing)
     */
    async getEnabledAccounts() {
        const [rows] = await this.db.execute(
            'SELECT * FROM orchids_credentials WHERE is_active = 1 AND error_count < 5 ORDER BY weight DESC, error_count ASC'
        );
        return rows.map(row => this._mapRow(row));
    }

    /**
     * Update weight
     */
    async updateWeight(id, weight) {
        await this.db.execute('UPDATE orchids_credentials SET weight = ? WHERE id = ?', [weight, id]);
    }

    /**
     * Add request count
     */
    async addRequestCount(id, count = 1) {
        await this.db.execute(
            'UPDATE orchids_credentials SET request_count = request_count + ?, last_used_at = NOW() WHERE id = ?',
            [count, id]
        );
    }

    /**
     * Add success count
     */
    async addSuccessCount(id, count = 1) {
        await this.db.execute(
            'UPDATE orchids_credentials SET success_count = success_count + ? WHERE id = ?',
            [count, id]
        );
    }

    /**
     * Add failure count
     */
    async addFailureCount(id, count = 1) {
        await this.db.execute(
            'UPDATE orchids_credentials SET failure_count = failure_count + ? WHERE id = ?',
            [count, id]
        );
    }

    /**
     * Reset statistics counts
     */
    async resetCounts(id) {
        await this.db.execute(
            'UPDATE orchids_credentials SET request_count = 0, success_count = 0, failure_count = 0 WHERE id = ?',
            [id]
        );
    }

    /**
     * Get statistics summary
     */
    async getStats() {
        const [rows] = await this.db.execute(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as enabled,
                SUM(CASE WHEN error_count > 0 THEN 1 ELSE 0 END) as error,
                SUM(request_count) as total_requests,
                SUM(success_count) as total_success,
                SUM(failure_count) as total_failure
            FROM orchids_credentials
        `);
        return rows[0];
    }

    // ============ Error Credential Management ============

    async moveToError(id, errorMessage) {
        const credential = await this.getById(id);
        if (!credential) return null;

        const [existingError] = await this.db.execute(
            'SELECT id, error_count FROM orchids_error_credentials WHERE original_id = ?',
            [id]
        );

        if (existingError.length > 0) {
            const errorId = existingError[0].id;
            const errorCount = existingError[0].error_count + 1;
            await this.db.execute(`
                UPDATE orchids_error_credentials SET
                    error_message = ?,
                    error_count = ?,
                    last_error_at = NOW()
                WHERE id = ?
            `, [errorMessage, errorCount, errorId]);
        } else {
            await this.db.execute(`
                INSERT INTO orchids_error_credentials (
                    original_id, name, email, client_jwt, clerk_session_id,
                    user_id, expires_at, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                credential.id,
                credential.name,
                credential.email,
                credential.clientJwt,
                credential.clerkSessionId,
                credential.userId,
                credential.expiresAt,
                errorMessage,
                credential.createdAt
            ]);
        }

        await this.delete(id);
        return credential;
    }

    async restoreFromError(errorId, newClientJwt, newExpiresAt) {
        const [rows] = await this.db.execute('SELECT * FROM orchids_error_credentials WHERE id = ?', [errorId]);
        if (rows.length === 0) return null;

        const errorCred = this._mapErrorRow(rows[0]);

        const [result] = await this.db.execute(`
            INSERT INTO orchids_credentials (
                name, email, client_jwt, clerk_session_id, user_id, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            errorCred.name,
            errorCred.email,
            newClientJwt || errorCred.clientJwt,
            errorCred.clerkSessionId,
            errorCred.userId,
            newExpiresAt || errorCred.expiresAt,
            errorCred.createdAt
        ]);

        await this.db.execute('DELETE FROM orchids_error_credentials WHERE id = ?', [errorId]);
        return result.insertId;
    }

    async getAllErrors() {
        const [rows] = await this.db.execute('SELECT * FROM orchids_error_credentials ORDER BY last_error_at DESC');
        return rows.map(row => this._mapErrorRow(row));
    }

    async getErrorById(id) {
        const [rows] = await this.db.execute('SELECT * FROM orchids_error_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapErrorRow(rows[0]);
    }

    async deleteError(id) {
        await this.db.execute('DELETE FROM orchids_error_credentials WHERE id = ?', [id]);
    }

    _mapErrorRow(row) {
        return {
            id: row.id,
            originalId: row.original_id,
            name: row.name,
            email: row.email,
            clientJwt: row.client_jwt,
            clerkSessionId: row.clerk_session_id,
            userId: row.user_id,
            expiresAt: row.expires_at,
            errorMessage: row.error_message,
            errorCount: row.error_count,
            lastErrorAt: row.last_error_at,
            createdAt: row.created_at
        };
    }
}

/**
 * Warp credential management class
 */
export class WarpCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new WarpCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO warp_credentials (name, email, refresh_token, access_token, token_expires_at)
            VALUES (?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.email || null,
            credential.refreshToken,
            credential.accessToken || null,
            credential.tokenExpiresAt || null
        ]);
        return result.insertId;
    }

    async addBatch(credentials) {
        const results = [];
        for (const cred of credentials) {
            try {
                const id = await this.add(cred);
                results.push({ success: true, id, name: cred.name });
            } catch (e) {
                results.push({ success: false, name: cred.name, error: e.message });
            }
        }
        return results;
    }

    async update(id, credential) {
        const fields = [];
        const values = [];

        if (credential.name !== undefined) { fields.push('name = ?'); values.push(credential.name); }
        if (credential.email !== undefined) { fields.push('email = ?'); values.push(credential.email); }
        if (credential.refreshToken !== undefined) { fields.push('refresh_token = ?'); values.push(credential.refreshToken); }
        if (credential.accessToken !== undefined) { fields.push('access_token = ?'); values.push(credential.accessToken); }
        if (credential.tokenExpiresAt !== undefined) { fields.push('token_expires_at = ?'); values.push(credential.tokenExpiresAt); }
        if (credential.isActive !== undefined) { fields.push('is_active = ?'); values.push(credential.isActive ? 1 : 0); }

        if (fields.length === 0) return;

        values.push(id);
        await this.db.execute(`UPDATE warp_credentials SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async updateToken(id, accessToken, expiresAt) {
        await this.db.execute(`
            UPDATE warp_credentials SET
                access_token = ?,
                token_expires_at = ?,
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL
            WHERE id = ?
        `, [accessToken, expiresAt, id]);
    }

    async incrementUseCount(id) {
        await this.db.execute(`
            UPDATE warp_credentials SET
                use_count = use_count + 1,
                last_used_at = NOW()
            WHERE id = ?
        `, [id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE warp_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM warp_credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM warp_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM warp_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM warp_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM warp_credentials WHERE is_active = 1 ORDER BY use_count ASC, last_used_at ASC');
        return rows.map(row => this._mapRow(row));
    }

    async getRandomActive() {
        // Get active account with least usage count
        const [rows] = await this.db.execute(`
            SELECT * FROM warp_credentials
            WHERE is_active = 1 AND error_count < 3
            ORDER BY use_count ASC, RAND()
            LIMIT 1
        `);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getRandomActiveExcluding(excludeIds = []) {
        // Get active account with least usage count, excluding specified IDs
        let query = `
            SELECT * FROM warp_credentials
            WHERE is_active = 1 AND error_count < 3
        `;

        if (excludeIds.length > 0) {
            const placeholders = excludeIds.map(() => '?').join(',');
            query += ` AND id NOT IN (${placeholders})`;
        }

        query += ` ORDER BY use_count ASC, RAND() LIMIT 1`;

        const [rows] = await this.db.execute(query, excludeIds);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async markQuotaExhausted(id) {
        // Mark account quota exhausted (increase error count to threshold)
        await this.db.execute(
            'UPDATE warp_credentials SET error_count = 3, last_error_message = ?, last_error_at = NOW() WHERE id = ?',
            ['Quota exhausted', id]
        );
    }

    async getCount() {
        const [rows] = await this.db.execute('SELECT COUNT(*) as count FROM warp_credentials');
        return rows[0].count;
    }

    async getActiveCount() {
        const [rows] = await this.db.execute('SELECT COUNT(*) as count FROM warp_credentials WHERE is_active = 1');
        return rows[0].count;
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM warp_credentials');
        const [active] = await this.db.execute('SELECT COUNT(*) as count FROM warp_credentials WHERE is_active = 1');
        const [healthy] = await this.db.execute('SELECT COUNT(*) as count FROM warp_credentials WHERE is_active = 1 AND error_count < 3');
        const [errors] = await this.db.execute('SELECT COUNT(*) as count FROM warp_error_credentials');
        const [totalUse] = await this.db.execute('SELECT SUM(use_count) as total FROM warp_credentials');

        return {
            total: total[0].count,
            active: active[0].count,
            healthy: healthy[0].count,
            errors: errors[0].count,
            totalUseCount: totalUse[0].total || 0
        };
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            refreshToken: row.refresh_token,
            accessToken: row.access_token,
            tokenExpiresAt: row.token_expires_at,
            isActive: row.is_active === 1,
            useCount: row.use_count || 0,
            lastUsedAt: row.last_used_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            quotaLimit: row.quota_limit || 0,
            quotaUsed: row.quota_used || 0,
            quotaUpdatedAt: row.quota_updated_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    async updateQuota(id, quotaLimit, quotaUsed) {
        await this.db.execute(
            'UPDATE warp_credentials SET quota_limit = ?, quota_used = ?, quota_updated_at = NOW() WHERE id = ?',
            [quotaLimit, quotaUsed, id]
        );
    }

    // ============ Error Credential Management ============

    async moveToError(id, errorMessage) {
        const credential = await this.getById(id);
        if (!credential) return null;

        const [existingError] = await this.db.execute(
            'SELECT id, error_count FROM warp_error_credentials WHERE original_id = ?',
            [id]
        );

        if (existingError.length > 0) {
            const errorId = existingError[0].id;
            const errorCount = existingError[0].error_count + 1;
            await this.db.execute(`
                UPDATE warp_error_credentials SET
                    error_message = ?,
                    error_count = ?,
                    last_error_at = NOW()
                WHERE id = ?
            `, [errorMessage, errorCount, errorId]);
        } else {
            await this.db.execute(`
                INSERT INTO warp_error_credentials (
                    original_id, name, email, refresh_token, access_token, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                credential.id,
                credential.name,
                credential.email,
                credential.refreshToken,
                credential.accessToken,
                errorMessage,
                credential.createdAt
            ]);
        }

        await this.delete(id);
        return credential;
    }

    async restoreFromError(errorId, newRefreshToken) {
        const [rows] = await this.db.execute('SELECT * FROM warp_error_credentials WHERE id = ?', [errorId]);
        if (rows.length === 0) return null;

        const errorCred = this._mapErrorRow(rows[0]);

        const [result] = await this.db.execute(`
            INSERT INTO warp_credentials (name, email, refresh_token, created_at)
            VALUES (?, ?, ?, ?)
        `, [
            errorCred.name,
            errorCred.email,
            newRefreshToken || errorCred.refreshToken,
            errorCred.createdAt
        ]);

        await this.db.execute('DELETE FROM warp_error_credentials WHERE id = ?', [errorId]);
        return result.insertId;
    }

    async getAllErrors() {
        const [rows] = await this.db.execute('SELECT * FROM warp_error_credentials ORDER BY last_error_at DESC');
        return rows.map(row => this._mapErrorRow(row));
    }

    async deleteError(id) {
        await this.db.execute('DELETE FROM warp_error_credentials WHERE id = ?', [id]);
    }

    _mapErrorRow(row) {
        return {
            id: row.id,
            originalId: row.original_id,
            name: row.name,
            email: row.email,
            refreshToken: row.refresh_token,
            accessToken: row.access_token,
            errorMessage: row.error_message,
            errorCount: row.error_count,
            lastErrorAt: row.last_error_at,
            createdAt: row.created_at
        };
    }
}

/**
 * Warp request statistics storage
 */
export class WarpRequestStatsStore {
    constructor(db) {
        this.db = db;
    }

    async record(stats) {
        const {
            credentialId,
            apiKeyId = null,
            endpoint,
            model,
            isStream = false,
            inputTokens = 0,
            outputTokens = 0,
            totalTokens = 0,
            durationMs = 0,
            status = 'success',
            errorMessage = null
        } = stats;

        await this.db.execute(`
            INSERT INTO warp_request_stats (
                credential_id, api_key_id, endpoint, model, is_stream,
                input_tokens, output_tokens, total_tokens, duration_ms,
                status, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            credentialId, apiKeyId, endpoint, model, isStream ? 1 : 0,
            inputTokens, outputTokens, totalTokens, durationMs,
            status, errorMessage
        ]);
    }

    async getStats(options = {}) {
        const { credentialId, apiKeyId, model, startDate, endDate, limit = 100 } = options;
        
        let sql = 'SELECT * FROM warp_request_stats WHERE 1=1';
        const params = [];

        if (credentialId) {
            sql += ' AND credential_id = ?';
            params.push(credentialId);
        }
        if (apiKeyId) {
            sql += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (model) {
            sql += ' AND model = ?';
            params.push(model);
        }
        if (startDate) {
            sql += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND created_at <= ?';
            params.push(endDate);
        }

        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const [rows] = await this.db.execute(sql, params);
        return rows.map(row => this._mapRow(row));
    }

    async getSummary(options = {}) {
        const { credentialId, apiKeyId, startDate, endDate } = options;
        
        let sql = `
            SELECT 
                COUNT(*) as total_requests,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                SUM(total_tokens) as total_tokens,
                AVG(duration_ms) as avg_duration_ms,
                model
            FROM warp_request_stats WHERE 1=1
        `;
        const params = [];

        if (credentialId) {
            sql += ' AND credential_id = ?';
            params.push(credentialId);
        }
        if (apiKeyId) {
            sql += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (startDate) {
            sql += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND created_at <= ?';
            params.push(endDate);
        }

        sql += ' GROUP BY model';

        const [rows] = await this.db.execute(sql, params);
        return rows;
    }

    async getTotalSummary(options = {}) {
        const { startDate, endDate } = options;
        
        let sql = `
            SELECT 
                COUNT(*) as total_requests,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                SUM(total_tokens) as total_tokens,
                AVG(duration_ms) as avg_duration_ms
            FROM warp_request_stats WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            sql += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND created_at <= ?';
            params.push(endDate);
        }

        const [rows] = await this.db.execute(sql, params);
        return rows[0];
    }

    async getCredentialSummary(options = {}) {
        const { startDate, endDate } = options;
        
        let sql = `
            SELECT 
                credential_id,
                COUNT(*) as total_requests,
                SUM(total_tokens) as total_tokens
            FROM warp_request_stats WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            sql += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND created_at <= ?';
            params.push(endDate);
        }

        sql += ' GROUP BY credential_id ORDER BY total_requests DESC';

        const [rows] = await this.db.execute(sql, params);
        return rows;
    }

    _mapRow(row) {
        return {
            id: row.id,
            credentialId: row.credential_id,
            apiKeyId: row.api_key_id,
            endpoint: row.endpoint,
            model: row.model,
            isStream: row.is_stream === 1,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            totalTokens: row.total_tokens,
            durationMs: row.duration_ms,
            status: row.status,
            errorMessage: row.error_message,
            createdAt: row.created_at
        };
    }
}

/**
 * Site settings management class
 */
export class SiteSettingsStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new SiteSettingsStore(database);
    }

    async get() {
        const [rows] = await this.db.execute('SELECT * FROM site_settings WHERE id = 1');
        if (rows.length === 0) {
            return {
                siteName: 'Kiro',
                siteLogo: 'K',
                siteSubtitle: 'Account Manager',
                logLevel: 'INFO',
                logEnabled: true,
                logConsole: true,
                disableCredentialLock: false,
                warpDebug: false,
                orchidsDebug: false,
                tokenRefreshInterval: 30,
                tokenRefreshThreshold: 10,
                quotaRefreshInterval: 5,
                selectionStrategy: 'hybrid',
                defaultProvider: 'kiro',
                enabledProviders: ['kiro', 'anthropic', 'gemini', 'orchids', 'warp', 'vertex', 'bedrock'],
                providerPriority: ['kiro', 'anthropic', 'gemini', 'orchids', 'warp', 'vertex', 'bedrock'],
                modelRouting: {}
            };
        }
        return this._mapRow(rows[0]);
    }

    async update(settings) {
        const fields = [];
        const values = [];

        if (settings.siteName !== undefined) { fields.push('site_name = ?'); values.push(settings.siteName); }
        if (settings.siteLogo !== undefined) { fields.push('site_logo = ?'); values.push(settings.siteLogo); }
        if (settings.siteSubtitle !== undefined) { fields.push('site_subtitle = ?'); values.push(settings.siteSubtitle); }
        if (settings.logLevel !== undefined) { fields.push('log_level = ?'); values.push(settings.logLevel); }
        if (settings.logEnabled !== undefined) { fields.push('log_enabled = ?'); values.push(settings.logEnabled ? 1 : 0); }
        if (settings.logConsole !== undefined) { fields.push('log_console = ?'); values.push(settings.logConsole ? 1 : 0); }
        if (settings.disableCredentialLock !== undefined) { fields.push('disable_credential_lock = ?'); values.push(settings.disableCredentialLock ? 1 : 0); }
        if (settings.warpDebug !== undefined) { fields.push('warp_debug = ?'); values.push(settings.warpDebug ? 1 : 0); }
        if (settings.orchidsDebug !== undefined) { fields.push('orchids_debug = ?'); values.push(settings.orchidsDebug ? 1 : 0); }
        if (settings.tokenRefreshInterval !== undefined) { fields.push('token_refresh_interval = ?'); values.push(settings.tokenRefreshInterval); }
        if (settings.tokenRefreshThreshold !== undefined) { fields.push('token_refresh_threshold = ?'); values.push(settings.tokenRefreshThreshold); }
        if (settings.quotaRefreshInterval !== undefined) { fields.push('quota_refresh_interval = ?'); values.push(settings.quotaRefreshInterval); }
        if (settings.selectionStrategy !== undefined) { fields.push('selection_strategy = ?'); values.push(settings.selectionStrategy); }
        if (settings.defaultProvider !== undefined) { fields.push('default_provider = ?'); values.push(settings.defaultProvider); }
        if (settings.enabledProviders !== undefined) { fields.push('enabled_providers = ?'); values.push(JSON.stringify(settings.enabledProviders)); }
        if (settings.providerPriority !== undefined) { fields.push('provider_priority = ?'); values.push(JSON.stringify(settings.providerPriority)); }
        if (settings.modelRouting !== undefined) { fields.push('model_routing = ?'); values.push(JSON.stringify(settings.modelRouting)); }

        if (fields.length > 0) {
            await this.db.execute(`UPDATE site_settings SET ${fields.join(', ')} WHERE id = 1`, values);
        }
        return this.get();
    }

    _mapRow(row) {
        const defaultProviders = ['kiro', 'anthropic', 'gemini', 'orchids', 'warp', 'vertex', 'bedrock'];
        let enabledProviders = defaultProviders;
        let providerPriority = defaultProviders;
        let modelRouting = {};

        try {
            if (row.enabled_providers) {
                enabledProviders = typeof row.enabled_providers === 'string' 
                    ? JSON.parse(row.enabled_providers) 
                    : row.enabled_providers;
            }
        } catch (e) { /* use default */ }

        try {
            if (row.provider_priority) {
                providerPriority = typeof row.provider_priority === 'string'
                    ? JSON.parse(row.provider_priority)
                    : row.provider_priority;
            }
        } catch (e) { /* use default */ }

        try {
            if (row.model_routing) {
                modelRouting = typeof row.model_routing === 'string'
                    ? JSON.parse(row.model_routing)
                    : row.model_routing;
            }
        } catch (e) { /* use default */ }

        return {
            siteName: row.site_name,
            siteLogo: row.site_logo,
            siteSubtitle: row.site_subtitle,
            logLevel: row.log_level || 'INFO',
            logEnabled: row.log_enabled === 1,
            logConsole: row.log_console === 1,
            disableCredentialLock: row.disable_credential_lock === 1,
            warpDebug: row.warp_debug === 1,
            orchidsDebug: row.orchids_debug === 1,
            tokenRefreshInterval: row.token_refresh_interval || 30,
            tokenRefreshThreshold: row.token_refresh_threshold || 10,
            quotaRefreshInterval: row.quota_refresh_interval || 5,
            selectionStrategy: row.selection_strategy || 'hybrid',
            defaultProvider: row.default_provider || 'kiro',
            enabledProviders,
            providerPriority,
            modelRouting,
            updatedAt: row.updated_at
        };
    }
}

/**
 * Vertex AI credential management class
 */
export class VertexCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new VertexCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO vertex_credentials (name, project_id, client_email, private_key, region, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.projectId,
            credential.clientEmail,
            credential.privateKey,
            credential.region || 'global',
            credential.isActive !== false ? 1 : 0
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const fields = [];
        const values = [];

        if (credential.name !== undefined) { fields.push('name = ?'); values.push(credential.name); }
        if (credential.projectId !== undefined) { fields.push('project_id = ?'); values.push(credential.projectId); }
        if (credential.clientEmail !== undefined) { fields.push('client_email = ?'); values.push(credential.clientEmail); }
        if (credential.privateKey !== undefined) { fields.push('private_key = ?'); values.push(credential.privateKey); }
        if (credential.region !== undefined) { fields.push('region = ?'); values.push(credential.region); }
        if (credential.isActive !== undefined) { fields.push('is_active = ?'); values.push(credential.isActive ? 1 : 0); }
        if (credential.errorCount !== undefined) { fields.push('error_count = ?'); values.push(credential.errorCount); }
        if (credential.lastErrorMessage !== undefined) { fields.push('last_error_message = ?'); values.push(credential.lastErrorMessage); }

        if (fields.length === 0) return;

        values.push(id);
        await this.db.execute(`UPDATE vertex_credentials SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM vertex_credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM vertex_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM vertex_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM vertex_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM vertex_credentials WHERE is_active = 1 ORDER BY error_count ASC, updated_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getRandomActive() {
        const [rows] = await this.db.execute(`
            SELECT * FROM vertex_credentials
            WHERE is_active = 1 AND error_count < 3
            ORDER BY use_count ASC, RAND()
            LIMIT 1
        `);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async toggleActive(id) {
        const [rows] = await this.db.execute('SELECT is_active FROM vertex_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return false;
        const newStatus = rows[0].is_active === 1 ? 0 : 1;
        await this.db.execute('UPDATE vertex_credentials SET is_active = ? WHERE id = ?', [newStatus, id]);
        return newStatus === 1;
    }

    async enable(id) {
        await this.db.execute('UPDATE vertex_credentials SET is_active = 1 WHERE id = ?', [id]);
    }

    async disable(id) {
        await this.db.execute('UPDATE vertex_credentials SET is_active = 0 WHERE id = ?', [id]);
    }

    async incrementUseCount(id) {
        await this.db.execute(`
            UPDATE vertex_credentials SET
                use_count = use_count + 1,
                last_used_at = NOW()
            WHERE id = ?
        `, [id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE vertex_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async resetErrorCount(id) {
        await this.db.execute(`
            UPDATE vertex_credentials SET
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL
            WHERE id = ?
        `, [id]);
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM vertex_credentials');
        const [active] = await this.db.execute('SELECT COUNT(*) as count FROM vertex_credentials WHERE is_active = 1');
        const [healthy] = await this.db.execute('SELECT COUNT(*) as count FROM vertex_credentials WHERE is_active = 1 AND error_count < 3');
        const [totalUse] = await this.db.execute('SELECT SUM(use_count) as total FROM vertex_credentials');

        return {
            total: total[0].count,
            active: active[0].count,
            healthy: healthy[0].count,
            totalUseCount: totalUse[0].total || 0
        };
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            projectId: row.project_id,
            clientEmail: row.client_email,
            privateKey: row.private_key,
            region: row.region || 'global',
            isActive: row.is_active === 1,
            useCount: row.use_count || 0,
            lastUsedAt: row.last_used_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    /**
     * Convert credentials to GCP service account format
     */
    toGcpCredentials(credential) {
      return {
            type: 'service_account',
            project_id: credential.projectId,
            client_email: credential.clientEmail,
            private_key: credential.privateKey
        };
    }
}

/**
 * Model pricing management class
 */
export class ModelPricingStore {
    constructor(database) {
        this.db = database;
        this.cache = null;
        this.cacheTime = null;
        this.cacheTTL = 60000; // Cache for 60 seconds
    }

    static async create() {
        const database = await getDatabase();
        return new ModelPricingStore(database);
    }

    /**
     * Get all pricing configurations
     */
    async getAll() {
        const [rows] = await this.db.execute(`
            SELECT * FROM model_pricing ORDER BY sort_order ASC, model_name ASC
        `);
        return rows.map(this._mapRow);
    }

    /**
     * Get all pricing configurations (with cache)
     */
    async getAllCached() {
        const now = Date.now();
        if (this.cache && this.cacheTime && (now - this.cacheTime) < this.cacheTTL) {
            return this.cache;
        }
        this.cache = await this.getAll();
        this.cacheTime = now;
        return this.cache;
    }

    /**
     * Get pricing by model name
     */
    async getByModel(modelName) {
        const [rows] = await this.db.execute(`
            SELECT * FROM model_pricing WHERE model_name = ? AND is_active = 1
        `, [modelName]);
        return rows.length > 0 ? this._mapRow(rows[0]) : null;
    }

    /**
     * Get pricing mapping table (with cache, for quick lookup)
     */
    async getPricingMap() {
        const all = await this.getAllCached();
        const map = {};
        for (const item of all) {
            if (item.isActive) {
                map[item.modelName] = {
                    input: parseFloat(item.inputPrice),
                    output: parseFloat(item.outputPrice)
                };
            }
        }
        return map;
    }

    /**
     * Get pricing by ID
     */
    async getById(id) {
        const [rows] = await this.db.execute(`
            SELECT * FROM model_pricing WHERE id = ?
        `, [id]);
        return rows.length > 0 ? this._mapRow(rows[0]) : null;
    }

    /**
     * Add pricing configuration
     */
    async add(pricing) {
        const [result] = await this.db.execute(`
            INSERT INTO model_pricing (model_name, display_name, provider, input_price, output_price, is_active, sort_order, source, is_custom)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            pricing.modelName,
            pricing.displayName || pricing.modelName,
            pricing.provider || 'anthropic',
            pricing.inputPrice,
            pricing.outputPrice,
            pricing.isActive !== false ? 1 : 0,
            pricing.sortOrder || 0,
            pricing.source || 'manual',
            pricing.isCustom ? 1 : 0
        ]);
        this.clearCache();
        return result.insertId;
    }

    /**
     * Update pricing configuration (marks as custom when user edits)
     */
    async update(id, pricing) {
        // If user is updating price, mark as custom
        const markAsCustom = pricing.inputPrice !== undefined || pricing.outputPrice !== undefined;

        await this.db.execute(`
            UPDATE model_pricing SET
                model_name = COALESCE(?, model_name),
                display_name = COALESCE(?, display_name),
                provider = COALESCE(?, provider),
                input_price = COALESCE(?, input_price),
                output_price = COALESCE(?, output_price),
                is_active = COALESCE(?, is_active),
                sort_order = COALESCE(?, sort_order),
                source = CASE WHEN ? THEN 'manual' ELSE source END,
                is_custom = CASE WHEN ? THEN 1 ELSE is_custom END
            WHERE id = ?
        `, [
            pricing.modelName || null,
            pricing.displayName || null,
            pricing.provider || null,
            pricing.inputPrice || null,
            pricing.outputPrice || null,
            pricing.isActive !== undefined ? (pricing.isActive ? 1 : 0) : null,
            pricing.sortOrder !== undefined ? pricing.sortOrder : null,
            markAsCustom,
            markAsCustom,
            id
        ]);
        this.clearCache();
    }

    /**
     * Delete pricing configuration
     */
    async delete(id) {
        await this.db.execute('DELETE FROM model_pricing WHERE id = ?', [id]);
        this.clearCache();
    }

    /**
     * Batch import pricing configurations
     */
    async batchImport(pricingList) {
        const results = { success: 0, failed: 0, errors: [] };

        for (const pricing of pricingList) {
            try {
                // Check if already exists
                const existing = await this.getByModel(pricing.modelName);
                if (existing) {
                    // Update existing record
                    await this.update(existing.id, pricing);
                } else {
                    // Add new record
                    await this.add(pricing);
                }
                results.success++;
            } catch (err) {
                results.failed++;
                results.errors.push({ modelName: pricing.modelName, error: err.message });
            }
        }

        this.clearCache();
        return results;
    }

    /**
     * Initialize default pricing configuration
     */
    async initDefaultPricing() {
        const defaultPricing = [
            // Claude Opus 4.5
            { modelName: 'claude-opus-4-5-20251101', displayName: 'Claude Opus 4.5', provider: 'anthropic', inputPrice: 15, outputPrice: 75, sortOrder: 1, source: 'default' },
            { modelName: 'claude-opus-4.5', displayName: 'Claude Opus 4.5 (alias)', provider: 'anthropic', inputPrice: 15, outputPrice: 75, sortOrder: 2, source: 'default' },
            // Claude Sonnet 4.5
            { modelName: 'claude-sonnet-4-5-20250929', displayName: 'Claude Sonnet 4.5', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 10, source: 'default' },
            // Claude Sonnet 4
            { modelName: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 11, source: 'default' },
            // Claude 3.7 Sonnet
            { modelName: 'claude-3-7-sonnet-20250219', displayName: 'Claude 3.7 Sonnet', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 12, source: 'default' },
            // Claude 3.5 Sonnet
            { modelName: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet v2', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 13, source: 'default' },
            { modelName: 'claude-3-5-sonnet-20240620', displayName: 'Claude 3.5 Sonnet v1', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 14, source: 'default' },
            // Claude Haiku 4.5
            { modelName: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', provider: 'anthropic', inputPrice: 0.80, outputPrice: 4, sortOrder: 20, source: 'default' },
            // Claude 3.5 Haiku
            { modelName: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku', provider: 'anthropic', inputPrice: 0.80, outputPrice: 4, sortOrder: 21, source: 'default' },
            // Claude 3 Opus
            { modelName: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus', provider: 'anthropic', inputPrice: 15, outputPrice: 75, sortOrder: 30, source: 'default' },
            // Claude 3 Sonnet
            { modelName: 'claude-3-sonnet-20240229', displayName: 'Claude 3 Sonnet', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 31, source: 'default' },
            // Claude 3 Haiku
            { modelName: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku', provider: 'anthropic', inputPrice: 0.25, outputPrice: 1.25, sortOrder: 32, source: 'default' },
            // Gemini models
            { modelName: 'gemini-3-pro-preview', displayName: 'Gemini 3 Pro', provider: 'google', inputPrice: 1.25, outputPrice: 5, sortOrder: 50, source: 'default' },
            { modelName: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash', provider: 'google', inputPrice: 0.075, outputPrice: 0.30, sortOrder: 51, source: 'default' },
            { modelName: 'gemini-2.5-flash-preview', displayName: 'Gemini 2.5 Flash', provider: 'google', inputPrice: 0.075, outputPrice: 0.30, sortOrder: 52, source: 'default' },
        ];

        return await this.batchImportWithSource(defaultPricing);
    }

    /**
     * Import remote pricing (only updates non-custom entries)
     * @param {object} remotePricing - Map of modelName -> { input, output, vendor }
     * @returns {Promise<object>} Import results
     */
    async importRemotePricing(remotePricing) {
        const results = { added: 0, updated: 0, skipped: 0, errors: [] };

        for (const [modelName, pricing] of Object.entries(remotePricing)) {
            try {
                // Check if already exists
                const [rows] = await this.db.execute(
                    'SELECT id, is_custom FROM model_pricing WHERE model_name = ?',
                    [modelName]
                );

                if (rows.length > 0) {
                    // Model exists
                    if (rows[0].is_custom) {
                        // User has customized this, skip
                        results.skipped++;
                        continue;
                    }
                    // Update existing non-custom entry
                    await this.db.execute(`
                        UPDATE model_pricing SET
                            input_price = ?,
                            output_price = ?,
                            provider = ?,
                            source = 'remote',
                            remote_updated_at = NOW()
                        WHERE id = ? AND is_custom = 0
                    `, [pricing.input, pricing.output, pricing.vendor || 'unknown', rows[0].id]);
                    results.updated++;
                } else {
                    // Add new entry
                    await this.db.execute(`
                        INSERT INTO model_pricing (model_name, display_name, provider, input_price, output_price, source, is_custom, remote_updated_at, sort_order)
                        VALUES (?, ?, ?, ?, ?, 'remote', 0, NOW(), 1000)
                    `, [modelName, modelName, pricing.vendor || 'unknown', pricing.input, pricing.output]);
                    results.added++;
                }
            } catch (err) {
                results.errors.push({ modelName, error: err.message });
            }
        }

        this.clearCache();
        return results;
    }

    /**
     * Batch import with source preservation
     */
    async batchImportWithSource(pricingList) {
        const results = { success: 0, failed: 0, errors: [] };

        for (const pricing of pricingList) {
            try {
                // Check if already exists
                const [rows] = await this.db.execute(
                    'SELECT id, is_custom FROM model_pricing WHERE model_name = ?',
                    [pricing.modelName]
                );

                if (rows.length > 0) {
                    // Skip if user has customized
                    if (rows[0].is_custom) {
                        results.success++;
                        continue;
                    }
                    // Update existing
                    await this.db.execute(`
                        UPDATE model_pricing SET
                            display_name = ?,
                            provider = ?,
                            input_price = ?,
                            output_price = ?,
                            sort_order = ?,
                            source = ?
                        WHERE id = ? AND is_custom = 0
                    `, [
                        pricing.displayName || pricing.modelName,
                        pricing.provider || 'anthropic',
                        pricing.inputPrice,
                        pricing.outputPrice,
                        pricing.sortOrder || 0,
                        pricing.source || 'manual',
                        rows[0].id
                    ]);
                } else {
                    // Add new record
                    await this.add(pricing);
                }
                results.success++;
            } catch (err) {
                results.failed++;
                results.errors.push({ modelName: pricing.modelName, error: err.message });
            }
        }

        this.clearCache();
        return results;
    }

    /**
     * Get remote pricing stats
     */
    async getRemoteStats() {
        const [rows] = await this.db.execute(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN source = 'remote' THEN 1 ELSE 0 END) as remote,
                SUM(CASE WHEN source = 'default' THEN 1 ELSE 0 END) as defaultCount,
                SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) as manual,
                SUM(CASE WHEN is_custom = 1 THEN 1 ELSE 0 END) as custom,
                MAX(remote_updated_at) as lastRemoteUpdate
            FROM model_pricing
        `);
        return {
            total: Number(rows[0].total) || 0,
            remote: Number(rows[0].remote) || 0,
            default: Number(rows[0].defaultCount) || 0,
            manual: Number(rows[0].manual) || 0,
            custom: Number(rows[0].custom) || 0,
            lastRemoteUpdate: rows[0].lastRemoteUpdate
        };
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache = null;
        this.cacheTime = null;
    }

    _mapRow(row) {
        return {
            id: row.id,
            modelName: row.model_name,
            displayName: row.display_name,
            provider: row.provider,
            inputPrice: row.input_price,
            outputPrice: row.output_price,
            isActive: row.is_active === 1,
            sortOrder: row.sort_order,
            source: row.source || 'manual',
            isCustom: row.is_custom === 1,
            remoteUpdatedAt: row.remote_updated_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * Remote pricing cache management class (llm-prices.com)
 */
export class RemotePricingCacheStore {
    constructor(database) {
        this.db = database;
        this.cacheTtl = 60 * 60 * 1000; // 1 hour
    }

    static async create() {
        const database = await getDatabase();
        return new RemotePricingCacheStore(database);
    }

    /**
     * Get all cached pricing data
     */
    async getAll() {
        const [rows] = await this.db.execute(`
            SELECT * FROM remote_pricing_cache ORDER BY model_id
        `);
        return rows.map(row => this._mapRow(row));
    }

    /**
     * Get pricing map for quick lookup { modelId: { input, output, vendor } }
     */
    async getPricingMap() {
        const [rows] = await this.db.execute(`
            SELECT model_id, input_price, output_price, vendor FROM remote_pricing_cache
        `);
        const map = {};
        for (const row of rows) {
            map[row.model_id] = {
                input: parseFloat(row.input_price),
                output: parseFloat(row.output_price),
                vendor: row.vendor
            };
        }
        return map;
    }

    /**
     * Get pricing for a specific model
     */
    async getByModelId(modelId) {
        const [rows] = await this.db.execute(`
            SELECT * FROM remote_pricing_cache WHERE model_id = ?
        `, [modelId.toLowerCase()]);
        return rows.length > 0 ? this._mapRow(rows[0]) : null;
    }

    /**
     * Check if cache is still valid (within TTL)
     */
    async isCacheValid() {
        const [rows] = await this.db.execute(`
            SELECT MAX(fetched_at) as last_fetch FROM remote_pricing_cache
        `);
        if (!rows[0] || !rows[0].last_fetch) return false;
        const lastFetch = new Date(rows[0].last_fetch).getTime();
        return (Date.now() - lastFetch) < this.cacheTtl;
    }

    /**
     * Get last fetch timestamp
     */
    async getLastFetchTime() {
        const [rows] = await this.db.execute(`
            SELECT MAX(fetched_at) as last_fetch FROM remote_pricing_cache
        `);
        return rows[0]?.last_fetch ? new Date(rows[0].last_fetch) : null;
    }

    /**
     * Get cache statistics
     */
    async getStats() {
        const [countRows] = await this.db.execute(`
            SELECT COUNT(*) as total, COUNT(DISTINCT vendor) as vendors FROM remote_pricing_cache
        `);
        const lastFetch = await this.getLastFetchTime();
        const isValid = await this.isCacheValid();

        return {
            totalModels: countRows[0]?.total || 0,
            vendors: countRows[0]?.vendors || 0,
            lastFetch: lastFetch ? lastFetch.toISOString() : null,
            cacheAge: lastFetch ? Math.round((Date.now() - lastFetch.getTime()) / 60000) + 'm' : 'never',
            isValid
        };
    }

    /**
     * Update cache with new pricing data (bulk upsert)
     */
    async updateCache(pricingData) {
        const fetchedAt = new Date();
        let updated = 0;
        let inserted = 0;

        for (const [modelId, pricing] of Object.entries(pricingData)) {
            try {
                const [result] = await this.db.execute(`
                    INSERT INTO remote_pricing_cache (model_id, input_price, output_price, vendor, fetched_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        input_price = VALUES(input_price),
                        output_price = VALUES(output_price),
                        vendor = VALUES(vendor),
                        fetched_at = VALUES(fetched_at)
                `, [
                    modelId.toLowerCase(),
                    pricing.input,
                    pricing.output,
                    pricing.vendor || 'unknown',
                    fetchedAt
                ]);

                if (result.affectedRows === 1) {
                    inserted++;
                } else if (result.affectedRows === 2) {
                    updated++;
                }
            } catch (error) {
                console.error(`[RemotePricingCache] Failed to upsert ${modelId}:`, error.message);
            }
        }

        return { inserted, updated, total: inserted + updated };
    }

    /**
     * Clear all cached pricing data
     */
    async clearCache() {
        const [result] = await this.db.execute(`DELETE FROM remote_pricing_cache`);
        return result.affectedRows;
    }

    /**
     * Delete stale entries (older than TTL)
     */
    async deleteStaleEntries() {
        const staleTime = new Date(Date.now() - this.cacheTtl);
        const [result] = await this.db.execute(`
            DELETE FROM remote_pricing_cache WHERE fetched_at < ?
        `, [staleTime]);
        return result.affectedRows;
    }

    _mapRow(row) {
        return {
            id: row.id,
            modelId: row.model_id,
            inputPrice: parseFloat(row.input_price),
            outputPrice: parseFloat(row.output_price),
            vendor: row.vendor,
            fetchedAt: row.fetched_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * Amazon Bedrock credential management class
 */
export class BedrockCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new BedrockCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO bedrock_credentials (name, access_key_id, secret_access_key, session_token, region, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.accessKeyId,
            credential.secretAccessKey,
            credential.sessionToken || null,
            credential.region || 'us-east-1',
            credential.isActive !== false ? 1 : 0
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const fields = [];
        const values = [];

        if (credential.name !== undefined) { fields.push('name = ?'); values.push(credential.name); }
        if (credential.accessKeyId !== undefined) { fields.push('access_key_id = ?'); values.push(credential.accessKeyId); }
        if (credential.secretAccessKey !== undefined) { fields.push('secret_access_key = ?'); values.push(credential.secretAccessKey); }
        if (credential.sessionToken !== undefined) { fields.push('session_token = ?'); values.push(credential.sessionToken); }
        if (credential.region !== undefined) { fields.push('region = ?'); values.push(credential.region); }
        if (credential.isActive !== undefined) { fields.push('is_active = ?'); values.push(credential.isActive ? 1 : 0); }
        if (credential.errorCount !== undefined) { fields.push('error_count = ?'); values.push(credential.errorCount); }
        if (credential.lastErrorMessage !== undefined) { fields.push('last_error_message = ?'); values.push(credential.lastErrorMessage); }

        if (fields.length === 0) return;

        values.push(id);
        await this.db.execute(`UPDATE bedrock_credentials SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM bedrock_credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM bedrock_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM bedrock_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM bedrock_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM bedrock_credentials WHERE is_active = 1 ORDER BY error_count ASC, updated_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getRandomActive() {
        const [rows] = await this.db.execute(`
            SELECT * FROM bedrock_credentials
            WHERE is_active = 1 AND error_count < 3
            ORDER BY use_count ASC, RAND()
            LIMIT 1
        `);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async toggleActive(id) {
        const [rows] = await this.db.execute('SELECT is_active FROM bedrock_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return false;
        const newStatus = rows[0].is_active === 1 ? 0 : 1;
        await this.db.execute('UPDATE bedrock_credentials SET is_active = ? WHERE id = ?', [newStatus, id]);
        return newStatus === 1;
    }

    async enable(id) {
        await this.db.execute('UPDATE bedrock_credentials SET is_active = 1 WHERE id = ?', [id]);
    }

    async disable(id) {
        await this.db.execute('UPDATE bedrock_credentials SET is_active = 0 WHERE id = ?', [id]);
    }

    async incrementUseCount(id) {
        await this.db.execute(`
            UPDATE bedrock_credentials SET
                use_count = use_count + 1,
                last_used_at = NOW()
            WHERE id = ?
        `, [id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE bedrock_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async resetErrorCount(id) {
        await this.db.execute(`
            UPDATE bedrock_credentials SET
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL
            WHERE id = ?
        `, [id]);
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM bedrock_credentials');
        const [active] = await this.db.execute('SELECT COUNT(*) as count FROM bedrock_credentials WHERE is_active = 1');
        const [healthy] = await this.db.execute('SELECT COUNT(*) as count FROM bedrock_credentials WHERE is_active = 1 AND error_count < 3');
        const [totalUse] = await this.db.execute('SELECT SUM(use_count) as total FROM bedrock_credentials');

        return {
            total: total[0].count,
            active: active[0].count,
            healthy: healthy[0].count,
            totalUseCount: totalUse[0].total || 0
        };
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            accessKeyId: row.access_key_id,
            secretAccessKey: row.secret_access_key,
            sessionToken: row.session_token,
            region: row.region || 'us-east-1',
            isActive: row.is_active === 1,
            useCount: row.use_count || 0,
            lastUsedAt: row.last_used_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * Account health tracking store (for selection module)
 */
export class AccountHealthStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new AccountHealthStore(database);
    }

    async get(provider, credentialId) {
        const [rows] = await this.db.execute(
            'SELECT * FROM account_health WHERE provider = ? AND credential_id = ?',
            [provider, credentialId]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async upsert(provider, credentialId, data) {
        const existing = await this.get(provider, credentialId);
        if (existing) {
            const fields = [];
            const values = [];
            if (data.healthScore !== undefined) { fields.push('health_score = ?'); values.push(data.healthScore); }
            if (data.consecutiveFailures !== undefined) { fields.push('consecutive_failures = ?'); values.push(data.consecutiveFailures); }
            if (data.lastSuccessAt !== undefined) { fields.push('last_success_at = ?'); values.push(data.lastSuccessAt); }
            if (data.lastFailureAt !== undefined) { fields.push('last_failure_at = ?'); values.push(data.lastFailureAt); }
            if (data.lastErrorMessage !== undefined) { fields.push('last_error_message = ?'); values.push(data.lastErrorMessage); }
            if (fields.length > 0) {
                values.push(provider, credentialId);
                await this.db.execute(
                    `UPDATE account_health SET ${fields.join(', ')} WHERE provider = ? AND credential_id = ?`,
                    values
                );
            }
            return existing.id;
        } else {
            const [result] = await this.db.execute(`
                INSERT INTO account_health (provider, credential_id, health_score, consecutive_failures, last_success_at, last_failure_at, last_error_message)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                provider,
                credentialId,
                data.healthScore ?? 70,
                data.consecutiveFailures ?? 0,
                data.lastSuccessAt ?? null,
                data.lastFailureAt ?? null,
                data.lastErrorMessage ?? null
            ]);
            return result.insertId;
        }
    }

    async updateScore(provider, credentialId, scoreDelta) {
        await this.db.execute(`
            INSERT INTO account_health (provider, credential_id, health_score)
            VALUES (?, ?, GREATEST(0, LEAST(100, 70 + ?)))
            ON DUPLICATE KEY UPDATE
                health_score = GREATEST(0, LEAST(100, health_score + ?))
        `, [provider, credentialId, scoreDelta, scoreDelta]);
    }

    async recordSuccess(provider, credentialId, bonusScore = 1) {
        await this.db.execute(`
            INSERT INTO account_health (provider, credential_id, health_score, consecutive_failures, last_success_at)
            VALUES (?, ?, LEAST(100, 70 + ?), 0, NOW())
            ON DUPLICATE KEY UPDATE
                health_score = LEAST(100, health_score + ?),
                consecutive_failures = 0,
                last_success_at = NOW()
        `, [provider, credentialId, bonusScore, bonusScore]);
    }

    async recordFailure(provider, credentialId, errorMessage, penalty = 20) {
        await this.db.execute(`
            INSERT INTO account_health (provider, credential_id, health_score, consecutive_failures, last_failure_at, last_error_message)
            VALUES (?, ?, GREATEST(0, 70 - ?), 1, NOW(), ?)
            ON DUPLICATE KEY UPDATE
                health_score = GREATEST(0, health_score - ?),
                consecutive_failures = consecutive_failures + 1,
                last_failure_at = NOW(),
                last_error_message = ?
        `, [provider, credentialId, penalty, errorMessage, penalty, errorMessage]);
    }

    async recordRateLimit(provider, credentialId, penalty = 10) {
        await this.db.execute(`
            INSERT INTO account_health (provider, credential_id, health_score, last_failure_at, last_error_message)
            VALUES (?, ?, GREATEST(0, 70 - ?), NOW(), 'rate_limit')
            ON DUPLICATE KEY UPDATE
                health_score = GREATEST(0, health_score - ?),
                last_failure_at = NOW(),
                last_error_message = 'rate_limit'
        `, [provider, credentialId, penalty, penalty]);
    }

    async getByProvider(provider) {
        const [rows] = await this.db.execute(
            'SELECT * FROM account_health WHERE provider = ? ORDER BY health_score DESC',
            [provider]
        );
        return rows.map(row => this._mapRow(row));
    }

    async delete(provider, credentialId) {
        await this.db.execute(
            'DELETE FROM account_health WHERE provider = ? AND credential_id = ?',
            [provider, credentialId]
        );
    }

    _mapRow(row) {
        return {
            id: row.id,
            provider: row.provider,
            credentialId: row.credential_id,
            healthScore: row.health_score,
            consecutiveFailures: row.consecutive_failures,
            lastSuccessAt: row.last_success_at,
            lastFailureAt: row.last_failure_at,
            lastErrorMessage: row.last_error_message,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * Token bucket rate limiting store (for selection module)
 */
export class TokenBucketStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new TokenBucketStore(database);
    }

    async get(provider, credentialId) {
        const [rows] = await this.db.execute(
            'SELECT * FROM token_buckets WHERE provider = ? AND credential_id = ?',
            [provider, credentialId]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getTokens(provider, credentialId, maxTokens = 50, regenPerMinute = 6) {
        const record = await this.get(provider, credentialId);
        if (!record) {
            // Initialize with max tokens
            await this.upsert(provider, credentialId, maxTokens);
            return maxTokens;
        }

        // Calculate regenerated tokens
        const lastUpdated = new Date(record.lastUpdated).getTime();
        const now = Date.now();
        const minutesElapsed = (now - lastUpdated) / 60000;
        const regenerated = minutesElapsed * regenPerMinute;
        const currentTokens = Math.min(maxTokens, record.tokens + regenerated);

        // Update if tokens have regenerated
        if (regenerated >= 1) {
            await this.upsert(provider, credentialId, currentTokens);
        }

        return currentTokens;
    }

    async upsert(provider, credentialId, tokens) {
        await this.db.execute(`
            INSERT INTO token_buckets (provider, credential_id, tokens, last_updated)
            VALUES (?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                tokens = ?,
                last_updated = NOW()
        `, [provider, credentialId, tokens, tokens]);
    }

    async consume(provider, credentialId, amount = 1, maxTokens = 50, regenPerMinute = 6) {
        const currentTokens = await this.getTokens(provider, credentialId, maxTokens, regenPerMinute);
        if (currentTokens < amount) {
            return { success: false, tokens: currentTokens };
        }
        const newTokens = currentTokens - amount;
        await this.upsert(provider, credentialId, newTokens);
        return { success: true, tokens: newTokens };
    }

    async refund(provider, credentialId, amount = 1, maxTokens = 50) {
        const record = await this.get(provider, credentialId);
        const currentTokens = record ? record.tokens : maxTokens;
        const newTokens = Math.min(maxTokens, currentTokens + amount);
        await this.upsert(provider, credentialId, newTokens);
        return newTokens;
    }

    async getByProvider(provider) {
        const [rows] = await this.db.execute(
            'SELECT * FROM token_buckets WHERE provider = ? ORDER BY tokens DESC',
            [provider]
        );
        return rows.map(row => this._mapRow(row));
    }

    async delete(provider, credentialId) {
        await this.db.execute(
            'DELETE FROM token_buckets WHERE provider = ? AND credential_id = ?',
            [provider, credentialId]
        );
    }

    _mapRow(row) {
        return {
            id: row.id,
            provider: row.provider,
            credentialId: row.credential_id,
            tokens: parseFloat(row.tokens),
            lastUpdated: row.last_updated
        };
    }
}

/**
 * Selection configuration store (for selection module)
 */
export class SelectionConfigStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new SelectionConfigStore(database);
    }

    async getByProvider(provider) {
        const [rows] = await this.db.execute(
            'SELECT * FROM selection_config WHERE provider = ?',
            [provider]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async upsert(provider, config) {
        const existing = await this.getByProvider(provider);
        if (existing) {
            const fields = [];
            const values = [];
            if (config.strategy !== undefined) { fields.push('strategy = ?'); values.push(config.strategy); }
            if (config.healthWeight !== undefined) { fields.push('health_weight = ?'); values.push(config.healthWeight); }
            if (config.tokenWeight !== undefined) { fields.push('token_weight = ?'); values.push(config.tokenWeight); }
            if (config.quotaWeight !== undefined) { fields.push('quota_weight = ?'); values.push(config.quotaWeight); }
            if (config.lruWeight !== undefined) { fields.push('lru_weight = ?'); values.push(config.lruWeight); }
            if (config.minHealthThreshold !== undefined) { fields.push('min_health_threshold = ?'); values.push(config.minHealthThreshold); }
            if (config.tokenBucketMax !== undefined) { fields.push('token_bucket_max = ?'); values.push(config.tokenBucketMax); }
            if (config.tokenRegenPerMinute !== undefined) { fields.push('token_regen_per_minute = ?'); values.push(config.tokenRegenPerMinute); }
            if (config.quotaLowThreshold !== undefined) { fields.push('quota_low_threshold = ?'); values.push(config.quotaLowThreshold); }
            if (config.quotaCriticalThreshold !== undefined) { fields.push('quota_critical_threshold = ?'); values.push(config.quotaCriticalThreshold); }
            if (fields.length > 0) {
                values.push(provider);
                await this.db.execute(
                    `UPDATE selection_config SET ${fields.join(', ')} WHERE provider = ?`,
                    values
                );
            }
            return existing.id;
        } else {
            const [result] = await this.db.execute(`
                INSERT INTO selection_config (provider, strategy, health_weight, token_weight, quota_weight, lru_weight, min_health_threshold, token_bucket_max, token_regen_per_minute, quota_low_threshold, quota_critical_threshold)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                provider,
                config.strategy ?? 'hybrid',
                config.healthWeight ?? 2.0,
                config.tokenWeight ?? 5.0,
                config.quotaWeight ?? 3.0,
                config.lruWeight ?? 0.1,
                config.minHealthThreshold ?? 50,
                config.tokenBucketMax ?? 50,
                config.tokenRegenPerMinute ?? 6.0,
                config.quotaLowThreshold ?? 0.10,
                config.quotaCriticalThreshold ?? 0.05
            ]);
            return result.insertId;
        }
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM selection_config ORDER BY provider');
        return rows.map(row => this._mapRow(row));
    }

    async delete(provider) {
        await this.db.execute('DELETE FROM selection_config WHERE provider = ?', [provider]);
    }

    _mapRow(row) {
        return {
            id: row.id,
            provider: row.provider,
            strategy: row.strategy,
            healthWeight: parseFloat(row.health_weight),
            tokenWeight: parseFloat(row.token_weight),
            quotaWeight: parseFloat(row.quota_weight),
            lruWeight: parseFloat(row.lru_weight),
            minHealthThreshold: row.min_health_threshold,
            tokenBucketMax: row.token_bucket_max,
            tokenRegenPerMinute: parseFloat(row.token_regen_per_minute),
            quotaLowThreshold: parseFloat(row.quota_low_threshold),
            quotaCriticalThreshold: parseFloat(row.quota_critical_threshold),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * Thinking signature cache store (for selection module)
 */
export class ThinkingSignatureCacheStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new ThinkingSignatureCacheStore(database);
    }

    async get(signatureHash) {
        const [rows] = await this.db.execute(
            'SELECT * FROM thinking_signature_cache WHERE signature_hash = ? AND expires_at > NOW()',
            [signatureHash]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async set(signatureHash, signatureValue, modelFamily, ttlHours = 2) {
        const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
        await this.db.execute(`
            INSERT INTO thinking_signature_cache (signature_hash, signature_value, model_family, expires_at)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                signature_value = ?,
                model_family = ?,
                expires_at = ?
        `, [signatureHash, signatureValue, modelFamily, expiresAt, signatureValue, modelFamily, expiresAt]);
    }

    async cleanup() {
        const [result] = await this.db.execute('DELETE FROM thinking_signature_cache WHERE expires_at <= NOW()');
        return result.affectedRows;
    }

    async getByModelFamily(modelFamily) {
        const [rows] = await this.db.execute(
            'SELECT * FROM thinking_signature_cache WHERE model_family = ? AND expires_at > NOW() ORDER BY created_at DESC',
            [modelFamily]
        );
        return rows.map(row => this._mapRow(row));
    }

    _mapRow(row) {
        return {
            id: row.id,
            signatureHash: row.signature_hash,
            signatureValue: row.signature_value,
            modelFamily: row.model_family,
            createdAt: row.created_at,
            expiresAt: row.expires_at
        };
    }
}

/**
 * Session store for persistent login sessions
 */
export class SessionStore {
    constructor(database) {
        this.db = database;
        this.expiryMs = 24 * 60 * 60 * 1000; // 24 hours
    }

    static async create() {
        const database = await getDatabase();
        return new SessionStore(database);
    }

    async create(userId, userAgent = null, ipAddress = null) {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + this.expiryMs);

        await this.db.execute(
            'INSERT INTO sessions (token, user_id, user_agent, ip_address, expires_at) VALUES (?, ?, ?, ?, ?)',
            [token, userId, userAgent, ipAddress, expiresAt]
        );

        return token;
    }

    async get(token) {
        const [rows] = await this.db.execute(
            'SELECT user_id, user_agent, ip_address, created_at, expires_at FROM sessions WHERE token = ? AND expires_at > NOW()',
            [token]
        );

        if (rows.length === 0) return null;

        return {
            userId: rows[0].user_id,
            userAgent: rows[0].user_agent,
            ipAddress: rows[0].ip_address,
            createdAt: rows[0].created_at,
            expiresAt: rows[0].expires_at
        };
    }

    async delete(token) {
        await this.db.execute('DELETE FROM sessions WHERE token = ?', [token]);
    }

    async deleteByUserId(userId) {
        await this.db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
    }

    async cleanup() {
        const [result] = await this.db.execute('DELETE FROM sessions WHERE expires_at < NOW()');
        return result.affectedRows;
    }
}

/**
 * Model alias store for unified model name mapping
 */
export class ModelAliasStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new ModelAliasStore(database);
    }

    async getAll() {
        const [rows] = await this.db.execute(
            'SELECT * FROM model_aliases ORDER BY provider, priority DESC, alias'
        );
        return rows.map(row => this._mapRow(row));
    }

    async getActive() {
        const [rows] = await this.db.execute(
            'SELECT * FROM model_aliases WHERE is_active = 1 ORDER BY provider, priority DESC, alias'
        );
        return rows.map(row => this._mapRow(row));
    }

    async getByProvider(provider) {
        const [rows] = await this.db.execute(
            'SELECT * FROM model_aliases WHERE provider = ? ORDER BY priority DESC, alias',
            [provider]
        );
        return rows.map(row => this._mapRow(row));
    }

    async getById(id) {
        const [rows] = await this.db.execute(
            'SELECT * FROM model_aliases WHERE id = ?',
            [id]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async findAlias(alias, provider = null) {
        let query = 'SELECT * FROM model_aliases WHERE alias = ? AND is_active = 1';
        const params = [alias];

        if (provider) {
            query += ' AND provider = ?';
            params.push(provider);
        }

        query += ' ORDER BY priority DESC LIMIT 1';

        const [rows] = await this.db.execute(query, params);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async create(aliasData) {
        const [result] = await this.db.execute(`
            INSERT INTO model_aliases (alias, provider, target_model, description, is_active, priority)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            aliasData.alias,
            aliasData.provider,
            aliasData.targetModel,
            aliasData.description || null,
            aliasData.isActive !== false ? 1 : 0,
            aliasData.priority || 0
        ]);
        return result.insertId;
    }

    async update(id, aliasData) {
        const fields = [];
        const values = [];

        if (aliasData.alias !== undefined) { fields.push('alias = ?'); values.push(aliasData.alias); }
        if (aliasData.provider !== undefined) { fields.push('provider = ?'); values.push(aliasData.provider); }
        if (aliasData.targetModel !== undefined) { fields.push('target_model = ?'); values.push(aliasData.targetModel); }
        if (aliasData.description !== undefined) { fields.push('description = ?'); values.push(aliasData.description); }
        if (aliasData.isActive !== undefined) { fields.push('is_active = ?'); values.push(aliasData.isActive ? 1 : 0); }
        if (aliasData.priority !== undefined) { fields.push('priority = ?'); values.push(aliasData.priority); }

        if (fields.length === 0) return;

        values.push(id);
        await this.db.execute(
            `UPDATE model_aliases SET ${fields.join(', ')} WHERE id = ?`,
            values
        );
    }

    async delete(id) {
        await this.db.execute('DELETE FROM model_aliases WHERE id = ?', [id]);
    }

    async toggleActive(id) {
        const [rows] = await this.db.execute('SELECT is_active FROM model_aliases WHERE id = ?', [id]);
        if (rows.length === 0) return false;
        const newStatus = rows[0].is_active === 1 ? 0 : 1;
        await this.db.execute('UPDATE model_aliases SET is_active = ? WHERE id = ?', [newStatus, id]);
        return newStatus === 1;
    }

    async bulkCreate(aliases) {
        const results = { success: 0, failed: 0, errors: [] };

        for (const alias of aliases) {
            try {
                await this.create(alias);
                results.success++;
            } catch (error) {
                results.failed++;
                results.errors.push({ alias: alias.alias, error: error.message });
            }
        }

        return results;
    }

    async getAliasMap(provider = null) {
        const aliases = provider ? await this.getByProvider(provider) : await this.getActive();
        const map = {};

        for (const alias of aliases) {
            if (!map[alias.provider]) {
                map[alias.provider] = {};
            }
            map[alias.provider][alias.alias] = alias.targetModel;
        }

        return map;
    }

    _mapRow(row) {
        return {
            id: row.id,
            alias: row.alias,
            provider: row.provider,
            targetModel: row.target_model,
            description: row.description,
            isActive: row.is_active === 1,
            priority: row.priority,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}
