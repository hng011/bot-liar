const security = [{ basicAuth: [] }];
const unauthorized = { description: 'Missing or wrong credentials', headers: { 'WWW-Authenticate': { schema: { type: 'string' } } } };
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', example: '120363012345678901@g.us' } };

export const openapi = {
  openapi: '3.0.3',
  info: { title: 'Bot Liar admin API', version: '0.1.0', description: 'Manage which WhatsApp groups the AI agent lives in.' },
  security,
  components: { securitySchemes: { basicAuth: { type: 'http', scheme: 'basic' } } },
  paths: {
    '/api/status': {
      get: {
        summary: 'WhatsApp connection state and pairing QR',
        responses: {
          200: {
            description: 'Current state',
            content: { 'application/json': { schema: { type: 'object', properties: {
              state: { type: 'string', example: 'connected' },
              qr: { type: 'string', nullable: true, description: 'PNG data URL, present while pairing' },
            } } } },
          },
          401: unauthorized,
        },
      },
    },
    '/api/connect': { post: { summary: 'Reconnect the bot using its saved WhatsApp session', responses: { 202: { description: 'Connecting' }, 401: unauthorized, 409: { description: 'Already connected or busy' } } } },
    '/api/disconnect': { post: { summary: 'Stop the bot without unlinking the WhatsApp device', responses: { 202: { description: 'Disconnecting' }, 401: unauthorized, 409: { description: 'Already disconnected or busy' } } } },
    '/api/unlink': { post: { summary: 'Unlink the WhatsApp account, clear its saved pairing and group settings, and show a new QR', responses: { 202: { description: 'Unlinking' }, 401: unauthorized, 409: { description: 'Connection operation in progress' } } } },
    '/api/groups': {
      get: {
        summary: 'List every group the account is in',
        responses: {
          200: {
            description: 'Groups',
            content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: {
              id: { type: 'string' }, name: { type: 'string' }, enabled: { type: 'boolean' },
            } } } } },
          },
          401: unauthorized,
          409: { description: 'WhatsApp not connected' },
        },
      },
    },
    '/api/groups/{id}': {
      put: {
        summary: 'Enable or disable the agent in a group',
        parameters: [idParam, { name: 'enabled', in: 'query', required: true, schema: { type: 'boolean' } }],
        responses: {
          200: { description: 'Saved', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } } } } } },
          401: unauthorized,
          422: { description: 'Invalid group id or enabled value' },
        },
      },
    },
  },
};
