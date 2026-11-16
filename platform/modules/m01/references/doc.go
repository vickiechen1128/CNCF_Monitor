// Package references provides read-only cross-module adapters for M01.
//
// Planned ports:
//   - Resources: M07 v3 resources (instance candidates, addresses, labels);
//   - LabelTemplates: M07 label templates (blocked on D-3);
//   - Domains: M06 `network_domains` + M09 `network_domain_access` eligibility.
//
// All reads are read-only; M01 never writes another module's tables.
package references
