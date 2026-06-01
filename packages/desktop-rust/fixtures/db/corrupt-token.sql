INSERT INTO accounts (
  id, platform, platform_user_id, username, display_name,
  access_token, refresh_token, expires_at, scopes, created_at, updated_at
) VALUES (
  'acct-corrupt', 'youtube', 'yt-user-1', 'fixture_youtube', 'Fixture YouTube',
  'not valid base64 !!!', NULL, NULL, '["youtube.readonly"]', 1700001000, 1700001000
);
