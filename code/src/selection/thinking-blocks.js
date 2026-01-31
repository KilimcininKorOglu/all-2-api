/**
 * Thinking Blocks Parser
 * Parses, formats, and caches thinking blocks from AI responses
 */
import crypto from 'crypto';

export class ThinkingBlocksParser {
    static CONFIG = {
        signatureCacheTtlHours: 2,
        minSignatureLength: 50
    };

    constructor(cacheStore, config = {}) {
        this.cacheStore = cacheStore;
        this.ttlHours = config.signatureCacheTtlHours ?? ThinkingBlocksParser.CONFIG.signatureCacheTtlHours;
        this.minSignatureLength = config.minSignatureLength ?? ThinkingBlocksParser.CONFIG.minSignatureLength;
    }

    /**
     * Parse thinking blocks from content parts
     * @param {Array} parts - Content parts array
     * @returns {Array} Thinking blocks
     */
    parseFromContent(parts) {
        if (!Array.isArray(parts)) return [];

        return parts
            .filter(p => p && (p.thought === true || p.type === 'thinking'))
            .map(p => ({
                type: 'thinking',
                thinking: p.text || p.thinking || '',
                signature: p.thoughtSignature || p.signature || ''
            }));
    }

    /**
     * Parse thinking blocks from Gemini response parts
     * @param {Array} parts - Gemini content parts
     * @returns {Array} Parsed thinking and text blocks
     */
    parseGeminiParts(parts) {
        if (!Array.isArray(parts)) return { thinking: [], text: [] };

        const thinking = [];
        const text = [];

        for (const part of parts) {
            if (part.thought === true) {
                thinking.push({
                    type: 'thinking',
                    thinking: part.text || '',
                    signature: part.thoughtSignature || ''
                });
            } else if (part.text) {
                text.push({
                    type: 'text',
                    text: part.text
                });
            }
        }

        return { thinking, text };
    }

    /**
     * Parse thinking from Claude response content
     * @param {Array} content - Claude content array
     * @returns {Array} Parsed thinking and text blocks
     */
    parseClaudeContent(content) {
        if (!Array.isArray(content)) return { thinking: [], text: [] };

        const thinking = [];
        const text = [];

        for (const block of content) {
            if (block.type === 'thinking') {
                thinking.push({
                    type: 'thinking',
                    thinking: block.thinking || '',
                    signature: block.signature || ''
                });
            } else if (block.type === 'text') {
                text.push({
                    type: 'text',
                    text: block.text || ''
                });
            }
        }

        return { thinking, text };
    }

    /**
     * Format thinking block for streaming (SSE)
     * @param {string} thinking - Thinking text
     * @param {boolean} isStart - Whether this is the start of a thinking block
     * @returns {Object} SSE event object
     */
    formatStreamEvent(thinking, isStart = false) {
        if (isStart) {
            return {
                type: 'content_block_start',
                index: 0,
                content_block: {
                    type: 'thinking',
                    thinking: ''
                }
            };
        }
        return {
            type: 'content_block_delta',
            index: 0,
            delta: {
                type: 'thinking_delta',
                thinking
            }
        };
    }

    /**
     * Format thinking block stop event
     * @returns {Object} SSE event object
     */
    formatThinkingStop() {
        return {
            type: 'content_block_stop',
            index: 0
        };
    }

    /**
     * Format text block for streaming (SSE)
     * @param {string} text - Text content
     * @param {boolean} isStart - Whether this is the start of a text block
     * @param {number} index - Block index
     * @returns {Object} SSE event object
     */
    formatTextStreamEvent(text, isStart = false, index = 1) {
        if (isStart) {
            return {
                type: 'content_block_start',
                index,
                content_block: {
                    type: 'text',
                    text: ''
                }
            };
        }
        return {
            type: 'content_block_delta',
            index,
            delta: {
                type: 'text_delta',
                text
            }
        };
    }

    /**
     * Cache a thinking signature
     * @param {string} signature - Signature to cache
     * @param {string} modelFamily - Model family (claude, gemini)
     */
    async cacheSignature(signature, modelFamily) {
        if (!signature || signature.length < this.minSignatureLength) return;
        if (!this.cacheStore) return;

        try {
            const hash = crypto.createHash('sha256').update(signature).digest('hex');
            await this.cacheStore.set(hash, signature, modelFamily, this.ttlHours);
        } catch (error) {
            // Silently ignore cache errors
            console.log(`[ThinkingBlocks] Failed to cache signature: ${error.message}`);
        }
    }

    /**
     * Get cached signature by hash
     * @param {string} signatureHash - SHA-256 hash of signature
     * @returns {Promise<string|null>} Cached signature value
     */
    async getCachedSignature(signatureHash) {
        if (!this.cacheStore) return null;

        try {
            const record = await this.cacheStore.get(signatureHash);
            return record ? record.signatureValue : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Hash a signature
     * @param {string} signature - Signature to hash
     * @returns {string} SHA-256 hash
     */
    hashSignature(signature) {
        return crypto.createHash('sha256').update(signature).digest('hex');
    }

    /**
     * Clean up expired cache entries
     * @returns {Promise<number>} Number of deleted entries
     */
    async cleanup() {
        if (!this.cacheStore) return 0;

        try {
            return await this.cacheStore.cleanup();
        } catch (error) {
            return 0;
        }
    }

    /**
     * Convert thinking blocks to Claude format
     * @param {Array} blocks - Thinking and text blocks
     * @returns {Array} Claude-formatted content array
     */
    toClaudeFormat(blocks) {
        const content = [];

        for (const block of blocks) {
            if (block.type === 'thinking') {
                content.push({
                    type: 'thinking',
                    thinking: block.thinking
                });
            } else if (block.type === 'text') {
                content.push({
                    type: 'text',
                    text: block.text
                });
            }
        }

        return content;
    }

    /**
     * Check if a model supports thinking blocks
     * @param {string} model - Model name
     * @returns {boolean}
     */
    isThinkingModel(model) {
        if (!model) return false;
        const lowerModel = model.toLowerCase();
        return lowerModel.includes('thinking') ||
               lowerModel.includes('opus') ||
               lowerModel.includes('sonnet-4-5') ||
               lowerModel.includes('sonnet-4.5');
    }

    /**
     * Check if response contains thinking blocks
     * @param {Object} response - API response
     * @returns {boolean}
     */
    hasThinkingBlocks(response) {
        if (!response) return false;

        // Check Claude format
        if (response.content && Array.isArray(response.content)) {
            return response.content.some(c => c.type === 'thinking');
        }

        // Check Gemini format
        if (response.candidates && response.candidates[0]) {
            const parts = response.candidates[0].content?.parts || [];
            return parts.some(p => p.thought === true);
        }

        return false;
    }
}

export default ThinkingBlocksParser;
