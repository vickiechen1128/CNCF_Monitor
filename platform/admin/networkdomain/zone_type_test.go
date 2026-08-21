package networkdomain

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListZoneTypesReturnsEnabledOnly(t *testing.T) {
	db := openTestDB(t)
	seedZoneTypes(t, db)

	r := newGin()
	r.GET("/zone-types", ListZoneTypes(db))

	w := perform(t, r, "GET", "/zone-types", "")
	require.Equal(t, 200, w.Code)

	var resp struct {
		Status string                 `json:"status"`
		Data   []map[string]interface{} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "success", resp.Status)
	assert.Len(t, resp.Data, 2)

	seen := map[string]bool{}
	for _, it := range resp.Data {
		code := it["code"].(string)
		seen[code] = true
		assert.NotEmpty(t, it["display_name"])
	}
	assert.True(t, seen["internet"])
	assert.True(t, seen["extranet"])
	assert.False(t, seen["dmz"], "disabled zone type must be excluded")
}

func TestListZoneTypesEmpty(t *testing.T) {
	db := openTestDB(t)

	r := newGin()
	r.GET("/zone-types", ListZoneTypes(db))

	w := perform(t, r, "GET", "/zone-types", "")
	require.Equal(t, 200, w.Code)

	var resp struct {
		Data []interface{} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.NotNil(t, resp.Data)
	assert.Empty(t, resp.Data)
}
