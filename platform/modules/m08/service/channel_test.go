package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

func newChannelService(t *testing.T) (*ChannelService, *repository.GORMTemplateRepository) {
	t.Helper()
	g := newTestDB(t)
	templates := repository.NewTemplateRepository(g)
	return NewChannelService(
		repository.NewChannelRepository(g), templates, repository.NewSnapshotRepository(g), false,
	), templates
}

func TestChannelRejectsPrivateWebhookByDefault(t *testing.T) {
	svc, _ := newChannelService(t)
	_, err := svc.Create(context.Background(), &domain.Channel{
		Name: "内网", Type: domain.ChannelTypeWebhook, WebhookURL: "http://10.0.0.1/hook",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Webhook 地址非法")
}

func TestChannelUpdateKeepsSecretUnlessSigningDisabled(t *testing.T) {
	svc, templates := newChannelService(t)
	template := &domain.Template{
		Name: "飞书默认", ChannelType: domain.ChannelTypeFeishu, Content: "{{ .Status }}", Builtin: true,
	}
	require.NoError(t, templates.Create(context.Background(), template))
	created, err := svc.Create(context.Background(), &domain.Channel{
		Name: "飞书群", Type: domain.ChannelTypeFeishu,
		WebhookURL: "https://open.feishu.cn/hook/abc", Secret: "s3cret", SignEnabled: true,
		TemplateID: &template.ID,
	})
	require.NoError(t, err)

	// Empty secret + signing still on: keep the stored value.
	updated, err := svc.Update(context.Background(), created.ID, &domain.Channel{
		Name: "飞书群", Type: domain.ChannelTypeFeishu,
		WebhookURL: "https://open.feishu.cn/hook/abc", SignEnabled: true,
	})
	require.NoError(t, err)
	assert.Equal(t, "s3cret", updated.Secret)

	// Signing off clears it.
	cleared, err := svc.Update(context.Background(), created.ID, &domain.Channel{
		Name: "飞书群", Type: domain.ChannelTypeFeishu,
		WebhookURL: "https://open.feishu.cn/hook/abc", SignEnabled: false,
	})
	require.NoError(t, err)
	assert.Empty(t, cleared.Secret)
}
