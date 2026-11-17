// Package handler exposes the M08 v3 HTTP surface. Handlers stay thin: they
// parse/validate transport input, delegate to services and map errors onto the
// shared envelope.
package handler
