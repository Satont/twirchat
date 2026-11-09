const databaseUrl = 'postgres://twirchat_test:unused@127.0.0.1:9/twirchat_unit_test'

// Test-only preload: never inherit local OAuth credentials or a project database.
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: databaseUrl,
  POSTGRES_URL: databaseUrl,
  PGURL: databaseUrl,
  PGHOST: '127.0.0.1',
  PGPORT: '9',
  PGDATABASE: 'twirchat_unit_test',
  PGUSER: 'twirchat_test',
  PGPASSWORD: 'unused',
  PGSSLMODE: 'disable',
  KICK_CLIENT_ID: 'test-kick-client-id',
  KICK_CLIENT_SECRET: 'test-kick-client-secret',
  KICK_REDIRECT_URI: 'http://127.0.0.1:9/auth/kick/callback',
  KICK_WEBHOOK_URL: 'http://127.0.0.1:9/webhook/kick',
  KICK_WEBHOOK_SECRET: 'test-kick-webhook-secret',
  TWITCH_CLIENT_ID: 'test-twitch-client-id',
  TWITCH_CLIENT_SECRET: 'test-twitch-client-secret',
  YOUTUBE_API_KEY: '',
  TWITCH_HISTORY_PROVIDERS: '',
})
