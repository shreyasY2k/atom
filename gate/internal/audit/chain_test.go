package audit

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"
)

func TestComputeHMAC_Deterministic(t *testing.T) {
	secret := []byte("test-secret-32-bytes-padding-here")
	event := []byte(`{"method":"POST","path":"/test"}`)
	prev := "genesis"

	h1 := computeHMAC(secret, prev, event)
	h2 := computeHMAC(secret, prev, event)
	if h1 != h2 {
		t.Errorf("HMAC not deterministic: %q vs %q", h1, h2)
	}
	if len(h1) != 64 {
		t.Errorf("expected 64-char hex HMAC, got %d", len(h1))
	}
}

func TestComputeHMAC_ChangesWithInput(t *testing.T) {
	secret := []byte("test-secret")
	event := []byte(`{"method":"POST"}`)

	h1 := computeHMAC(secret, "genesis", event)
	h2 := computeHMAC(secret, "other_hash", event)
	if h1 == h2 {
		t.Error("HMAC should differ when prev_hash changes")
	}
}

// chainEntry mirrors the DB row for testing.
type chainEntry struct {
	prevHash string
	event    []byte
	mac      string
}

func buildChain(t *testing.T, secret []byte, n int) []chainEntry {
	t.Helper()
	entries := make([]chainEntry, n)
	for i := 0; i < n; i++ {
		var prevHash string
		if i == 0 {
			prevHash = genesisHash
		} else {
			sum := sha256.Sum256(entries[i-1].event)
			prevHash = hex.EncodeToString(sum[:])
		}
		ev := Event{
			Timestamp:  time.Now(),
			Method:     "POST",
			Path:       "/test",
			StatusCode: 200,
		}
		eventJSON, err := json.Marshal(ev)
		if err != nil {
			t.Fatalf("marshal event: %v", err)
		}
		mac := computeHMAC(secret, prevHash, eventJSON)
		entries[i] = chainEntry{prevHash: prevHash, event: eventJSON, mac: mac}
	}
	return entries
}

func TestChainIntegrity_Valid(t *testing.T) {
	secret := []byte("test-hmac-secret")
	entries := buildChain(t, secret, 5)

	for i, e := range entries {
		expected := computeHMAC(secret, e.prevHash, e.event)
		if expected != e.mac {
			t.Errorf("HMAC mismatch at entry %d", i)
		}
		if i > 0 {
			sum := sha256.Sum256(entries[i-1].event)
			expectedPrev := hex.EncodeToString(sum[:])
			if expectedPrev != e.prevHash {
				t.Errorf("prev_hash mismatch at entry %d", i)
			}
		}
	}
}

func TestChainIntegrity_TamperedEvent(t *testing.T) {
	secret := []byte("test-hmac-secret")
	entries := buildChain(t, secret, 3)

	// Tamper with the second entry's event
	entries[1].event = []byte(`{"method":"TAMPERED"}`)

	// The HMAC of the tampered entry should not match
	expected := computeHMAC(secret, entries[1].prevHash, entries[1].event)
	if expected == entries[1].mac {
		t.Error("HMAC should not match after tampering")
	}
}

func TestChainIntegrity_TamperedHMAC(t *testing.T) {
	secret := []byte("test-hmac-secret")
	entries := buildChain(t, secret, 3)

	// Tamper with HMAC directly
	entries[0].mac = "0000000000000000000000000000000000000000000000000000000000000000"

	expected := computeHMAC(secret, entries[0].prevHash, entries[0].event)
	if hmac.Equal([]byte(expected), []byte(entries[0].mac)) {
		t.Error("tampered HMAC should not verify")
	}
}

func TestFirstEntryUsesGenesisHash(t *testing.T) {
	secret := []byte("test-hmac-secret")
	entries := buildChain(t, secret, 1)

	if entries[0].prevHash != genesisHash {
		t.Errorf("first entry should use genesis hash, got %q", entries[0].prevHash)
	}
}
