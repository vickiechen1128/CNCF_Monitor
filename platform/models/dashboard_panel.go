package models

// DashboardPanel stores a Grafana dashboard mounted in the custom portal.
type DashboardPanel struct {
	BaseModel
	Name string `gorm:"size:100;not null;uniqueIndex" json:"name"`
	URL  string `gorm:"size:2048;not null" json:"url"`
}

// TableName returns the dashboard panel table name.
func (DashboardPanel) TableName() string { return "dashboard_panels" }
