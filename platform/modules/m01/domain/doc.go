// Package domain holds Module 01 pure business types and rules.
//
// M01 is the strategy layer of MetricCenter: it owns exporter templates,
// default collection mappings, scrape jobs, monitoring rules and metric
// catalogues, but never renders Prometheus configuration or triggers reloads.
// The v3 requirements live in
// docs/02-product-requirements/Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md.
package domain
