package handler

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m08/service"
)

// BridgeHandler serves the Alertmanager callbacks (FR-12/FR-21). These routes
// are exempt from user authentication: Alertmanager is the caller.
type BridgeHandler struct {
	notify *service.BridgeService
	events *service.EventService
}

// NewBridgeHandler constructs the handler.
func NewBridgeHandler(notify *service.BridgeService, events *service.EventService) *BridgeHandler {
	return &BridgeHandler{notify: notify, events: events}
}

// Notify handles POST /webhooks/notify?id=<channel_id>.
func (h *BridgeHandler) Notify(c *gin.Context) {
	channelID := strings.TrimSpace(c.Query("id"))
	if channelID == "" {
		// Only the channel id is accepted; a URL parameter would let a caller
		// turn the renderer into an SSRF proxy.
		response.BadRequest(c, errRequired("id"))
		return
	}
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 4<<20))
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	var payload service.WebhookPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		response.BadRequest(c, err)
		return
	}
	if err := h.notify.Notify(c.Request.Context(), channelID, payload, raw); err != nil {
		respondError(c, err)
		return
	}
	c.Status(http.StatusOK)
}

// AlertsWebhook handles POST /webhooks/alerts. It always answers 2xx so a
// malformed delivery can never make Alertmanager retry forever (FR-21).
func (h *BridgeHandler) AlertsWebhook(c *gin.Context) {
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 8<<20))
	if err != nil {
		c.Status(http.StatusOK)
		return
	}
	var payload service.WebhookPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		log.Printf("[m08] alert webhook: discard malformed payload: %v", err)
		c.Status(http.StatusOK)
		return
	}
	result, err := h.events.Ingest(c.Request.Context(), payload)
	if err != nil {
		log.Printf("[m08] alert webhook ingest failed: %v", err)
	} else if result.Received > 0 {
		log.Printf("[m08] alert webhook %s", result.String())
	}
	c.Status(http.StatusOK)
}
