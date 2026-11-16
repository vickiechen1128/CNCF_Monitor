package handler

import (
	"encoding/json"
	"fmt"

	"github.com/gin-gonic/gin"
)

// bindJSON decodes a JSON body with unknown fields rejected, matching the v3
// contract ("契约外字段 → 400").
func bindJSON(c *gin.Context, out any) error {
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}
	return nil
}
