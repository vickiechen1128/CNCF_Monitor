package models

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAppPlatformRelManyToManyAndUniquePair(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:app-platform-rel-pair?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&AppPlatformRel{}))

	require.NoError(t, db.Create(&AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-a"}).Error)
	require.NoError(t, db.Create(&AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-b"}).Error)

	err = db.Create(&AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-a"}).Error
	require.Error(t, err, "同一应用与平台不得重复关联")

	var count int64
	require.NoError(t, db.Model(&AppPlatformRel{}).Where("app_code = ?", "app-a").Count(&count).Error)
	assert.Equal(t, int64(2), count, "一个应用应允许关联多个平台")
}

func TestValidateAppPlatformPrimaryUnique(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:app-platform-rel-primary?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&AppPlatformRel{}))

	primary := &AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-a", IsPrimary: true}
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		if err := ValidateAppPlatformPrimaryUnique(tx, primary.AppCode, 0); err != nil {
			return err
		}
		return tx.Create(primary).Error
	}))

	err = db.Transaction(func(tx *gorm.DB) error {
		if err := ValidateAppPlatformPrimaryUnique(tx, "app-a", 0); err != nil {
			return err
		}
		return tx.Create(&AppPlatformRel{AppCode: "app-a", PlatformCode: "platform-b", IsPrimary: true}).Error
	})
	assert.ErrorIs(t, err, ErrPrimaryPlatformExists)

	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		return ValidateAppPlatformPrimaryUnique(tx, "app-a", primary.ID)
	}), "更新主关联自身时应排除当前记录")
}

func TestResourcePlatformCodeFieldMappings(t *testing.T) {
	platformCode := "platform-a"
	resources := map[ResourceCategory]any{
		ResourceCategoryHost:          &Host{PlatformCode: platformCode},
		ResourceCategoryDatabase:      &Database{ResourceBase: ResourceBase{PlatformCode: platformCode}},
		ResourceCategoryMiddleware:    &Middleware{PlatformCode: platformCode},
		ResourceCategoryApplication:   &Application{PlatformCode: platformCode},
		ResourceCategoryGenericTarget: &GenericTarget{ResourceBase: ResourceBase{PlatformCode: platformCode}},
	}

	for category, resource := range resources {
		t.Run(string(category), func(t *testing.T) {
			assert.Equal(t, "platform_code", LegacyFieldMap(category)["platform_code"])
			got, ok := GetResourceField(resource, "platform_code")
			require.True(t, ok)
			assert.Equal(t, platformCode, got)
		})
	}
}
