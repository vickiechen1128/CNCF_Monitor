// Package apierror defines transport-neutral error kinds shared by v3 modules.
//
// Domain and service layers may implement Coded to declare how an error should
// be presented over HTTP. The package deliberately has no Gin / HTTP dependency
// so domain packages can import it without pulling in the web framework.
package apierror

import (
	"context"
	"errors"
	"fmt"
)

// Kind is the stable, contract-level error classification.
type Kind string

// Contract error kinds (aligned with the v3 envelope errorType values).
const (
	BadRequest   Kind = "bad_request"
	Unauthorized Kind = "unauthorized"
	Forbidden    Kind = "forbidden"
	NotFound     Kind = "not_found"
	Conflict     Kind = "conflict"
	Unavailable  Kind = "unavailable"
	Internal     Kind = "internal"
)

// Coded is implemented by errors that know their contract kind.
type Coded interface {
	ErrorKind() Kind
}

// Error is the shared coded error implementation. Wrapping preserves the cause
// for logs while keeping the public message stable.
type Error struct {
	Kind    Kind
	Message string
	Err     error
}

// Error implements the error interface.
func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	return string(e.Kind)
}

// Unwrap returns the wrapped cause.
func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// ErrorKind returns the contract kind.
func (e *Error) ErrorKind() Kind {
	if e == nil {
		return Internal
	}
	if e.Kind == "" {
		return Internal
	}
	return e.Kind
}

// New constructs a coded error without a cause.
func New(kind Kind, message string) *Error {
	return &Error{Kind: kind, Message: message}
}

// Newf constructs a coded error with a formatted message.
func Newf(kind Kind, format string, args ...any) *Error {
	return New(kind, fmt.Sprintf(format, args...))
}

// Wrap attaches a cause to a coded error.
func Wrap(kind Kind, message string, err error) *Error {
	return &Error{Kind: kind, Message: message, Err: err}
}

// KindOf resolves the contract kind for err. Unknown errors are Internal so the
// HTTP adapter never leaks internal details by accident.
func KindOf(err error) Kind {
	if err == nil {
		return ""
	}
	var coded Coded
	if errors.As(err, &coded) {
		if kind := coded.ErrorKind(); kind != "" {
			return kind
		}
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return Unavailable
	}
	return Internal
}

// StatusCode maps a kind to its HTTP status code.
func StatusCode(kind Kind) int {
	switch kind {
	case BadRequest:
		return 400
	case Unauthorized:
		return 401
	case Forbidden:
		return 403
	case NotFound:
		return 404
	case Conflict:
		return 409
	case Unavailable:
		return 503
	default:
		return 500
	}
}
