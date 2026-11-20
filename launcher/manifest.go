package main

// Update manifest: structure, validation, integrity digest and Ed25519 signature check.
// Nothing from a manifest is trusted before validate() has passed.

import (
	"crypto/ed25519"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type ManifestFile struct {
	Path           string `json:"path"`
	Size           int64  `json:"size"`
	SHA256         string `json:"sha256"`
	URL            string `json:"url"`
	Required       bool   `json:"required"`
	CompressedSize int64  `json:"compressedSize,omitempty"`
	GzURL          string `json:"gzUrl,omitempty"`
}

// transfer returns what actually travels over the wire for this file
func (f ManifestFile) transfer() (url string, size int64, gz bool) {
	if f.GzURL != "" && f.CompressedSize > 0 && f.CompressedSize < f.Size {
		return f.GzURL, f.CompressedSize, true
	}
	return f.URL, f.Size, false
}

type Signature struct {
	Alg   string `json:"alg"`
	KeyID string `json:"keyId"`
	Sig   string `json:"sig"`
}
type Manifest struct {
	Product         string          `json:"product"`
	Version         string          `json:"version"`
	BuildID         string          `json:"buildId"`
	Channel         string          `json:"channel"`
	ReleaseDate     string          `json:"releaseDate"`
	MinVersion      string          `json:"minVersion"`
	Mandatory       bool            `json:"mandatory"`
	Total           int64           `json:"total"`
	CompressedTotal int64           `json:"compressedTotal"`
	PatchType       string          `json:"patchType"`
	Files           []ManifestFile  `json:"files"`
	Entry           string          `json:"entry"`
	SHA             string          `json:"sha256"`
	ReleaseNotes    json.RawMessage `json:"releaseNotes,omitempty"`
	Signature       *Signature      `json:"signature,omitempty"`
}

//go:embed signing.pub
var signingPubB64 string

const product = "ARVEX SURVIVAL"

var (
	safePathRe = regexp.MustCompile(`^[A-Za-z0-9._@-]+(/[A-Za-z0-9._@-]+)*$`)
	hexRe      = regexp.MustCompile(`^[a-f0-9]{64}$`)
	buildRe    = regexp.MustCompile(`^[A-Za-z0-9._+-]{1,64}$`)
)

func signingKey() ed25519.PublicKey {
	if k := testSigningKey(); k != nil {
		return k
	}
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signingPubB64))
	if err != nil || len(b) != ed25519.PublicKeySize {
		return nil
	}
	return ed25519.PublicKey(b)
}
func keyID(k ed25519.PublicKey) string { s := sha256.Sum256(k); return hex.EncodeToString(s[:])[:16] }

// filesDigest must match server/lib/releases.mjs byte for byte
func filesDigest(files []ManifestFile) string {
	h := sha256.New()
	for _, f := range files {
		fmt.Fprintf(h, "%s\t%d\t%s\n", f.Path, f.Size, f.SHA256)
	}
	return hex.EncodeToString(h.Sum(nil))
}
func (m *Manifest) signedPayload() []byte {
	mand := "0"
	if m.Mandatory {
		mand = "1"
	}
	return []byte(strings.Join([]string{"ARVEX-MANIFEST-1", m.Product, m.Version, m.BuildID, m.Channel, m.MinVersion, mand, m.ReleaseDate, m.SHA}, "\n"))
}

// validate rejects anything malformed or dangerous (path traversal, absolute paths, foreign URLs, wrong totals)
func (m *Manifest) validate() error {
	bad := func(f string, a ...any) error { return coded("U001", nil, f, a...) }
	if m.Product != product {
		return bad("unexpected product %q", m.Product)
	}
	if !semverRe.MatchString(m.Version) || !buildRe.MatchString(m.BuildID) {
		return bad("bad version or build id")
	}
	if m.MinVersion != "" && (!semverRe.MatchString(m.MinVersion) || cmpVersion(m.MinVersion, m.Version) > 0) {
		return bad("minimum version %q is not valid for release %s", m.MinVersion, m.Version)
	}
	if len(m.Files) == 0 || len(m.Files) > 5000 {
		return bad("file list is empty or too long")
	}
	seen := map[string]bool{}
	var total int64
	entry := false
	for _, f := range m.Files {
		lower := strings.ToLower(f.Path)
		if len(f.Path) > 200 || !safePathRe.MatchString(f.Path) || strings.Contains(f.Path, "..") || strings.HasPrefix(lower, ".arvex") || seen[lower] {
			return bad("illegal file path %q", f.Path)
		}
		seen[lower] = true
		if f.Size <= 0 || f.Size > 4<<30 || !hexRe.MatchString(f.SHA256) {
			return bad("bad size or hash for %s", f.Path)
		}
		if !strings.HasPrefix(f.URL, "/launcher/files/") || strings.Contains(f.URL, "..") {
			return bad("file URL for %s leaves the release", f.Path)
		}
		if f.GzURL != "" && (!strings.HasPrefix(f.GzURL, "/launcher/gz/") || f.CompressedSize <= 0) {
			return bad("bad compressed source for %s", f.Path)
		}
		total += f.Size
		if f.Path == m.Entry {
			entry = true
		}
	}
	if !entry {
		return bad("entry file %q is not in the release", m.Entry)
	}
	if m.Total != total {
		return bad("declared size %d does not match the files (%d)", m.Total, total)
	}
	if filesDigest(m.Files) != m.SHA {
		return bad("file table digest does not match")
	}
	return nil
}

// Trust is remembered per data directory. Once this launcher has seen a correctly signed manifest it never accepts
// an unsigned one again, and it never accepts a signed manifest older than the newest one it has seen (replay).
type Trust struct {
	Enforced    bool   `json:"enforced"`
	KeyID       string `json:"keyId"`
	NewestSeen  string `json:"newestSeen"` // release date of the newest verified manifest
	NewestBuild string `json:"newestBuild"`
}

func (a *App) trustPath() string { return filepath.Join(a.dataDir, "trust.json") }
func (a *App) loadTrust() Trust {
	var t Trust
	if b, err := os.ReadFile(a.trustPath()); err == nil {
		json.Unmarshal(b, &t)
	}
	return t
}

// verifySignature returns "verified", "unsigned" or an error
func (a *App) verifySignature(m *Manifest) (string, error) {
	key, t := signingKey(), a.loadTrust()
	if key == nil {
		return "unsigned", nil // this launcher was built without a pinned key
	}
	if m.Signature == nil {
		if t.Enforced {
			return "", coded("U006", nil, "this server used to sign its updates and this one is not signed")
		}
		return "unsigned", nil
	}
	sig, err := base64.StdEncoding.DecodeString(m.Signature.Sig)
	if err != nil || m.Signature.Alg != "ed25519" || !ed25519.Verify(key, m.signedPayload(), sig) {
		return "", coded("U005", nil, "the update manifest signature is not valid")
	}
	if t.Enforced && t.NewestSeen != "" && m.ReleaseDate < t.NewestSeen && m.BuildID != t.NewestBuild {
		return "", coded("U009", nil, "the server offered an older signed release than the one already seen")
	}
	if !t.Enforced || m.ReleaseDate > t.NewestSeen {
		nt := Trust{Enforced: true, KeyID: keyID(key), NewestSeen: m.ReleaseDate, NewestBuild: m.BuildID}
		if m.ReleaseDate < t.NewestSeen {
			nt.NewestSeen, nt.NewestBuild = t.NewestSeen, t.NewestBuild
		}
		b, _ := json.MarshalIndent(nt, "", " ")
		writeAtomic(a.trustPath(), b)
	}
	return "verified", nil
}
