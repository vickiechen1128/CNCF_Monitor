// Package response provides a unified JSON response format for MetricCenter APIs.
package response

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Common status values for the unified response format.
const (
	// StatusSuccess indicates the request was processed successfully.
	StatusSuccess = "success"
	// StatusError indicates the request failed.
	StatusError = "error"
)

// Common error type identifiers for the unified response format.
const (
	// ErrorTypeBadRequest represents a client-side bad request error.
	ErrorTypeBadRequest = "bad_request"
	// ErrorTypeUnauthorized represents an authentication error.
	ErrorTypeUnauthorized = "unauthorized"
	// ErrorTypeForbidden represents an authorization error.
	ErrorTypeForbidden = "forbidden"
	// ErrorTypeNotFound represents a missing resource error.
	ErrorTypeNotFound = "not_found"
	// ErrorTypeTooManyRequests represents transient rate-limiting rejection
	// (M-1 登录失败限流：HTTP 429）。
	ErrorTypeTooManyRequests = "too_many_requests"
	// ErrorTypeInternal represents a server-side internal error.
	ErrorTypeInternal = "internal"
)

// Response is the unified JSON response structure.
//
//	{
//	  "status": "success",
//	  "data": {}
//	}
//
//	{
//	  "status": "error",
//	  "errorType": "bad_request",
//	  "error": "target instance is required"
//	}
type Response struct {
	Status    string      `json:"status"`
	Data      interface{} `json:"data,omitempty"`
	ErrorType string      `json:"errorType,omitempty"`
	Error     string      `json:"error,omitempty"`
}

// Success returns a successful response with the given data.
func Success(data interface{}) Response {
	return Response{
		Status: StatusSuccess,
		Data:   data,
	}
}

// Fail returns a failure response with the given error type and error.
// 安全原则：ErrorTypeInternal 路径对外仅返回通用文案「internal error」，
// 内部细节（err）只写日志，不回显给客户端；其余 errorType 为可预期/用户侧
// 文案（bad_request/unauthorized/forbidden/not_found/conflict），仍透传 err。
func Fail(errorType string, err error) Response {
	if errorType == ErrorTypeInternal {
		if err != nil {
			log.Printf("internal error: %v", err)
		}
		return Response{
			Status:    StatusError,
			ErrorType: errorType,
			Error:     "internal error",
		}
	}
	message := "internal error"
	if err != nil {
		message = err.Error()
	}
	return Response{
		Status:    StatusError,
		ErrorType: errorType,
		Error:     message,
	}
}

// Error returns an internal error response wrapping err.
// If err is nil, a generic internal error message is returned.
func Error(err error) Response {
	return Fail(ErrorTypeInternal, err)
}

// OK writes a successful response to the gin context.
func OK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Success(data))
}

// BadRequest writes a bad request response to the gin context.
func BadRequest(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, Fail(ErrorTypeBadRequest, err))
}

// Unauthorized writes an unauthorized response to the gin context.
func Unauthorized(c *gin.Context, message string) {
	c.JSON(http.StatusUnauthorized, Fail(ErrorTypeUnauthorized, strError(message)))
}

// Forbidden writes a forbidden response to the gin context.
func Forbidden(c *gin.Context, message string) {
	c.JSON(http.StatusForbidden, Fail(ErrorTypeForbidden, strError(message)))
}

// NotFound writes a not found response to the gin context.
func NotFound(c *gin.Context, message string) {
	c.JSON(http.StatusNotFound, Fail(ErrorTypeNotFound, strError(message)))
}

// TooManyRequests writes a rate-limit rejection (HTTP 429) to the gin context
// (M-1：登录失败限流触发锁定）。
func TooManyRequests(c *gin.Context, message string) {
	c.JSON(http.StatusTooManyRequests, Fail(ErrorTypeTooManyRequests, strError(message)))
}

// InternalServerError writes an internal server error response to the gin context.
func InternalServerError(c *gin.Context, err error) {
	c.JSON(http.StatusInternalServerError, Error(err))
}

// strError converts a plain message string into a non-nil error.
func strError(message string) error {
	return strErr(message)
}

type strErr string

func (e strErr) Error() string {
	return string(e)
}

// ErrorTypeConflict indicates an id / reference coexistence violation, e.g. a
// duplicate domain id, deletion of a non-empty domain, or freezing/deleting a
// management domain.
const ErrorTypeConflict = "conflict"

// Conflict writes a conflict response (HTTP 409) to the gin context.
func Conflict(c *gin.Context, err error) {
	c.JSON(http.StatusConflict, Fail(ErrorTypeConflict, err))
}
