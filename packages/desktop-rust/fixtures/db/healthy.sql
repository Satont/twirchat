INSERT INTO client_identity (key, value) VALUES ('client_secret', 'fixture-client-secret');

INSERT INTO accounts (
  id, platform, platform_user_id, username, display_name, avatar_url,
  access_token, refresh_token, expires_at, scopes, created_at, updated_at
) VALUES (
  'acct-twitch', 'twitch', 'user-1', 'fixture_streamer', 'Fixture Streamer',
  'https://example.test/avatar.png', '{{ACCESS_TOKEN}}', '{{REFRESH_TOKEN}}',
  1893456000, '["chat:read","chat:edit"]', 1700000000, 1700000100
);

INSERT INTO settings (key, value) VALUES
  ('app_settings', '{"theme":"light","overlay":{"maxMessages":5},"hotkeys":{"newTab":"ctrl+n"}}'),
  ('chat_layout', '{"mode":"split","splits":[{"id":"left","type":"combined","size":60}]}'),
  ('tab_channel_ids', '["wc-twitch","wc-kick"]'),
  ('watched_tab_layout_v2_wc-twitch', '{"version":2,"root":{"type":"panel","id":"panel-main","content":{"type":"main"},"flex":100},"meta":{"createdAt":1700000200000,"updatedAt":1700000200000}}');

INSERT INTO channel_connections (platform, channel_slug) VALUES
  ('kick', 'kickchannel'),
  ('twitch', 'fixturestreamer');

INSERT INTO watched_channels (id, platform, channel_slug, display_name, created_at) VALUES
  ('wc-twitch', 'twitch', 'fixturestreamer', 'Fixture Streamer', 1700000001),
  ('wc-kick', 'kick', 'kickchannel', 'Kick Channel', 1700000002);

INSERT INTO user_aliases (platform, platform_user_id, alias, created_at, updated_at) VALUES
  ('twitch', 'user-1', 'Friendly Alias', 1700000003, 1700000004);

INSERT INTO chat_messages (id, platform, channel_id, author_id, author_name, text, type, created_at, data) VALUES
  ('msg-old', 'twitch', 'fixturestreamer', 'user-1', 'Fixture Streamer', 'older', 'message', 1700000000000,
   '{"id":"msg-old","platform":"twitch","channelId":"fixturestreamer","author":{"id":"user-1","username":"fixture_streamer","displayName":"Fixture Streamer","badges":[]},"text":"older","emotes":[],"timestamp":"2023-11-14T22:13:20.000Z","type":"message"}'),
  ('msg-new', 'twitch', 'fixturestreamer', 'user-1', 'Fixture Streamer', 'newer', 'message', 1700000001000,
   '{"id":"msg-new","platform":"twitch","channelId":"fixturestreamer","author":{"id":"user-1","username":"fixture_streamer","displayName":"Fixture Streamer","badges":[]},"text":"newer","emotes":[],"timestamp":"2023-11-14T22:13:21.000Z","type":"message"}'),
  ('msg-bad-json', 'twitch', 'fixturestreamer', 'user-1', 'Fixture Streamer', 'bad', 'message', 1699999999000,
   '{not valid json');
