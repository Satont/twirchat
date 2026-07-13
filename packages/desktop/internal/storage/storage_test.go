package storage

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

func TestOpenInitializesFreshProfileDatabaseWithWALAndForeignKeys(t *testing.T) {
	ctx := context.Background()
	profileDir := t.TempDir()

	store, err := Open(ctx, profileDir, WithMachineID("test-machine"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})

	if got, want := store.Path(), filepath.Join(profileDir, "twirchat.sqlite"); got != want {
		t.Errorf("Path() = %q, want %q", got, want)
	}

	var journalMode string
	if err := store.db.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&journalMode); err != nil {
		t.Fatalf("query journal mode: %v", err)
	}
	if journalMode != "wal" {
		t.Errorf("journal_mode = %q, want %q", journalMode, "wal")
	}

	var foreignKeys int
	if err := store.db.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&foreignKeys); err != nil {
		t.Fatalf("query foreign keys pragma: %v", err)
	}
	if foreignKeys != 1 {
		t.Errorf("foreign_keys = %d, want 1", foreignKeys)
	}

	for _, table := range []string{
		"client_identity",
		"accounts",
		"settings",
		"chat_messages",
		"channel_connections",
		"user_aliases",
		"watched_channels",
		"watched_channel_layouts",
	} {
		var name string
		err := store.db.QueryRowContext(
			ctx,
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
			table,
		).Scan(&name)
		if err != nil {
			if err == sql.ErrNoRows {
				t.Errorf("schema does not create %q", table)
				continue
			}
			t.Fatalf("query table %q: %v", table, err)
		}
	}
}

func TestClientSecretIsCreatedOncePerProfile(t *testing.T) {
	ctx := context.Background()
	store := openTestStorage(t)

	first, err := store.ClientSecret(ctx)
	if err != nil {
		t.Fatalf("ClientSecret() first call error = %v", err)
	}
	second, err := store.ClientSecret(ctx)
	if err != nil {
		t.Fatalf("ClientSecret() second call error = %v", err)
	}
	if first == "" {
		t.Error("ClientSecret() returned an empty value")
	}
	if first != second {
		t.Errorf("ClientSecret() values = %q and %q, want a stable value", first, second)
	}
}

func TestAccountTokensRoundTripWithUniqueAuthenticatedEncryption(t *testing.T) {
	ctx := context.Background()
	store := openTestStorage(t)
	refreshToken := "same-token"
	expiresAt := int64(1_725_000_000)
	account := contracts.Account{
		ID:             "account-1",
		Platform:       contracts.PlatformTwitch,
		PlatformUserID: "user-1",
		Username:       "streamer",
		DisplayName:    "Streamer",
		Scopes:         []string{"chat:read", "chat:edit"},
	}
	tokens := AccountTokens{
		AccessToken:  "same-token",
		RefreshToken: &refreshToken,
		ExpiresAt:    &expiresAt,
	}

	if err := store.UpsertAccount(ctx, account, tokens); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}

	accounts, err := store.ListAccounts(ctx)
	if err != nil {
		t.Fatalf("ListAccounts() error = %v", err)
	}
	if got, want := len(accounts), 1; got != want {
		t.Fatalf("ListAccounts() returned %d accounts, want %d", got, want)
	}
	if got := accounts[0]; got.ID != account.ID || got.Platform != account.Platform ||
		got.PlatformUserID != account.PlatformUserID || got.Username != account.Username ||
		got.DisplayName != account.DisplayName || !reflect.DeepEqual(got.Scopes, account.Scopes) ||
		got.CreatedAt == 0 || got.UpdatedAt == 0 {
		t.Errorf("ListAccounts() = %+v, want persisted account metadata", got)
	}

	var encryptedAccess, encryptedRefresh string
	if err := store.db.QueryRowContext(
		ctx,
		"SELECT access_token, refresh_token FROM accounts WHERE id = ?",
		account.ID,
	).Scan(&encryptedAccess, &encryptedRefresh); err != nil {
		t.Fatalf("query encrypted tokens: %v", err)
	}
	if encryptedAccess == tokens.AccessToken || encryptedRefresh == *tokens.RefreshToken {
		t.Error("stored token value is plaintext")
	}
	if encryptedAccess == encryptedRefresh {
		t.Error("identical plaintext tokens must use independent salts and nonces")
	}

	gotTokens, found, err := store.AccountTokens(ctx, account.ID)
	if err != nil {
		t.Fatalf("AccountTokens() error = %v", err)
	}
	if !found {
		t.Fatal("AccountTokens() did not find stored account")
	}
	if !reflect.DeepEqual(gotTokens, tokens) {
		t.Errorf("AccountTokens() = %+v, want %+v", gotTokens, tokens)
	}

	if _, err := store.db.ExecContext(
		ctx,
		"UPDATE accounts SET access_token = ? WHERE id = ?",
		"tampered",
		account.ID,
	); err != nil {
		t.Fatalf("tamper stored token: %v", err)
	}
	if _, _, err := store.AccountTokens(ctx, account.ID); err == nil {
		t.Error("AccountTokens() succeeded after ciphertext tampering")
	}
}

func TestAccountTokensRejectDifferentMachineID(t *testing.T) {
	ctx := context.Background()
	profileDir := t.TempDir()
	account := contracts.Account{
		ID:             "account-1",
		Platform:       contracts.PlatformTwitch,
		PlatformUserID: "user-1",
		Username:       "streamer",
		DisplayName:    "Streamer",
	}

	writer, err := Open(ctx, profileDir, WithMachineID("machine-one"))
	if err != nil {
		t.Fatalf("Open() writer error = %v", err)
	}
	if err := writer.UpsertAccount(ctx, account, AccountTokens{AccessToken: "access-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close() writer error = %v", err)
	}

	reader, err := Open(ctx, profileDir, WithMachineID("machine-two"))
	if err != nil {
		t.Fatalf("Open() reader error = %v", err)
	}
	t.Cleanup(func() {
		if err := reader.Close(); err != nil {
			t.Errorf("Close() reader error = %v", err)
		}
	})

	if _, found, err := reader.AccountTokens(ctx, account.ID); err == nil || found {
		t.Errorf("AccountTokens() with a different machine ID = found %t, error %v", found, err)
	}
}

func TestListAccountsReturnsCancelledContextBeforeAccessingSQLite(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := (&Storage{}).ListAccounts(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("ListAccounts() error = %v, want errors.Is(context.Canceled)", err)
	}
}

func TestProfileDataSurvivesCloseAndReopen(t *testing.T) {
	ctx := context.Background()
	profileDir := t.TempDir()
	account := contracts.Account{
		ID:             "account-1",
		Platform:       contracts.PlatformTwitch,
		PlatformUserID: "user-1",
		Username:       "streamer",
		DisplayName:    "Streamer",
	}
	settings := json.RawMessage(`{"theme":"dark"}`)

	first, err := Open(ctx, profileDir, WithMachineID("test-machine"))
	if err != nil {
		t.Fatalf("Open() first error = %v", err)
	}
	secret, err := first.ClientSecret(ctx)
	if err != nil {
		t.Fatalf("ClientSecret() error = %v", err)
	}
	if err := first.UpsertAccount(ctx, account, AccountTokens{AccessToken: "access-token"}); err != nil {
		t.Fatalf("UpsertAccount() error = %v", err)
	}
	if err := first.SaveSettings(ctx, settings); err != nil {
		t.Fatalf("SaveSettings() error = %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close() first error = %v", err)
	}

	second, err := Open(ctx, profileDir, WithMachineID("test-machine"))
	if err != nil {
		t.Fatalf("Open() second error = %v", err)
	}
	t.Cleanup(func() {
		if err := second.Close(); err != nil {
			t.Errorf("Close() second error = %v", err)
		}
	})

	if got, err := second.ClientSecret(ctx); err != nil || got != secret {
		t.Errorf("ClientSecret() after reopen = %q, error %v, want %q", got, err, secret)
	}
	accounts, err := second.ListAccounts(ctx)
	if err != nil {
		t.Fatalf("ListAccounts() after reopen error = %v", err)
	}
	if got, want := accounts, []contracts.Account{account}; len(got) != len(want) ||
		got[0].ID != want[0].ID || got[0].Platform != want[0].Platform ||
		got[0].PlatformUserID != want[0].PlatformUserID || got[0].Username != want[0].Username ||
		got[0].DisplayName != want[0].DisplayName {
		t.Errorf("ListAccounts() after reopen = %+v, want account metadata %+v", got, want)
	}
	if got, found, err := second.LoadSettings(ctx); err != nil || !found || !bytes.Equal(got, settings) {
		t.Errorf("LoadSettings() after reopen = %s, found %t, error %v", got, found, err)
	}
	if got, found, err := second.AccountTokens(ctx, account.ID); err != nil || !found || got.AccessToken != "access-token" {
		t.Errorf("AccountTokens() after reopen = %+v, found %t, error %v", got, found, err)
	}
}

func TestAccountsCanFindUpdateAndDeletePersistedRecords(t *testing.T) {
	ctx := context.Background()
	store := openTestStorage(t)
	first := contracts.Account{
		ID:             "twitch-account",
		Platform:       contracts.PlatformTwitch,
		PlatformUserID: "twitch-user",
		Username:       "twitcher",
		DisplayName:    "Twitcher",
	}
	second := contracts.Account{
		ID:             "kick-account",
		Platform:       contracts.PlatformKick,
		PlatformUserID: "kick-user",
		Username:       "kicker",
		DisplayName:    "Kicker",
	}
	if err := store.UpsertAccount(ctx, first, AccountTokens{AccessToken: "first"}); err != nil {
		t.Fatalf("UpsertAccount() first error = %v", err)
	}
	if err := store.UpsertAccount(ctx, second, AccountTokens{AccessToken: "second"}); err != nil {
		t.Fatalf("UpsertAccount() second error = %v", err)
	}

	foundAccount, err := store.FindAccountByPlatform(ctx, contracts.PlatformTwitch)
	if err != nil {
		t.Fatalf("FindAccountByPlatform() error = %v", err)
	}
	if foundAccount == nil || foundAccount.ID != first.ID {
		t.Fatalf("FindAccountByPlatform() = %+v, want %q", foundAccount, first.ID)
	}
	missing, err := store.FindAccountByPlatform(ctx, contracts.PlatformYouTube)
	if err != nil {
		t.Fatalf("FindAccountByPlatform() missing account error = %v", err)
	}
	if missing != nil {
		t.Errorf("FindAccountByPlatform() missing account = %+v, want nil", missing)
	}

	if err := store.UpdateAccountTokens(
		ctx,
		first.ID,
		AccountTokens{AccessToken: "renewed"},
	); err != nil {
		t.Fatalf("UpdateAccountTokens() error = %v", err)
	}
	updated, found, err := store.AccountTokens(ctx, first.ID)
	if err != nil {
		t.Fatalf("AccountTokens() after update error = %v", err)
	}
	if !found || updated.AccessToken != "renewed" || updated.RefreshToken != nil || updated.ExpiresAt != nil {
		t.Errorf("AccountTokens() after update = %+v, found = %t", updated, found)
	}

	if err := store.DeleteAccount(ctx, first.ID); err != nil {
		t.Fatalf("DeleteAccount() error = %v", err)
	}
	if _, found, err := store.AccountTokens(ctx, first.ID); err != nil || found {
		t.Errorf("AccountTokens() after deletion = found %t, error %v", found, err)
	}
	if err := store.DeleteAccountsByPlatform(ctx, contracts.PlatformKick); err != nil {
		t.Fatalf("DeleteAccountsByPlatform() error = %v", err)
	}
	accounts, err := store.ListAccounts(ctx)
	if err != nil {
		t.Fatalf("ListAccounts() after deletion error = %v", err)
	}
	if len(accounts) != 0 {
		t.Errorf("ListAccounts() after deletion = %+v, want no accounts", accounts)
	}
}

func TestSettingsRoundTripAsJSON(t *testing.T) {
	ctx := context.Background()
	store := openTestStorage(t)
	settings := json.RawMessage(`{"theme":"dark","overlay":{"fontSize":16}}`)

	if got, found, err := store.LoadSettings(ctx); err != nil || found || got != nil {
		t.Errorf("LoadSettings() before save = %s, found %t, error %v", got, found, err)
	}
	if err := store.SaveSettings(ctx, json.RawMessage(`{`)); err == nil {
		t.Error("SaveSettings() accepted invalid JSON")
	}
	if err := store.SaveSettings(ctx, settings); err != nil {
		t.Fatalf("SaveSettings() error = %v", err)
	}
	got, found, err := store.LoadSettings(ctx)
	if err != nil {
		t.Fatalf("LoadSettings() error = %v", err)
	}
	if !found {
		t.Fatal("LoadSettings() did not find stored settings")
	}
	if !bytes.Equal(got, settings) {
		t.Errorf("LoadSettings() = %s, want %s", got, settings)
	}
}

func TestChannelConnectionsAreNormalizedAndGroupedByPlatform(t *testing.T) {
	ctx := context.Background()
	store := openTestStorage(t)

	if err := store.SaveChannel(ctx, contracts.PlatformTwitch, "MainChannel"); err != nil {
		t.Fatalf("SaveChannel() error = %v", err)
	}
	if err := store.SaveChannel(ctx, contracts.PlatformTwitch, "mainchannel"); err != nil {
		t.Fatalf("SaveChannel() duplicate error = %v", err)
	}
	if err := store.SaveChannel(ctx, contracts.PlatformKick, "KickChannel"); err != nil {
		t.Fatalf("SaveChannel() other platform error = %v", err)
	}

	twitchChannels, err := store.ChannelsByPlatform(ctx, contracts.PlatformTwitch)
	if err != nil {
		t.Fatalf("ChannelsByPlatform() error = %v", err)
	}
	if want := []string{"mainchannel"}; !reflect.DeepEqual(twitchChannels, want) {
		t.Errorf("ChannelsByPlatform() = %v, want %v", twitchChannels, want)
	}
	grouped, err := store.AllChannels(ctx)
	if err != nil {
		t.Fatalf("AllChannels() error = %v", err)
	}
	if want := map[contracts.Platform][]string{
		contracts.PlatformKick:   {"kickchannel"},
		contracts.PlatformTwitch: {"mainchannel"},
	}; !reflect.DeepEqual(grouped, want) {
		t.Errorf("AllChannels() = %v, want %v", grouped, want)
	}

	if err := store.RemoveChannel(ctx, contracts.PlatformTwitch, "MAINCHANNEL"); err != nil {
		t.Fatalf("RemoveChannel() error = %v", err)
	}
	twitchChannels, err = store.ChannelsByPlatform(ctx, contracts.PlatformTwitch)
	if err != nil {
		t.Fatalf("ChannelsByPlatform() after delete error = %v", err)
	}
	if len(twitchChannels) != 0 {
		t.Errorf("ChannelsByPlatform() after delete = %v, want no channels", twitchChannels)
	}
}

func TestUserAliasesCanBeUpsertedAndRemoved(t *testing.T) {
	ctx := context.Background()
	store := openTestStorage(t)
	alias := contracts.UserAlias{
		Platform:       contracts.PlatformTwitch,
		PlatformUserID: "viewer-1",
		Alias:          "First alias",
	}

	if err := store.UpsertAlias(ctx, alias); err != nil {
		t.Fatalf("UpsertAlias() error = %v", err)
	}
	alias.Alias = "Updated alias"
	if err := store.UpsertAlias(ctx, alias); err != nil {
		t.Fatalf("UpsertAlias() update error = %v", err)
	}
	aliases, err := store.ListAliases(ctx)
	if err != nil {
		t.Fatalf("ListAliases() error = %v", err)
	}
	if got, want := len(aliases), 1; got != want {
		t.Fatalf("ListAliases() returned %d aliases, want %d", got, want)
	}
	if got := aliases[0]; got.Platform != alias.Platform || got.PlatformUserID != alias.PlatformUserID ||
		got.Alias != alias.Alias || got.CreatedAt == 0 || got.UpdatedAt == 0 {
		t.Errorf("ListAliases() = %+v, want persisted alias", got)
	}

	if err := store.RemoveAlias(ctx, alias.Platform, alias.PlatformUserID); err != nil {
		t.Fatalf("RemoveAlias() error = %v", err)
	}
	aliases, err = store.ListAliases(ctx)
	if err != nil {
		t.Fatalf("ListAliases() after removal error = %v", err)
	}
	if len(aliases) != 0 {
		t.Errorf("ListAliases() after removal = %+v, want no aliases", aliases)
	}
}

func TestMessagesPersistJSONAndPageUserHistoryWithStableCursor(t *testing.T) {
	ctx := context.Background()
	store := openTestStorage(t)
	timestamp := time.Date(2026, time.July, 12, 11, 30, 0, 0, time.UTC)
	for _, id := range []string{"a", "b", "c"} {
		message := contracts.NormalizedChatMessage{
			ID:        id,
			Platform:  contracts.PlatformTwitch,
			ChannelID: "channel-1",
			Author: contracts.ChatAuthor{
				ID:          "viewer-1",
				DisplayName: "Viewer",
			},
			Text:      "message " + id,
			Timestamp: timestamp,
			Type:      "message",
		}
		if err := store.SaveMessage(ctx, message); err != nil {
			t.Fatalf("SaveMessage(%q) error = %v", id, err)
		}
	}

	var storedJSON string
	if err := store.db.QueryRowContext(
		ctx,
		"SELECT data_json FROM chat_messages WHERE id = ?",
		"a",
	).Scan(&storedJSON); err != nil {
		t.Fatalf("query persisted message JSON: %v", err)
	}
	if !json.Valid([]byte(storedJSON)) {
		t.Errorf("stored message data is not valid JSON: %q", storedJSON)
	}

	recent, err := store.RecentMessages(ctx, 2)
	if err != nil {
		t.Fatalf("RecentMessages() error = %v", err)
	}
	if got, want := messageIDs(recent), []string{"b", "c"}; !reflect.DeepEqual(got, want) {
		t.Errorf("RecentMessages() IDs = %v, want %v", got, want)
	}

	firstPage, err := store.UserChatHistory(ctx, contracts.PlatformTwitch, "viewer-1", 2, nil)
	if err != nil {
		t.Fatalf("UserChatHistory() first page error = %v", err)
	}
	if got, want := messageIDs(firstPage.Messages), []string{"b", "c"}; !reflect.DeepEqual(got, want) {
		t.Errorf("first page IDs = %v, want %v", got, want)
	}
	if !firstPage.HasMore || firstPage.NextCursor == nil || firstPage.NextCursor.ID != "b" {
		t.Errorf("first page cursor = %+v, hasMore = %t", firstPage.NextCursor, firstPage.HasMore)
	}

	secondPage, err := store.UserChatHistory(
		ctx,
		contracts.PlatformTwitch,
		"viewer-1",
		2,
		firstPage.NextCursor,
	)
	if err != nil {
		t.Fatalf("UserChatHistory() second page error = %v", err)
	}
	if got, want := messageIDs(secondPage.Messages), []string{"a"}; !reflect.DeepEqual(got, want) {
		t.Errorf("second page IDs = %v, want %v", got, want)
	}
	if secondPage.HasMore {
		t.Error("second page reports unexpected additional history")
	}
}

func TestMessagePersistenceRetainsTheMostRecentThousandMessages(t *testing.T) {
	ctx := context.Background()
	store := openTestStorage(t)
	for index := 0; index <= 1000; index++ {
		message := contracts.NormalizedChatMessage{
			ID:        fmt.Sprintf("message-%04d", index),
			Platform:  contracts.PlatformTwitch,
			ChannelID: "channel-1",
			Author:    contracts.ChatAuthor{ID: "viewer-1", DisplayName: "Viewer"},
			Timestamp: time.UnixMilli(int64(index)),
			Type:      "message",
		}
		if err := store.SaveMessage(ctx, message); err != nil {
			t.Fatalf("SaveMessage(%d) error = %v", index, err)
		}
	}

	messages, err := store.RecentMessages(ctx, 2_000)
	if err != nil {
		t.Fatalf("RecentMessages() error = %v", err)
	}
	if got, want := len(messages), 1_000; got != want {
		t.Fatalf("RecentMessages() returned %d messages, want %d", got, want)
	}
	if got, want := messages[0].ID, "message-0001"; got != want {
		t.Errorf("oldest retained message = %q, want %q", got, want)
	}
	if got, want := messages[len(messages)-1].ID, "message-1000"; got != want {
		t.Errorf("newest retained message = %q, want %q", got, want)
	}
}

func TestWatchedChannelsUpsertAndRemovalPreserveIdentity(t *testing.T) {
	ctx := context.Background()
	store := openTestStorage(t)

	created, err := store.UpsertWatchedChannel(
		ctx,
		contracts.PlatformTwitch,
		"WatchedChannel",
		"Original name",
	)
	if err != nil {
		t.Fatalf("UpsertWatchedChannel() create error = %v", err)
	}
	updated, err := store.UpsertWatchedChannel(
		ctx,
		contracts.PlatformTwitch,
		"watchedchannel",
		"Updated name",
	)
	if err != nil {
		t.Fatalf("UpsertWatchedChannel() update error = %v", err)
	}
	if created.ID == "" || created.CreatedAt == 0 {
		t.Errorf("created watched channel = %+v, want ID and timestamp", created)
	}
	if updated.ID != created.ID || updated.DisplayName != "Updated name" ||
		updated.ChannelSlug != "watchedchannel" || updated.CreatedAt != created.CreatedAt {
		t.Errorf("updated watched channel = %+v, want retained identity with updated name", updated)
	}

	channels, err := store.ListWatchedChannels(ctx)
	if err != nil {
		t.Fatalf("ListWatchedChannels() error = %v", err)
	}
	if want := []contracts.WatchedChannel{updated}; !reflect.DeepEqual(channels, want) {
		t.Errorf("ListWatchedChannels() = %+v, want %+v", channels, want)
	}
	found, err := store.WatchedChannel(ctx, created.ID)
	if err != nil {
		t.Fatalf("WatchedChannel() error = %v", err)
	}
	if !reflect.DeepEqual(found, &updated) {
		t.Errorf("WatchedChannel() = %+v, want %+v", found, updated)
	}

	if err := store.DeleteWatchedChannel(ctx, created.ID); err != nil {
		t.Fatalf("DeleteWatchedChannel() error = %v", err)
	}
	found, err = store.WatchedChannel(ctx, created.ID)
	if err != nil {
		t.Fatalf("WatchedChannel() after delete error = %v", err)
	}
	if found != nil {
		t.Errorf("WatchedChannel() after delete = %+v, want nil", found)
	}
	recreated, err := store.UpsertWatchedChannel(
		ctx,
		contracts.PlatformTwitch,
		"watchedchannel",
		"Recreated",
	)
	if err != nil {
		t.Fatalf("UpsertWatchedChannel() recreate error = %v", err)
	}
	if err := store.DeleteWatchedChannelByPlatformSlug(
		ctx,
		contracts.PlatformTwitch,
		"WATCHEDCHANNEL",
	); err != nil {
		t.Fatalf("DeleteWatchedChannelByPlatformSlug() error = %v", err)
	}
	found, err = store.WatchedChannel(ctx, recreated.ID)
	if err != nil || found != nil {
		t.Errorf("WatchedChannel() after slug deletion = %+v, error %v", found, err)
	}
}

func TestWatchedChannelLayoutsRoundTripAsJSON(t *testing.T) {
	ctx := context.Background()
	store := openTestStorage(t)
	layout := contracts.WatchedChannelsLayout{
		Version: 2,
		Root: contracts.LayoutNode{
			Type:    "panel",
			ID:      "panel-1",
			Content: &contracts.PanelContent{Type: "watched", ChannelID: "channel-1"},
			Flex:    100,
		},
		Meta: &contracts.LayoutMeta{CreatedAt: 1_700_000_000_000},
	}

	if _, found, err := store.LoadWatchedLayout(ctx, "tab-1"); err != nil || found {
		t.Errorf("LoadWatchedLayout() before save = found %t, error %v", found, err)
	}
	if err := store.SaveWatchedLayout(ctx, "tab-1", layout); err != nil {
		t.Fatalf("SaveWatchedLayout() error = %v", err)
	}

	var storedJSON string
	if err := store.db.QueryRowContext(
		ctx,
		"SELECT data_json FROM watched_channel_layouts WHERE tab_id = ?",
		"tab-1",
	).Scan(&storedJSON); err != nil {
		t.Fatalf("query stored layout JSON: %v", err)
	}
	if !json.Valid([]byte(storedJSON)) {
		t.Errorf("stored layout data is not valid JSON: %q", storedJSON)
	}

	loaded, found, err := store.LoadWatchedLayout(ctx, "tab-1")
	if err != nil {
		t.Fatalf("LoadWatchedLayout() error = %v", err)
	}
	if !found {
		t.Fatal("LoadWatchedLayout() did not find saved layout")
	}
	if loaded.Version != layout.Version || !reflect.DeepEqual(loaded.Root, layout.Root) ||
		loaded.Meta == nil || loaded.Meta.CreatedAt != layout.Meta.CreatedAt ||
		loaded.Meta.UpdatedAt < loaded.Meta.CreatedAt {
		t.Errorf("LoadWatchedLayout() = %+v, want persisted layout with metadata", loaded)
	}

	if err := store.DeleteWatchedLayout(ctx, "tab-1"); err != nil {
		t.Fatalf("DeleteWatchedLayout() error = %v", err)
	}
	if _, found, err := store.LoadWatchedLayout(ctx, "tab-1"); err != nil || found {
		t.Errorf("LoadWatchedLayout() after delete = found %t, error %v", found, err)
	}
}

func messageIDs(messages []contracts.NormalizedChatMessage) []string {
	ids := make([]string, 0, len(messages))
	for _, message := range messages {
		ids = append(ids, message.ID)
	}
	return ids
}

func openTestStorage(t *testing.T) *Storage {
	t.Helper()

	store, err := Open(context.Background(), t.TempDir(), WithMachineID("test-machine"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})
	return store
}
