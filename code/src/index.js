/**
 * Kiro API Client
 * Access Claude models via AWS CodeWhisperer
 */

export { KiroClient } from './kiro/client.js';
export { KiroAuth } from './kiro/auth.js';
export { KiroAPI } from './kiro/api.js';
export { KIRO_CONSTANTS, KIRO_MODELS, MODEL_MAPPING, KIRO_OAUTH_CONFIG } from './constants.js';

// Vertex AI support
export { VertexClient, VertexAPI, VERTEX_MODEL_MAPPING, VERTEX_REGIONS, VERTEX_DEFAULT_MODEL } from './vertex/vertex.js';

// Default client export
import { KiroClient } from './kiro/client.js';
export default KiroClient;
