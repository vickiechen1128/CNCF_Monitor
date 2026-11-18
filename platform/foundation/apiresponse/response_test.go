package response

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestSuccess(t *testing.T) {
	resp := Success(map[string]string{"key": "value"})

	assert.Equal(t, StatusSuccess, resp.Status)
	assert.Equal(t, map[string]string{"key": "value"}, resp.Data)
	assert.Empty(t, resp.ErrorType)
	assert.Empty(t, resp.Error)
}

func TestSuccessWithNilData(t *testing.T) {
	resp := Success(nil)

	assert.Equal(t, StatusSuccess, resp.Status)
	assert.Nil(t, resp.Data)
	assert.Empty(t, resp.ErrorType)
	assert.Empty(t, resp.Error)
}

func TestFail(t *testing.T) {
	resp := Fail(ErrorTypeBadRequest, errors.New("invalid parameter"))

	assert.Equal(t, StatusError, resp.Status)
	assert.Equal(t, ErrorTypeBadRequest, resp.ErrorType)
	assert.Equal(t, "invalid parameter", resp.Error)
	assert.Nil(t, resp.Data)
}

func TestError(t *testing.T) {
	resp := Error(errors.New("database connection failed"))

	assert.Equal(t, StatusError, resp.Status)
	assert.Equal(t, ErrorTypeInternal, resp.ErrorType)
	assert.Equal(t, "internal error", resp.Error)
	assert.Nil(t, resp.Data)
}

func TestErrorWithNil(t *testing.T) {
	resp := Error(nil)

	assert.Equal(t, StatusError, resp.Status)
	assert.Equal(t, ErrorTypeInternal, resp.ErrorType)
	assert.Equal(t, "internal error", resp.Error)
	assert.Nil(t, resp.Data)
}

func TestInternalErrorDetailNotEchoed(t *testing.T) {
	// security：ErrorTypeInternal 对外不回显内部错误详情，仅返回通用文案。
	resp := Error(errors.New("secret connection string: user=admin password=hunter2 host=10.0.0.5"))

	assert.Equal(t, StatusError, resp.Status)
	assert.Equal(t, ErrorTypeInternal, resp.ErrorType)
	assert.Equal(t, "internal error", resp.Error)
	assert.NotContains(t, resp.Error, "hunter2")

	// BadRequest 类仍透传用户可预期文案（不受内部错误收紧影响）。
	bad := Fail(ErrorTypeBadRequest, errors.New("job_name 不能为空"))
	assert.Equal(t, "job_name 不能为空", bad.Error)
}

func TestJSONSerializationSuccess(t *testing.T) {
	resp := Success(map[string]int{"count": 1})
	bytes, err := json.Marshal(resp)
	assert.NoError(t, err)

	var decoded map[string]interface{}
	assert.NoError(t, json.Unmarshal(bytes, &decoded))

	assert.Equal(t, StatusSuccess, decoded["status"])
	assert.Equal(t, map[string]interface{}{"count": float64(1)}, decoded["data"])
	assert.NotContains(t, decoded, "errorType")
	assert.NotContains(t, decoded, "error")
}

func TestJSONSerializationError(t *testing.T) {
	resp := Fail(ErrorTypeBadRequest, errors.New("missing field"))
	bytes, err := json.Marshal(resp)
	assert.NoError(t, err)

	var decoded map[string]interface{}
	assert.NoError(t, json.Unmarshal(bytes, &decoded))

	assert.Equal(t, StatusError, decoded["status"])
	assert.Equal(t, ErrorTypeBadRequest, decoded["errorType"])
	assert.Equal(t, "missing field", decoded["error"])
	assert.NotContains(t, decoded, "data")
}

func TestOK(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	OK(c, map[string]string{"status": "up"})

	assert.Equal(t, http.StatusOK, w.Code)

	var body Response
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, StatusSuccess, body.Status)
	assert.Equal(t, map[string]interface{}{"status": "up"}, body.Data)
	assert.Empty(t, body.ErrorType)
	assert.Empty(t, body.Error)
}

func TestBadRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	BadRequest(c, errors.New("missing field"))

	assert.Equal(t, http.StatusBadRequest, w.Code)

	var body Response
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, StatusError, body.Status)
	assert.Equal(t, ErrorTypeBadRequest, body.ErrorType)
	assert.Equal(t, "missing field", body.Error)
}

func TestUnauthorized(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	Unauthorized(c, "token expired")

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var body Response
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, StatusError, body.Status)
	assert.Equal(t, ErrorTypeUnauthorized, body.ErrorType)
	assert.Equal(t, "token expired", body.Error)
}

func TestForbidden(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	Forbidden(c, "permission denied")

	assert.Equal(t, http.StatusForbidden, w.Code)

	var body Response
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, StatusError, body.Status)
	assert.Equal(t, ErrorTypeForbidden, body.ErrorType)
	assert.Equal(t, "permission denied", body.Error)
}

func TestNotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	NotFound(c, "resource not found")

	assert.Equal(t, http.StatusNotFound, w.Code)

	var body Response
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, StatusError, body.Status)
	assert.Equal(t, ErrorTypeNotFound, body.ErrorType)
	assert.Equal(t, "resource not found", body.Error)
}

func TestInternalServerError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	InternalServerError(c, errors.New("db error"))

	assert.Equal(t, http.StatusInternalServerError, w.Code)

	var body Response
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, StatusError, body.Status)
	assert.Equal(t, ErrorTypeInternal, body.ErrorType)
	assert.Equal(t, "internal error", body.Error) // security：不回显 db error 详情
}

func TestStatusAndErrorTypeConstants(t *testing.T) {
	assert.Equal(t, "success", StatusSuccess)
	assert.Equal(t, "error", StatusError)
	assert.Equal(t, "bad_request", ErrorTypeBadRequest)
	assert.Equal(t, "unauthorized", ErrorTypeUnauthorized)
	assert.Equal(t, "forbidden", ErrorTypeForbidden)
	assert.Equal(t, "not_found", ErrorTypeNotFound)
	assert.Equal(t, "internal", ErrorTypeInternal)
}

func TestStrError(t *testing.T) {
	err := strError("something went wrong")
	assert.NotNil(t, err)
	assert.Equal(t, "something went wrong", err.Error())

	err = strError("")
	assert.NotNil(t, err)
	assert.Equal(t, "", err.Error())
}
