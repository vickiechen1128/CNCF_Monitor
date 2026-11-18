package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// This file inlines the offline-package manifest helpers previously borrowed
// from platform/edge. Keeping them inside m09 prevents the v3 binary from
// linking the whole legacy edge package (handlers, detector, etc.).

const releaseMetaFile = "release_meta.json"

var errNoPackage = errors.New("no edge offline package available")

type packageComponent struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Sha256    string `json:"sha256,omitempty"`
	SizeBytes int64  `json:"size_bytes,omitempty"`
}

type packageArtifact struct {
	ID          string             `json:"id"`
	Version     string             `json:"version"`
	File        string             `json:"file"`
	Components  []packageComponent `json:"components"`
	SizeBytes   int64              `json:"size_bytes"`
	Sha256      string             `json:"sha256"`
	DownloadURL string             `json:"download_url"`
}

var errPackageArtifactUnavailable = errors.New("edge offline package artifact unavailable")

func loadPackageManifest(dir string) (packageArtifact, error) {
	data, err := os.ReadFile(filepath.Join(dir, releaseMetaFile))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return packageArtifact{}, errPackageArtifactUnavailable
		}
		return packageArtifact{}, fmt.Errorf("read %s: %w", releaseMetaFile, err)
	}
	var art packageArtifact
	if err := json.Unmarshal(data, &art); err != nil {
		return packageArtifact{}, fmt.Errorf("parse %s: %w", releaseMetaFile, err)
	}
	if art.Version == "" {
		return packageArtifact{}, fmt.Errorf("invalid %s: version is empty", releaseMetaFile)
	}
	name := filepath.Base(art.File)
	if name == "" || name == "." || name == ".." || name == string(filepath.Separator) {
		return packageArtifact{}, errPackageArtifactUnavailable
	}
	info, err := os.Stat(filepath.Join(dir, name))
	if err != nil || info.IsDir() || info.Size() == 0 {
		return packageArtifact{}, errPackageArtifactUnavailable
	}
	art.File = name
	if art.ID == "" {
		art.ID = "release-" + art.Version
	}
	if art.SizeBytes <= 0 {
		art.SizeBytes = info.Size()
	}
	art.DownloadURL = "/api/v2/platform/edge-packages/" + art.Version + "/download"
	return art, nil
}

func listPackages(dir string) ([]packageArtifact, error) {
	art, err := loadPackageManifest(dir)
	if err != nil {
		if errors.Is(err, errPackageArtifactUnavailable) {
			return []packageArtifact{}, nil
		}
		return nil, err
	}
	return []packageArtifact{art}, nil
}

func latestPackage(dir string) (packageArtifact, error) {
	art, err := loadPackageManifest(dir)
	if err != nil {
		if errors.Is(err, errPackageArtifactUnavailable) {
			return packageArtifact{}, errNoPackage
		}
		return packageArtifact{}, err
	}
	return art, nil
}

func openPackageFile(dir string, art packageArtifact) (*os.File, error) {
	name := filepath.Base(art.File)
	if name == "" || name == "." || name == ".." || name == string(filepath.Separator) {
		return nil, errNoPackage
	}
	f, err := os.Open(filepath.Join(dir, name))
	if err != nil {
		return nil, fmt.Errorf("open package artifact %s: %w", name, err)
	}
	return f, nil
}
