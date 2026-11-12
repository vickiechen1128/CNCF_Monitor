package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/metriccenter/metriccenter/platform/edge"
)

// PackageComponent is one component version inside an offline package.
type PackageComponent struct {
	Name    string
	Version string
}

// EdgePackage is the read model for an offline edge package (contract §5.1).
type EdgePackage struct {
	Version    string
	File       string
	Sha256     string
	SizeBytes  int64
	ReleasedAt time.Time
	Components []PackageComponent
}

// PackageService reads the offline package manifest from the package directory
// (single-version release_meta.json written by scripts/package-edge-agent.sh).
type PackageService struct {
	dir string
}

// NewPackageService constructs the service.
func NewPackageService(dir string) *PackageService {
	return &PackageService{dir: dir}
}

// List returns the published package list; an unpackaged directory yields an
// empty list (200, not an error).
func (s *PackageService) List(_ context.Context) ([]EdgePackage, error) {
	artifacts, err := edge.ListPackages(s.dir)
	if err != nil {
		return nil, err
	}
	out := make([]EdgePackage, 0, len(artifacts))
	for _, artifact := range artifacts {
		out = append(out, s.toPackage(artifact))
	}
	return out, nil
}

// Latest returns the current package, or nil when nothing has been packaged.
func (s *PackageService) Latest(_ context.Context) (*EdgePackage, error) {
	artifact, err := edge.LatestPackage(s.dir)
	if errors.Is(err, edge.ErrNoPackage) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	item := s.toPackage(artifact)
	return &item, nil
}

// Open returns the package metadata and an open file handle for streaming. A
// file name that does not exactly match the manifest file yields (nil, nil, nil).
func (s *PackageService) Open(_ context.Context, file string) (*EdgePackage, *os.File, error) {
	artifact, err := edge.LatestPackage(s.dir)
	if errors.Is(err, edge.ErrNoPackage) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if file == "" || file != artifact.File || filepath.Base(file) != artifact.File {
		return nil, nil, nil
	}
	handle, err := edge.OpenPackageFile(s.dir, artifact)
	if err != nil {
		return nil, nil, err
	}
	item := s.toPackage(artifact)
	return &item, handle, nil
}

func (s *PackageService) toPackage(artifact edge.PackageArtifact) EdgePackage {
	released := time.Time{}
	if info, err := os.Stat(filepath.Join(s.dir, artifact.File)); err == nil {
		released = info.ModTime().UTC()
	}
	components := make([]PackageComponent, 0, len(artifact.Components))
	for _, component := range artifact.Components {
		components = append(components, PackageComponent{Name: component.Name, Version: component.Version})
	}
	return EdgePackage{
		Version:    artifact.Version,
		File:       artifact.File,
		Sha256:     artifact.Sha256,
		SizeBytes:  artifact.SizeBytes,
		ReleasedAt: released,
		Components: components,
	}
}
