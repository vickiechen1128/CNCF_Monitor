package handler

import (
	"encoding/json"
	"fmt"

	"github.com/gin-gonic/gin"
)

// decodeStrictJSON rejects unknown fields so contract violations fail with 400
// instead of being silently ignored (contract §1.5).
func decodeStrictJSON(c *gin.Context, target any) error {
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}
	return nil
}
