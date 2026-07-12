package storage

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
)

const (
	pbkdf2Iterations = 100_000
	keyLength        = 32
	saltLength       = 16
	nonceLength      = 12
)

func encryptValue(machineID, plaintext string) (string, error) {
	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate encryption salt: %w", err)
	}
	nonce := make([]byte, nonceLength)
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate encryption nonce: %w", err)
	}

	gcm, err := newGCM(machineID, salt)
	if err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	payload := make([]byte, 0, len(salt)+len(nonce)+len(ciphertext))
	payload = append(payload, salt...)
	payload = append(payload, nonce...)
	payload = append(payload, ciphertext...)

	return base64.StdEncoding.EncodeToString(payload), nil
}

func decryptValue(machineID, encoded string) (string, error) {
	payload, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decode encrypted value: %w", err)
	}
	if len(payload) < saltLength+nonceLength+aes.BlockSize {
		return "", errors.New("decode encrypted value: payload is too short")
	}

	salt := payload[:saltLength]
	nonce := payload[saltLength : saltLength+nonceLength]
	ciphertext := payload[saltLength+nonceLength:]
	gcm, err := newGCM(machineID, salt)
	if err != nil {
		return "", err
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("authenticate encrypted value: %w", err)
	}
	return string(plaintext), nil
}

func newGCM(machineID string, salt []byte) (cipher.AEAD, error) {
	key, err := pbkdf2.Key(sha256.New, "TwirChat:"+machineID, salt, pbkdf2Iterations, keyLength)
	if err != nil {
		return nil, fmt.Errorf("derive encryption key: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create AES-256 cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create AES-GCM: %w", err)
	}
	return gcm, nil
}
