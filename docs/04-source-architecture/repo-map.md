# MetricCenter Repo Map（业务代码符号地图）

> 由 `make repo-map`（`scripts/repo-map`）自动生成，**请勿手改**。
> 生成时间: 2026-11-23 10:55 · commit: `997e638`
> 覆盖范围: `platform/`（Go）与 `ui-custom/web/src/`（TS/TSX）；`upstream/` 上游子模块刻意不索引（只读且体量巨大），其架构结论见本目录其他文档。
> 用法: 先用本文件按「符号名 → 文件路径」定位，再 `Read` 目标文件；查不到再降级为 Grep 全文搜索。

## platform/（Go 后端）

### `platform/cmd/metric-center/main.go`

- `func registerDeprecatedFlags()`
- `func main()`
- `func parseURL(raw string) (*url.URL, error)`
- `func registerSPA(r *gin.Engine, dir string) error`

### `platform/cmd/metric-center/main_static_test.go`

- `func newStaticTestDir(t *testing.T) string`
- `func newSPAEngine(t *testing.T, dir string) *gin.Engine`
- `func serve(t *testing.T, r *gin.Engine, path string) *httptest.ResponseRecorder`
- `func TestRegisterSPA_ServesIndexAndAssets(t *testing.T)`
- `func TestRegisterSPA_HistoryFallback(t *testing.T)`
- `func TestRegisterSPA_APIRoutesTakePrecedence(t *testing.T)`
- `func TestRegisterSPA_UnknownAPIReturns404NotHTML(t *testing.T)`
- `func TestRegisterSPA_PathTraversalBlocked(t *testing.T)`
- `func TestRegisterSPA_InvalidDir(t *testing.T)`

### `platform/cmd/metric-center/route_probe_test.go`

- `func TestRouteProbeParamNameConflict(t *testing.T)`

### `platform/cmd/metric-center/v3.go`

- `func runV3(ctx context.Context)`
- `func setupV3Router(ctx context.Context, staticDir string, m06Opts m06.Options) (*gin.Engine, error)`
- `type m07ChangeNotifier struct`
- `method (m07ChangeNotifier) ResourceChanged(_ context.Context, domainIDs ...string)`
- `method (m07ChangeNotifier) AllResourcesChanged(_ context.Context)`
- `method (m07ChangeNotifier) run(domainIDs []string, all bool)`
- `func mountV3Modules(ctx context.Context, platform, edge *gin.RouterGroup, m06Opts m06.Options) (*m09.Module, error)`
- `type v3AuthModule struct`
- `method (v3AuthModule) Name() string`
- `method (v3AuthModule) RegisterRoutes(platform *gin.RouterGroup) error`
- `func serveHTTP(ctx context.Context, handler http.Handler)`
- `func alertmanagerHost() string`
- `func alertmanagerBaseURL() *url.URL`
- `func amReloadURL() *url.URL`
- `func amConfigDir() string`
- `func bridgeBaseURL() string`

### `platform/cmd/metric-center/v3_test.go`

- `func TestSetupV3RouterMountsSystemM06M07(t *testing.T)`
- `func v3LoginToken(t *testing.T, router http.Handler, username, password string) string`
- `func TestV3UserDisableInvalidatesSession(t *testing.T)`
- `func TestV3StorageRoutesUseInjectedOptions(t *testing.T)`
- `type fakeMonitoringRetirer struct`
- `method (*fakeMonitoringRetirer) Available() bool`
- `method (*fakeMonitoringRetirer) Impact(context.Context, string) (references.MonitoringImpact, error)`
- `method (*fakeMonitoringRetirer) RetireDomain(_ context.Context, domainID string) error`
- `func doV3JSON(t *testing.T, router http.Handler, method, path, token, body string) (int, map[string]any)`
- `func TestV3M06EndToEndDomainLifecycle(t *testing.T)`
- `func TestV3CloudDictMaintenanceEndToEnd(t *testing.T)`

### `platform/cmd/migrate/main.go`

- `func main()`

### `platform/db/collection_template_migration_test.go`

- `func TestMigrateV3CollectionTemplates(t *testing.T)`
- `func seedCollectionTemplateLegacy(t *testing.T, dsn string)`
- `func verifyCollectionTemplateMigration(t *testing.T, sqlDB *sql.DB)`
- `func verifyCollectionTemplateDown(t *testing.T, dsn string)`

### `platform/db/config_snapshots_merge_test.go`

- `func migrateV3UpTo(t *testing.T, driver, dsn string, target int64)`
- `func seedPreMergeSnapshots(t *testing.T, exec func(string, ...any) error)`
- `func requireLegacyTableGone(t *testing.T, sqlDB *sql.DB, table string)`
- `func verifyMergedSnapshots(t *testing.T, sqlDB *sql.DB)`
- `func TestConfigSnapshotsMergeBackfill(t *testing.T)`

### `platform/db/db.go`

- `func utcNow() time.Time`
- `func DBDriver() string`
- `func DSN() string`
- `func OpenDB(driver, dsn string) (*gorm.DB, error)`
- `func InitV3() error`

### `platform/db/db_test.go`

- `func TestInitV3Postgres(t *testing.T)`

### `platform/db/dsn_env_test.go`

- `func TestDSNSegmentedEnv(t *testing.T)`
- `func TestDSNFullOverrideWins(t *testing.T)`
- `func TestDSNDefaults(t *testing.T)`

### `platform/db/m01_migration_test.go`

- `func TestMigrateV3M01Strategy(t *testing.T)`

### `platform/db/m07_dictionary_lifecycle_cloud_zone_migration_test.go`

- `func TestMigrateV3CloudZoneDictionaryLifecycle(t *testing.T)`

### `platform/db/m07_label_template_migration_test.go`

- `func TestMigrateV3M07LabelTemplates(t *testing.T)`

### `platform/db/m08_migration_test.go`

- `func TestMigrateV3M08Alerting(t *testing.T)`

### `platform/db/m09_center_rules_migration_test.go`

- `func TestMigrateV3M09CenterRules(t *testing.T)`

### `platform/db/migrate.go`

- `type migration struct`
- `type appliedMigration struct`
- `type MigrationStatus struct`
- `func postgresDSNSimpleProtocol(dsn string) string`
- `func sqlLiteral(s string) string`
- `func openMigrationDB(driver, dsn string) (*sql.DB, error)`
- `func loadV3Migrations(driver string) ([]migration, error)`
- `func parseMigrationName(filename, driver string) (version int64, name string, ok bool, err error)`
- `func migrationChecksum(up, down string) string`
- `func splitGooseSections(raw string) (up, down string)`
- `func ensureMigrationTable(sqlDB *sql.DB, driver string) error`
- `func migrationChecksumColumnExists(sqlDB *sql.DB, driver string) (bool, error)`
- `func appliedMigrations(sqlDB *sql.DB) (map[int64]appliedMigration, error)`
- `func MigrateV3(driver, dsn string) error`
- `func V3MigrationStatus(driver, dsn string) ([]MigrationStatus, error)`
- `func MigrateV3Status(driver, dsn string) error`
- `func MigrateV3Down(driver, dsn string) error`
- `func MigrateV3Steps(driver, dsn string, steps int) error`
- `func MigrateV3DownTo(driver, dsn string, target int64) error`
- `func rollbackMigration(sqlDB *sql.DB, m migration) error`

### `platform/db/migrate_test.go`

- `func TestMigrateV3Lifecycle(t *testing.T)`
- `func TestMigrateV3DropsLegacyDomainColumns(t *testing.T)`
- `func TestMigrateV3ForeignKeysEnforced(t *testing.T)`
- `func TestMigrateV3ResourceConstraints(t *testing.T)`
- `func TestMigrateV3M06DomainAdministration(t *testing.T)`
- `func TestMigrateV3M09EdgePlatform(t *testing.T)`
- `func TestParseMigrationName(t *testing.T)`
- `func TestSplitGooseSections(t *testing.T)`

### `platform/db/monitor_type_registry_migration_test.go`

- `func TestMigrateV3MonitorTypeRegistryAndCapabilities(t *testing.T)`

### `platform/db/pg_test_support_test.go`

- `func testPostgresDSN(t *testing.T) string`
- `func openTestSQL(t *testing.T, dsn string) *sql.DB`
- `func requireTableCount(t *testing.T, sqlDB *sql.DB, table string, want int)`
- `func requireColumnCount(t *testing.T, sqlDB *sql.DB, table, column string, want int)`
- `func requireIndexCount(t *testing.T, sqlDB *sql.DB, index string, want int)`
- `func rollbackV3To(t *testing.T, dsn string, target int64)`
- `func testWithSearchPath(dsn, schema string) string`
- `func quoteIdent(s string) string`
- `func randomHex(n int) string`

### `platform/db/seed/admin.go`

- `func runAdminUser(db *gorm.DB) error`

### `platform/db/seed/admin_test.go`

- `func TestRunSeedsAdminUser(t *testing.T)`
- `func TestRunAdminIsIdempotent(t *testing.T)`
- `func TestRunAdminKeepsModifiedPassword(t *testing.T)`
- `func TestRunAdminPasswordFromEnv(t *testing.T)`
- `func TestAdminUser_ProductionRequiresEnvPassword(t *testing.T)`

### `platform/db/seed/business_domain.go`

- `type yamlBusinessDomain struct`
- `func BusinessDomains(db *gorm.DB, path string) error`
- `func readBusinessDomainsFile(path string) ([]yamlBusinessDomain, error)`

### `platform/db/seed/business_domain_test.go`

- `func openBizSeedTestDB(t *testing.T) *gorm.DB`
- `func writeBizSeedYAML(t *testing.T, content string) string`
- `func countBizCodes(t *testing.T, db *gorm.DB) []string`
- `func TestBusinessDomainsDoesNotSeedInfra(t *testing.T)`
- `func TestBusinessDomainsImportsExplicitYAML(t *testing.T)`
- `func TestBusinessDomainsSkipsWhenNonEmpty(t *testing.T)`
- `func TestBusinessDomainsIdempotent(t *testing.T)`
- `func TestBusinessDomainsMissingFileIsNoop(t *testing.T)`
- `func TestBusinessDomainsNilDBReturnsError(t *testing.T)`

### `platform/db/seed/cloud_dict.go`

- `func runCloudDicts(db *gorm.DB) error`

### `platform/db/seed/cloud_dict_test.go`

- `func TestRunSeedsCloudDictIdempotently(t *testing.T)`
- `func TestRunCloudDictsRealignsPresetValues(t *testing.T)`

### `platform/db/seed/core_v3.go`

- `func CoreV3(db *gorm.DB, businessDomainsPath string) error`
- `func reconcileTenantDomainAuthorizations(db *gorm.DB) error`
- `func sameStringSet(a, b []string) bool`

### `platform/db/seed/helpers.go`

- `func firstOrCreate(db *gorm.DB, out any, query string, args ...any) error`

### `platform/db/seed/helpers_test.go`

- `func newTestDB(t *testing.T) *gorm.DB`
- `func countRows(t *testing.T, db *gorm.DB, model any, out *int64)`

### `platform/db/seed/metric_library.go`

- `type builtinMetricSeed struct`
- `func BuiltinMetricLibrary() []builtinMetricSeed`

### `platform/db/seed/ten_domain.go`

- `func runTenantAndDomain(db *gorm.DB) error`

### `platform/db/seed_core_v3_test.go`

- `func TestCoreV3SeedIdempotent(t *testing.T)`
- `func TestCoreV3ReconcilesTenantDomainAuthorizations(t *testing.T)`

### `platform/db/v3_domain_type_alignment_test.go`

- `func TestV3DomainTypeCheckRejectsNonEdge(t *testing.T)`

### `platform/edge-sync-agent/cmd/edge-sync-agent/heartbeat.go`

- `type runtimeProvider struct`
- `method (*runtimeProvider) Snapshot() puller.RuntimeSnapshot`
- `method (*runtimeProvider) warnf(format string, args ...any)`

### `platform/edge-sync-agent/cmd/edge-sync-agent/heartbeat_test.go`

- `func badApplyZip(t *testing.T, version string) []byte`
- `func goodApplyZip(t *testing.T, version string) []byte`
- `func applyZip(t *testing.T, version, targetsJSON string) []byte`
- `func TestRuntimeProviderSnapshotCarriesApplyError(t *testing.T)`
- `func TestRuntimeProviderSnapshot(t *testing.T)`
- `type stubProbe struct`
- `method (stubProbe) Ready(*supervisor.Component) bool`
- `method (stubProbe) Alive(*supervisor.Component) bool`
- `method (stubProbe) Healthy(*supervisor.Component) bool`
- `method (stubProbe) Start(*supervisor.Component) error`
- `method (stubProbe) Stop(*supervisor.Component) error`
- `func TestRuntimeProviderSnapshotCarriesTargets(t *testing.T)`
- `func TestRuntimeProviderSnapshotCarriesRemoteWriteStats(t *testing.T)`
- `func TestRuntimeProviderSnapshotTargetsDegrade(t *testing.T)`
- `func TestEnvOr(t *testing.T)`
- `func TestVersionFlagString(t *testing.T)`

### `platform/edge-sync-agent/cmd/edge-sync-agent/main.go`

- `func main()`
- `func run() error`
- `func restoreComponents(sv *supervisor.Supervisor, dep *deployer.Deployer, cfg *config.Config)`
- `func hasBlackboxYML(dep *deployer.Deployer, ver string) bool`
- `func localIP() string`

### `platform/edge-sync-agent/cmd/edge-sync-agent/pdeathsig_linux.go`

- `func configureSysProcAttr(cmd *exec.Cmd)`

### `platform/edge-sync-agent/cmd/edge-sync-agent/pdeathsig_linux_test.go`

- `func TestConfigureSysProcAttrSetsPdeathsig(t *testing.T)`

### `platform/edge-sync-agent/cmd/edge-sync-agent/pdeathsig_other.go`

- `func configureSysProcAttr(_ *exec.Cmd)`

### `platform/edge-sync-agent/cmd/edge-sync-agent/pdeathsig_other_test.go`

- `func TestConfigureSysProcAttrNoopOnNonLinux(t *testing.T)`

### `platform/edge-sync-agent/cmd/edge-sync-agent/probe.go`

- `func sameArgs(a, b []string) bool`
- `type procSpec struct`
- `type ProcProbe struct`
- `func NewProcProbe(configDir func() string, centerEndpoint string, out io.Writer) *ProcProbe`
- `method (*ProcProbe) Ready(c *supervisor.Component) bool`
- `method (*ProcProbe) Alive(c *supervisor.Component) bool`
- `method (*ProcProbe) Healthy(c *supervisor.Component) bool`
- `method (*ProcProbe) Start(c *supervisor.Component) error`
- `method (*ProcProbe) Stop(c *supervisor.Component) error`
- `method (*ProcProbe) Signal(typ string, sig syscall.Signal) error`
- `method (*ProcProbe) Reload(typ string) error`
- `method (*ProcProbe) RestartCollector() error`
- `method (*ProcProbe) FlushBacklog() error`
- `method (*ProcProbe) StopAll()`
- `func httpGetOK(ctx context.Context, cli *http.Client, url string) error`
- `func tcpProbe(ctx context.Context, addr string) error`
- `func envOr(key, def string) string`
- `func metadataRemoteWriteURL(versionDir string) string`
- `func metadataMaxDiskUsage(versionDir string) string`
- `func readVersionMetadata(versionDir string) contract.Metadata`
- `func resolveMaxDiskUsagePerURL(metadataVal string) string`
- `func resolveRemoteWriteURL(metadataURL, centerEndpoint string) string`

### `platform/edge-sync-agent/cmd/edge-sync-agent/probe_test.go`

- `func TestHTTPGetOK200AndNon200(t *testing.T)`
- `func TestTCPProbe(t *testing.T)`
- `func TestProcProbeReadyRequiresConfigFile(t *testing.T)`
- `func TestProcProbeSignalWhenNotRunning(t *testing.T)`
- `func TestProcProbeTimeoutSetting(t *testing.T)`
- `func TestSameArgs(t *testing.T)`
- `func TestProcProbeReloadNotRunning(t *testing.T)`
- `func TestResolveRemoteWriteURL(t *testing.T)`
- `func TestMetadataRemoteWriteURL(t *testing.T)`
- `func TestResolveMaxDiskUsagePerURL(t *testing.T)`
- `func TestMetadataMaxDiskUsage(t *testing.T)`
- `func TestCollectorArgsCarryMaxDiskUsage(t *testing.T)`

### `platform/edge-sync-agent/cmd/edge-sync-agent/vmremote.go`

- `type vmRemoteWriteStats struct`
- `method (vmRemoteWriteStats) BacklogBytes() int64`
- `func fetchVMAgentRemoteWriteStats(ctx context.Context, cli *http.Client, baseURL string, warnf func(format string, args ...a…`
- `func parsePromGauge(body, metric string) (float64, bool)`
- `func parsePromSum(body, metric string) float64`
- `func cutMetricLine(line, metric string) (string, bool)`
- `func parsePromValue(rest string) (float64, bool)`

### `platform/edge-sync-agent/cmd/edge-sync-agent/vmremote_test.go`

- `func TestParsePromGauge(t *testing.T)`
- `func TestFetchVMAgentRemoteWriteStats(t *testing.T)`
- `func TestFetchVMAgentRemoteWriteStatsNoFailure(t *testing.T)`
- `func TestFetchVMAgentRemoteWriteStatsDegrades(t *testing.T)`
- `func TestParsePromSum(t *testing.T)`
- `func TestBacklogBytes(t *testing.T)`
- `func TestFetchVMAgentRemoteWriteStatsPersistentQueue(t *testing.T)`

### `platform/edge-sync-agent/cmd/edge-sync-agent/vmtargets.go`

- `type vmTargetResp struct`
- `type vmTargetRespData struct`
- `type vmTarget struct`
- `func parseEdgeTargets(b []byte) ([]contract.EdgeTargetSnapshot, error)`
- `func fetchVMAgentTargets(ctx context.Context, cli *http.Client, baseURL string, warnf func(format string, args ...any)) ([]c…`
- `func newVMTargetsClient() *http.Client`

### `platform/edge-sync-agent/cmd/edge-sync-agent/vmtargets_test.go`

- `func TestParseEdgeTargetsFullMapping(t *testing.T)`
- `func TestParseEdgeTargetsEmptyActive(t *testing.T)`
- `func TestParseEdgeTargetsInvalidJSON(t *testing.T)`
- `func TestFetchVMAgentTargets(t *testing.T)`
- `func TestFetchVMAgentTargetsContractType(t *testing.T)`

### `platform/edge-sync-agent/internal/app/app.go`

- `type Service interface`
- `type Probe interface`
- `type Options struct`
- `type Runner struct`
- `func NewRunner(opts Options) *Runner`
- `method (*Runner) Run(ctx context.Context)`

### `platform/edge-sync-agent/internal/app/app_test.go`

- `type fakeService struct`
- `func newFakeService(runCount *int32) *fakeService`
- `method (*fakeService) Run(ctx context.Context)`
- `type fakeProbe struct`
- `method (*fakeProbe) StopAll()`
- `func TestRunnerStartsServicesAndStopsProbe(t *testing.T)`
- `func TestRunnerNilProbeAndStepAreSafe(t *testing.T)`

### `platform/edge-sync-agent/internal/client/client.go`

- `type Client struct`
- `func NewClient(cfg *config.Config, tok *token.Store, logg *logger.Logger) *Client`
- `method (*Client) heartbeatEndpoint() string`
- `method (*Client) bearer() string`
- `method (*Client) Heartbeat(ctx context.Context, hb contract.HeartbeatRequest) (*contract.HeartbeatResponse, error)`
- `method (*Client) PullConfig(ctx context.Context, url, etag string) ([]byte, bool, error)`
- `method (*Client) WaitAuthBackoff(ctx context.Context) (time.Duration, bool)`
- `method (*Client) ConsecutiveAuthFailures() int`
- `method (*Client) infof(f string, a ...any)`
- `method (*Client) warnf(f string, a ...any)`
- `method (*Client) sleep(ctx context.Context, d time.Duration)`

### `platform/edge-sync-agent/internal/client/client_test.go`

- `func testCfg(endpoint string) *config.Config`
- `func newTestClient(endpoint string, clock func() time.Time) *Client`
- `func TestHeartbeatSuccessParsesResponse(t *testing.T)`
- `func TestHeartbeatReturnsAuthOn401(t *testing.T)`
- `func TestPullConfigReturnsBytes(t *testing.T)`
- `func TestPullConfigSendsIfNoneMatchAndHandles304(t *testing.T)`
- `func TestPullConfigAuthOn401(t *testing.T)`
- `func TestWaitAuthBackoffBackoffSequenceAndDowngrade(t *testing.T)`
- `func TestWaitAuthBackoffLogsDowngrade(t *testing.T)`

### `platform/edge-sync-agent/internal/config/config.go`

- `type Config struct`
- `func Defaults() *Config`
- `func Load() (*Config, error)`
- `func DefaultAgentTypeOverride(envKey string) string`
- `func envDefault(key, def string) string`

### `platform/edge-sync-agent/internal/config/config_test.go`

- `func TestDefaultsValues(t *testing.T)`
- `func TestLoadMissingRequired(t *testing.T)`
- `func TestLoadWithEnv(t *testing.T)`

### `platform/edge-sync-agent/internal/contract/contract.go`

- `type EdgeTargetSnapshot struct`
- `type Component struct`
- `type HeartbeatRequest struct`
- `type HeartbeatResponse struct`
- `type Metadata struct`

### `platform/edge-sync-agent/internal/contract/contract_test.go`

- `func TestHeartbeatRequestJSONRoundTrip(t *testing.T)`
- `func TestHeartbeatRequestJSONCarriesRemoteWriteStats(t *testing.T)`
- `func TestHeartbeatResponseJSON(t *testing.T)`
- `func TestMetadataJSONAlignsCenter(t *testing.T)`
- `func TestPathConstants(t *testing.T)`
- `func TestEdgeTargetSnapshotJSONTag(t *testing.T)`
- `func TestHeartbeatRequestJSONCarriesTargets(t *testing.T)`
- `func TestHeartbeatRequestJSONCarriesApplyError(t *testing.T)`

### `platform/edge-sync-agent/internal/deployer/deployer.go`

- `type ComponentType = string`
- `type Reloader`
- `type Validator`
- `type ApplyState struct`
- `method (ApplyState) Failed() bool`
- `type Deployer struct`
- `func New(root, netDomainID string, logg *logger.Logger, validate Validator, promReload, bbReload Reloader) *Deployer`
- `method (*Deployer) DomainDir() string`
- `method (*Deployer) VersionDir(version string) string`
- `method (*Deployer) CurrentVersion() string`
- `method (*Deployer) CurrentMetadata() contract.Metadata`
- `method (*Deployer) CurrentDir() string`
- `method (*Deployer) setCurrentLink(version string)`
- `method (*Deployer) currentMetadata() contract.Metadata`
- `method (*Deployer) Restore() error`
- `method (*Deployer) Apply(ctx context.Context, zipBytes []byte, meta *contract.Metadata) error`
- `method (*Deployer) ApplyState() ApplyState`
- `method (*Deployer) applyStatePath() string`
- `method (*Deployer) recordApplyFailure(version string, err error)`
- `method (*Deployer) clearApplyState()`
- `method (*Deployer) loadApplyState()`
- `method (*Deployer) triggerReload(ctx context.Context, pkg *Package)`
- `method (*Deployer) stagingDir() string`
- `func writePackage(dir string, pkg *Package) error`

### `platform/edge-sync-agent/internal/deployer/deployer_test.go`

- `func buildZip(t *testing.T, prom string, targets map[string]string, rules, blackbox string) []byte`
- `func defaultTargets() map[string]string`
- `type rec struct`
- `method (*rec) reload(_ context.Context, c ComponentType, _ string) error`
- `method (*rec) count() int`
- `func newDeployer(t *testing.T, promRel, bbRel Reloader) (*Deployer, string)`
- `func TestApplyAtomicSwitch(t *testing.T)`
- `func TestApplyIdempotentSameVersion(t *testing.T)`
- `func TestApplyTargetsInvalidRollback(t *testing.T)`
- `func TestApplyReloadOnlyOnPromChange(t *testing.T)`
- `func TestApplyBlackboxTriggersReload(t *testing.T)`
- `func TestApplyMissingPrometheusRejected(t *testing.T)`
- `func TestVerifyTargetsJSON(t *testing.T)`
- `func TestStructuralValidateTopKeys(t *testing.T)`
- `func TestZipSlipTargetRejected(t *testing.T)`
- `func TestApplyMetadataRemoteWriteURLPersisted(t *testing.T)`
- `func TestApplyFailureStatePersistedAndRestored(t *testing.T)`
- `func TestApplyFailureStateWithoutCurrentLink(t *testing.T)`
- `func readDiskMetadata(t *testing.T, d *Deployer, version string) contract.Metadata`
- `func TestApplySameVersionParamsChangedReapply(t *testing.T)`
- `func TestApplySameVersionParamsUnchangedSkips(t *testing.T)`
- `func TestApplySameVersionRemoteWriteURLChangedReapply(t *testing.T)`

### `platform/edge-sync-agent/internal/deployer/extract.go`

- `type Package struct`
- `func extractPackage(zipBytes []byte, meta *contract.Metadata) (*Package, error)`
- `func ValidateTargetsJSON(name, content string) error`
- `func validateTargetName(name string) error`
- `func readEntry(f *zip.File) ([]byte, error)`

### `platform/edge-sync-agent/internal/deployer/validate.go`

- `func StructuralValidate(pkg *Package) error`
- `func hasLineKey(content, key string) bool`
- `func marshalMetadata(m *contract.Metadata) ([]byte, error)`

### `platform/edge-sync-agent/internal/logger/logger.go`

- `type Logger struct`
- `func New(w io.Writer) *Logger`
- `func SyslogOrStderr() io.Writer`
- `method (*Logger) Infof(format string, a ...any)`
- `method (*Logger) Warnf(format string, a ...any)`
- `method (*Logger) Errorf(format string, a ...any)`
- `method (*Logger) Close()`

### `platform/edge-sync-agent/internal/logger/logger_test.go`

- `func TestLoggerLevelsToWriter(t *testing.T)`
- `func TestSyslogOrStderrNonNil(t *testing.T)`

### `platform/edge-sync-agent/internal/logger/syslog_linux.go`

- `func syslogWriter() (io.Writer, bool)`

### `platform/edge-sync-agent/internal/logger/syslog_other.go`

- `func syslogWriter() (io.Writer, bool)`

### `platform/edge-sync-agent/internal/puller/checksum.go`

- `func VerifyChecksum(zipBytes []byte) (*contract.Metadata, error)`
- `func recomputeChecksum(content map[string]string) string`
- `func readZipFile(f *zip.File) ([]byte, error)`

### `platform/edge-sync-agent/internal/puller/puller.go`

- `type RuntimeSnapshot struct`
- `type RuntimeProvider interface`
- `type Deployer interface`
- `type Puller struct`
- `func NewPuller(cfg *config.Config, tok *token.Store, cli *client.Client, runtime RuntimeProvider, deploy Deployer, logg *log…`
- `type staticRuntime struct`
- `method (staticRuntime) Snapshot() RuntimeSnapshot`
- `method (*Puller) Run(ctx context.Context)`
- `method (*Puller) RunOnce(ctx context.Context) error`
- `type restartState struct`
- `method (*Puller) handleFlushCommand(resp *contract.HeartbeatResponse) error`
- `method (*Puller) handleRestartCommand(resp *contract.HeartbeatResponse) error`
- `method (*Puller) setExecutedRestartSeq(seq int64)`
- `method (*Puller) setExecutedFlushSeq(seq int64)`
- `method (*Puller) persistRestartState()`
- `method (*Puller) loadRestartState()`
- `method (*Puller) buildHeartbeat() contract.HeartbeatRequest`
- `method (*Puller) pullAndVerify(ctx context.Context, url string) error`
- `method (*Puller) handleAuth(ctx context.Context) bool`
- `method (*Puller) LastValidConfig() []byte`
- `method (*Puller) LastValidMetadata() *contract.Metadata`
- `method (*Puller) infof(f string, a ...any)`
- `method (*Puller) warnf(f string, a ...any)`

### `platform/edge-sync-agent/internal/puller/puller_test.go`

- `func buildZip(t *testing.T, promYML string, metaChecksum string) []byte`
- `type fakeDeploy struct`
- `method (*fakeDeploy) Apply(_ context.Context, zipBytes []byte, meta *contract.Metadata) error`
- `method (*fakeDeploy) count() int`
- `type fakeRuntime struct`
- `method (fakeRuntime) Snapshot() RuntimeSnapshot`
- `func TestBuildHeartbeatCarriesTargets(t *testing.T)`
- `func testConfig(endpoint string) *config.Config`
- `type testServer struct`
- `func newTestServer(hb contract.HeartbeatResponse, zipBody []byte) *testServer`
- `func newPuller(cfg *config.Config, ts *testServer, deploy Deployer, rt RuntimeProvider) *Puller`
- `func newPullerWithRestart(cfg *config.Config, ts *testServer, deploy Deployer, rt RuntimeProvider, onRestart func() error, s…`
- `func TestRunOnceValidConfigDeploysAndRetains(t *testing.T)`
- `func TestRunOnceChecksumMismatchRetainsLastValid(t *testing.T)`
- `func TestVerifyChecksumValidAndMismatch(t *testing.T)`
- `func TestBuildHeartbeatCarriesMetadataParams(t *testing.T)`
- `func TestRunOnceParamsChangedForcesPull(t *testing.T)`
- `func TestRunOnceNetworkErrorRetainsAndRecovers(t *testing.T)`
- `func TestRunOnceRestartSeqTriggersCallbackAndPersists(t *testing.T)`
- `func TestRunOnceRestartSeqFailureRetries(t *testing.T)`
- `func newPullerWithFlush(cfg *config.Config, ts *testServer, deploy Deployer, rt RuntimeProvider, onFlush func() error, state…`
- `func TestRunOnceFlushSeqTriggersCallbackAndPersists(t *testing.T)`
- `func TestRunOnceFlushSeqFailureRetries(t *testing.T)`
- `func TestNoFlushCallbackStillAdvancesSeq(t *testing.T)`

### `platform/edge-sync-agent/internal/supervisor/supervisor.go`

- `type Params struct`
- `func DefaultParams() Params`
- `type Probe interface`
- `type Component struct`
- `method (*Component) Snapshot() contract.Component`
- `type Supervisor struct`
- `func NewSupervisor(params Params, probe Probe, logg *logger.Logger) *Supervisor`
- `method (*Supervisor) Reconcile(want []contract.Component)`
- `method (*Supervisor) getOrCreate(typ string) *Component`
- `method (*Supervisor) Get(typ string) *Component`
- `method (*Supervisor) ResetIfCrashLoop(typ string) bool`
- `method (*Supervisor) Reset(typ string)`
- `method (*Supervisor) SetInject(clock func() time.Time, sleep func(ctx context.Context, d time.Duration))`
- `method (*Supervisor) Snapshot() []contract.Component`
- `method (*Supervisor) Run(ctx context.Context)`
- `method (*Supervisor) StepOnce(ctx context.Context)`
- `func rank(order []string, typ string) int`
- `method (*Supervisor) tick(ctx context.Context, typ string)`
- `func pruneRestarts(ts []time.Time, now time.Time, window time.Duration) []time.Time`
- `func minDur(a, b time.Duration) time.Duration`

### `platform/edge-sync-agent/internal/supervisor/supervisor_test.go`

- `type fakeProbe struct`
- `func newFakeProbe() *fakeProbe`
- `method (*fakeProbe) Ready(c *Component) bool`
- `method (*fakeProbe) Alive(c *Component) bool`
- `method (*fakeProbe) Healthy(c *Component) bool`
- `method (*fakeProbe) Start(c *Component) error`
- `method (*fakeProbe) Stop(c *Component) error`
- `method (*fakeProbe) CountStart(typ string) int`
- `method (*fakeProbe) ListStarts() []string`
- `func newTestSupervisor(t *testing.T, probe Probe) (*Supervisor, func() time.Time, *time.Time)`
- `func TestDualJudgmentProcessDeathGate(t *testing.T)`
- `func TestDualJudgmentAliveButUnhealthy(t *testing.T)`
- `func TestBackoffAndBreakerEntersCrashLoop(t *testing.T)`
- `func TestOrchestrationBlackboxBeforeCollector(t *testing.T)`
- `func TestSnapshotReportsContractView(t *testing.T)`
- `func TestNotReadyDoesNotCountRestarts(t *testing.T)`
- `func TestResetIfCrashLoop(t *testing.T)`
- `func TestResetClearsCrashLoopAndRetainsGuard(t *testing.T)`

### `platform/edge-sync-agent/internal/token/token.go`

- `type Store struct`
- `func NewStore(token string) *Store`
- `method (*Store) Get() string`
- `method (*Store) Refresh(t string)`
- `type Throttle struct`
- `func NewThrottle(min, max, downgradeAfter, downgradeInterval time.Duration, clock func() time.Time) *Throttle`
- `method (*Throttle) Reset()`
- `method (*Throttle) Next() (interval time.Duration, downgraded bool)`
- `method (*Throttle) Consecutive() int`

### `platform/edge-sync-agent/internal/token/token_test.go`

- `func TestThrottleBackoffSequence(t *testing.T)`
- `func TestThrottleDowngradeAfterDuration(t *testing.T)`
- `func TestThrottleReset(t *testing.T)`
- `func TestTokenStore(t *testing.T)`

### `platform/foundation/apierror/apierror.go`

- `type Kind = string`
- `type Coded interface`
- `type Error struct`
- `method (*Error) Error() string`
- `method (*Error) Unwrap() error`
- `method (*Error) ErrorKind() Kind`
- `func New(kind Kind, message string) *Error`
- `func Newf(kind Kind, format string, args ...any) *Error`
- `func Wrap(kind Kind, message string, err error) *Error`
- `func KindOf(err error) Kind`

### `platform/foundation/apierror/apierror_test.go`

- `func TestKindOf(t *testing.T)`
- `func TestErrorDefaults(t *testing.T)`
- `type legacyCoded struct`
- `method (legacyCoded) Error() string`
- `method (legacyCoded) ErrorKind() Kind`
- `func TestKindOfInterface(t *testing.T)`

### `platform/foundation/apiresponse/response.go`

- `type Response struct`
- `func Success(data interface{}) Response`
- `func Fail(errorType string, err error) Response`
- `func Error(err error) Response`
- `func OK(c *gin.Context, data interface{})`
- `func BadRequest(c *gin.Context, err error)`
- `func BadRequestWithDetails(c *gin.Context, errorType string, err error, data interface{})`
- `func Unauthorized(c *gin.Context, message string)`
- `func Forbidden(c *gin.Context, message string)`
- `func NotFound(c *gin.Context, message string)`
- `func TooManyRequests(c *gin.Context, message string)`
- `func InternalServerError(c *gin.Context, err error)`
- `func BadGateway(c *gin.Context, err error, message string)`
- `func ServiceUnavailable(c *gin.Context, err error)`
- `func strError(message string) error`
- `type strErr = string`
- `method (strErr) Error() string`
- `func Conflict(c *gin.Context, err error)`

### `platform/foundation/apiresponse/response_test.go`

- `func TestSuccess(t *testing.T)`
- `func TestSuccessWithNilData(t *testing.T)`
- `func TestFail(t *testing.T)`
- `func TestError(t *testing.T)`
- `func TestErrorWithNil(t *testing.T)`
- `func TestInternalErrorDetailNotEchoed(t *testing.T)`
- `func TestJSONSerializationSuccess(t *testing.T)`
- `func TestJSONSerializationError(t *testing.T)`
- `func TestOK(t *testing.T)`
- `func TestBadRequest(t *testing.T)`
- `func TestUnauthorized(t *testing.T)`
- `func TestForbidden(t *testing.T)`
- `func TestNotFound(t *testing.T)`
- `func TestInternalServerError(t *testing.T)`
- `func TestStatusAndErrorTypeConstants(t *testing.T)`
- `func TestStrError(t *testing.T)`

### `platform/foundation/httpapi/errors.go`

- `func WriteError(c *gin.Context, err error)`

### `platform/foundation/httpapi/errors_test.go`

- `func writeAndDecode(t *testing.T, err error) (int, map[string]any)`
- `func TestWriteErrorMapsKinds(t *testing.T)`
- `func TestWriteErrorNil(t *testing.T)`

### `platform/foundation/httpx/middleware.go`

- `func RequestID() gin.HandlerFunc`
- `func RequestIDFrom(c *gin.Context) string`
- `func AccessLog(logger *log.Logger) gin.HandlerFunc`
- `func newRequestID() string`
- `func validRequestID(id string) bool`

### `platform/foundation/httpx/middleware_test.go`

- `func TestRequestIDPropagatesIncoming(t *testing.T)`
- `func TestRequestIDGeneratesAndRejectsInjection(t *testing.T)`
- `func TestRequestIDFromNilContext(t *testing.T)`

### `platform/foundation/module/registry.go`

- `type Module interface`
- `type Registry struct`
- `func NewRegistry() *Registry`
- `method (*Registry) Register(m Module) error`
- `method (*Registry) Mount(group *gin.RouterGroup) error`
- `method (*Registry) Names() []string`
- `method (*Registry) Len() int`

### `platform/foundation/module/registry_test.go`

- `type fakeModule struct`
- `method (fakeModule) Name() string`
- `method (fakeModule) RegisterRoutes(*gin.RouterGroup) error`
- `func TestRegistryRegisterAndMount(t *testing.T)`
- `func TestRegistryRejectsInvalidModules(t *testing.T)`
- `func TestRegistryMountError(t *testing.T)`
- `func TestRegistryNilGroup(t *testing.T)`

### `platform/foundation/system/system.go`

- `type Options struct`
- `type Module struct`
- `func NewModule(db *gorm.DB, opts Options) *Module`
- `method (*Module) Name() string`
- `method (*Module) RegisterRoutes(platform *gin.RouterGroup) error`
- `method (*Module) health(c *gin.Context)`
- `method (*Module) ready(c *gin.Context)`
- `method (*Module) meta(c *gin.Context)`
- `method (*Module) probe(ctx context.Context) (int64, error)`
- `func buildVersion() string`

### `platform/foundation/system/system_test.go`

- `func newTestRouter(t *testing.T) (*gin.Engine, *Module)`
- `func getJSON(t *testing.T, router *gin.Engine, path string) (int, map[string]any)`
- `func TestHealth(t *testing.T)`
- `func TestReadyWithMigratedDatabase(t *testing.T)`
- `func TestReadyWithoutDatabase(t *testing.T)`
- `func TestMeta(t *testing.T)`
- `func TestNewModuleDefaults(t *testing.T)`

### `platform/gateway/auth/admin_middleware.go`

- `func RequireAdmin() gin.HandlerFunc`

### `platform/gateway/auth/admin_middleware_test.go`

- `func ctxUserRouter(u *models.User, noContext bool) *gin.Engine`
- `func TestRequireAdmin_AdminAllowed(t *testing.T)`
- `func TestRequireAdmin_RegularUserRejected(t *testing.T)`
- `func TestRequireAdmin_NoUserInContextRejected(t *testing.T)`
- `func TestRequireAdmin_DisabledAdminRejected(t *testing.T)`
- `func TestRequireAdmin_WrongContextTypeRejected(t *testing.T)`

### `platform/gateway/auth/handler.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`
- `type Handler struct`
- `func NewHandler(svc *Service) *Handler`
- `type loginUserDTO struct`
- `type meDTO struct`
- `type loginRequest struct`
- `type changePasswordRequest struct`
- `method (*Handler) Login(c *gin.Context)`
- `method (*Handler) Logout(c *gin.Context)`
- `method (*Handler) Me(c *gin.Context)`
- `method (*Handler) ChangePassword(c *gin.Context)`
- `func bearerToken(c *gin.Context) string`
- `func writeError(c *gin.Context, err error)`
- `func errInvalidPayload(err error) error`

### `platform/gateway/auth/handler_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func newTestRouter(db *gorm.DB) *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path, body, token string) *httptest.ResponseRecorder`
- `type envelope struct`
- `func decodeEnvelope(t *testing.T, w *httptest.ResponseRecorder) envelope`
- `func seedUser(t *testing.T, db *gorm.DB, id, username, displayName, password string) *models.User`
- `func loginAndToken(t *testing.T, r *gin.Engine, username, password string) string`
- `func countSessions(t *testing.T, db *gorm.DB, userID string) int64`
- `func countLoginLogs(t *testing.T, db *gorm.DB, username string) int64`
- `func TestLogin_Success(t *testing.T)`
- `func TestLogin_Failure_UnifiedAndLogged(t *testing.T)`
- `func TestLogin_DisabledUser(t *testing.T)`
- `func TestLogin_ResponseNeverLeaksPasswordHash(t *testing.T)`
- `func TestLogin_MalformedJSON(t *testing.T)`
- `func TestLogout_Idempotent(t *testing.T)`
- `func TestLogout_MissingToken(t *testing.T)`
- `func TestMe_ValidToken(t *testing.T)`
- `func TestMe_InvalidOrMissingToken(t *testing.T)`
- `func TestMe_ExpiredSession(t *testing.T)`
- `func TestMe_DisabledUserSessionInvalid(t *testing.T)`
- `func TestChangePassword_SuccessInvalidatesSessions(t *testing.T)`
- `func TestChangePassword_WrongOldPassword(t *testing.T)`
- `func TestChangePassword_Validation(t *testing.T)`
- `func TestAuthenticate_ReuseFixture(t *testing.T)`
- `func TestGenerateToken_StrengthAndUniqueness(t *testing.T)`

### `platform/gateway/auth/middleware.go`

- `func CurrentUser(c *gin.Context) *models.User`
- `func CurrentUsername(c *gin.Context) string`
- `func AuthMiddleware(svc *Service) gin.HandlerFunc`

### `platform/gateway/auth/middleware_test.go`

- `func newMiddlewareRouter(db *gorm.DB) *gin.Engine`
- `func loginToken(t *testing.T, db *gorm.DB, username, password string) string`
- `func unmarshalData(t *testing.T, raw json.RawMessage, v interface{})`
- `func TestMiddleware_AnonymousProtectedRejected(t *testing.T)`
- `func TestMiddleware_LoginAndHealthBypass(t *testing.T)`
- `func TestMiddleware_ValidTokenPasses(t *testing.T)`
- `func TestMiddleware_ExpiredLogoutDisabledRejected(t *testing.T)`
- `func TestMiddleware_OptionsPreflightPasses(t *testing.T)`
- `func TestMiddleware_NoAuthorization(t *testing.T)`
- `func TestMiddleware_NonAPIPathBypassesAuth(t *testing.T)`

### `platform/gateway/auth/ratelimit_test.go`

- `func TestLoginRateLimiter_ThresholdLocksAndExpires(t *testing.T)`
- `func TestLoginRateLimiter_WindowSlidingReset(t *testing.T)`
- `func TestLoginRateLimiter_ResetClears(t *testing.T)`
- `func TestLogin_RateLimitLocksAfterThreshold(t *testing.T)`
- `func TestLogin_RateLimitResetAfterSuccess(t *testing.T)`

### `platform/gateway/auth/repository.go`

- `type Repository struct`
- `func NewRepository(db *gorm.DB) *Repository`
- `method (*Repository) FindUserByUsername(username string) (*models.User, error)`
- `method (*Repository) FindUserByID(id string) (*models.User, error)`
- `method (*Repository) SaveUser(u *models.User) error`
- `method (*Repository) CreateSession(sess *models.Session) error`
- `method (*Repository) FindSessionByToken(token string) (*models.Session, error)`
- `method (*Repository) DeleteSessionByToken(token string) error`
- `method (*Repository) DeleteSessionsByUserID(userID string) error`
- `method (*Repository) CreateLoginLog(log *models.LoginLog) error`

### `platform/gateway/auth/service.go`

- `type loginAttempt struct`
- `type loginRateLimiter struct`
- `func newLoginRateLimiter() *loginRateLimiter`
- `method (*loginRateLimiter) checkLocked(username string, now time.Time) bool`
- `method (*loginRateLimiter) recordFailure(username string, now time.Time) bool`
- `method (*loginRateLimiter) reset(username string)`
- `type ValidationError struct`
- `method (*ValidationError) Error() string`
- `func newValidationError(format string, args ...interface{}) *ValidationError`
- `type Service struct`
- `func NewService(repo *Repository) *Service`
- `type LoginResult struct`
- `method (*Service) Login(username, password, ip string) (*LoginResult, error)`
- `method (*Service) Logout(token string) error`
- `method (*Service) Authenticate(token string) (*models.User, error)`
- `method (*Service) ChangePassword(token, oldPassword, newPassword string) error`
- `method (*Service) logLogin(username string, success bool, message, ip string)`
- `func validatePassword(password string) error`

### `platform/gateway/auth/token.go`

- `func generateToken() (string, error)`
- `func newID() (string, error)`

### `platform/models/alert_event.go`

- `type AlertEventStatus = string`
- `type AlertEvent struct`
- `method (AlertEvent) TableName() string`

### `platform/models/alertmanager_config.go`

- `type AlertmanagerConfigStatus = string`
- `type AlertmanagerConfigVersion struct`
- `method (AlertmanagerConfigVersion) TableName() string`
- `method (AlertmanagerConfigVersion) MarshalJSON() ([]byte, error)`
- `func formatAMTimeOrNil(t *time.Time) *string`
- `type SilenceMatcher struct`
- `type SilenceStatus = string`
- `type ValidateErrorItem struct`

### `platform/models/alertmanager_config_test.go`

- `func TestAlertmanagerConfigStatusEnum(t *testing.T)`
- `func TestAlertmanagerConfigVersionSerializationRoundTrip(t *testing.T)`
- `type AlertmanagerConfigVersionView struct`
- `func TestAlertmanagerConfigVersionAutoMigrate(t *testing.T)`
- `func TestSilenceMatcherJSONRoundTrip(t *testing.T)`
- `func TestValidateErrorItemJSON(t *testing.T)`

### `platform/models/alertmanager_notify.go`

- `type NotifyChannelType = string`
- `type NotifyChannel struct`
- `method (NotifyChannel) TableName() string`
- `type NotifyTemplateStatus = string`
- `type NotifyTemplate struct`
- `method (NotifyTemplate) TableName() string`

### `platform/models/alertmanager_notify_test.go`

- `func newNotifyModelDB(t *testing.T) *gorm.DB`
- `func TestNotifyChannelMigrateAndPersist(t *testing.T)`
- `func TestNotifyTemplateMigrateAndChecksum(t *testing.T)`

### `platform/models/app_platform_rel.go`

- `type AppPlatformRel struct`
- `func ValidateAppPlatformPrimaryUnique(tx *gorm.DB, appCode string, excludeRelID uint) error`

### `platform/models/app_platform_rel_test.go`

- `func TestAppPlatformRelManyToManyAndUniquePair(t *testing.T)`
- `func TestValidateAppPlatformPrimaryUnique(t *testing.T)`

### `platform/models/application_dict.go`

- `type ApplicationDict struct`

### `platform/models/blackbox_module.go`

- `type BlackboxModule struct`
- `func DefaultBlackboxModules() []BlackboxModule`

### `platform/models/blackbox_probe.go`

- `type BlackboxProbeConfig struct`

### `platform/models/blackbox_target.go`

- `type BlackboxTargetProtocol = string`
- `func ValidBlackboxTargetProtocols() []BlackboxTargetProtocol`
- `func ValidBlackboxTargetProtocol(p string) bool`
- `type BlackboxTarget struct`

### `platform/models/business_domain.go`

- `type DictSource = string`
- `type BusinessDomain struct`

### `platform/models/business_domain_test.go`

- `func TestBusinessDomainJSONTags(t *testing.T)`

### `platform/models/business_metric.go`

- `type BusinessMetricSource = string`
- `type BusinessMetricStatus = string`
- `type BusinessMetric struct`
- `method (BusinessMetric) TableName() string`

### `platform/models/cloud_dict.go`

- `type CloudType = string`
- `type CloudCarrier = string`
- `type CloudDict struct`

### `platform/models/cloud_dict_test.go`

- `func TestCloudDictModel(t *testing.T)`
- `func TestCloudDictDisabledPersistsWithoutGORMDefault(t *testing.T)`

### `platform/models/config.go`

- `type DraftStatus = string`
- `type ConfigDraft struct`
- `method (ConfigDraft) TableName() string`
- `func jsonCarrier(s string) *json.RawMessage`
- `func timeOfNullable(d gorm.DeletedAt) *time.Time`
- `method (ConfigDraft) MarshalJSON() ([]byte, error)`
- `type ConfigVersion struct`
- `method (ConfigVersion) TableName() string`
- `method (ConfigVersion) MarshalJSON() ([]byte, error)`
- `type DeploymentStatus = string`
- `type ConfigDeployment struct`
- `method (ConfigDeployment) TableName() string`
- `type VersionRef struct`
- `type RollbackDiffItem struct`
- `type RollbackPreview struct`
- `method (ConfigDeployment) MarshalJSON() ([]byte, error)`

### `platform/models/config_center_rules.go`

- `type ValidationStatus = string`
- `type ValidationCause = string`
- `type ValidationSource = string`
- `type ValidationDetail struct`
- `type ConfigSyncStatus = string`
- `type OutOfSyncCause = string`
- `type ChangeItemTarget = string`
- `type ChangeItemType = string`
- `type Risk = string`
- `type AffectedFile = string`
- `type ConfigChangeItem struct`
- `type AffectedConfigFile struct`
- `type ConfigDraftMetadata struct`
- `func ValidValidationStatus() []string`
- `func ValidChangeItemTargets() []string`
- `func ValidChangeItemTypes() []string`
- `func ValidRisks() []string`
- `func ValidAffectedFiles() []string`
- `func IsValidValidationStatus(s string) bool`
- `func IsValidRisk(r string) bool`
- `func TokenMasked(token string) string`

### `platform/models/config_change_baseline.go`

- `type ChangeDetectStatus = string`
- `type ConfigChangeBaseline struct`
- `method (ConfigChangeBaseline) TableName() string`

### `platform/models/dashboard_panel.go`

- `type DashboardPanel struct`
- `method (DashboardPanel) TableName() string`

### `platform/models/database.go`

- `type Database struct`
- `method (*Database) GetResourceType() ResourceType`
- `method (*Database) GetResourceCategory() ResourceCategory`

### `platform/models/edge_agent.go`

- `type EdgeAgent struct`
- `method (EdgeAgent) TableName() string`

### `platform/models/edge_heartbeat.go`

- `type ComponentType = string`
- `type ComponentStatus = string`
- `type EdgeComponent struct`
- `type EdgeHeartbeat struct`
- `method (EdgeHeartbeat) TableName() string`

### `platform/models/edge_target_snapshot.go`

- `type EdgeTargetSnapshot struct`
- `method (EdgeTargetSnapshot) TableName() string`

### `platform/models/exporter_installation_confirmation.go`

- `type InstallationStatus = string`
- `type ExporterInstallationConfirmation struct`
- `method (ExporterInstallationConfirmation) TableName() string`

### `platform/models/exporter_metric_library.go`

- `type MetricType = string`
- `type ExporterMetricAnchor struct`
- `type ExporterMetricLibrary struct`
- `method (ExporterMetricLibrary) TableName() string`

### `platform/models/exporter_template.go`

- `type ExporterSource = string`
- `type ExporterTemplate struct`
- `func BuiltinExporterTemplates() []ExporterTemplate`

### `platform/models/generic_target.go`

- `type GenericTarget struct`
- `method (*GenericTarget) GetResourceType() ResourceType`
- `method (*GenericTarget) GetResourceCategory() ResourceCategory`

### `platform/models/host.go`

- `type Host struct`
- `method (*Host) GetResourceID() string`
- `method (*Host) GetResourceType() ResourceType`
- `method (*Host) GetAppCode() string`
- `method (*Host) GetCloudCode() string`
- `method (*Host) GetEnv() string`
- `method (*Host) GetCluster() string`
- `method (*Host) GetStatus() string`
- `method (*Host) GetResourceCategory() ResourceCategory`
- `method (*Host) Hostname() string`
- `method (*Host) InstanceIP() string`
- `method (*Host) OSType() string`

### `platform/models/import_record.go`

- `type ImportMode = string`
- `type ImportStatus = string`
- `type ImportErrorDetail struct`
- `type ImportRecord struct`

### `platform/models/interface_service.go`

- `type InterfaceService struct`
- `method (*InterfaceService) GetResourceType() ResourceType`
- `method (*InterfaceService) GetResourceCategory() ResourceCategory`

### `platform/models/label_rules.go`

- `func IsProtectedLabel(key string) bool`
- `func IsSystemInjectedLabel(key string) bool`
- `func ValidateLabelKey(key string) error`

### `platform/models/label_template.go`

- `type LabelSourceType = string`
- `type LabelMapping struct`
- `type LabelTemplate struct`
- `method (*LabelTemplate) NormalizeMappings()`
- `func DefaultMappingBuilders(category ResourceCategory) []LabelMapping`

### `platform/models/label_template_snapshot.go`

- `type MappingChange struct`
- `type LabelTemplateSnapshot struct`

### `platform/models/models_test.go`

- `func TestResourceTypeConstants(t *testing.T)`
- `func TestHostImplementsResource(t *testing.T)`
- `func TestHostResourceIDFallback(t *testing.T)`
- `func TestHostTemplateFields(t *testing.T)`
- `func TestMiddlewareImplementsResource(t *testing.T)`
- `func TestApplicationImplementsResource(t *testing.T)`
- `func TestAutoMigrate(t *testing.T)`
- `func TestHostSoftDelete(t *testing.T)`
- `func TestResourceCategoryConstants(t *testing.T)`
- `func TestResourceInterfaceImplementations(t *testing.T)`
- `func TestResourceStatusMapping(t *testing.T)`
- `func TestTenantCreateAndDefaults(t *testing.T)`
- `func TestNetworkDomainModelMatchesV3Schema(t *testing.T)`
- `func TestZoneTypePresetCodes(t *testing.T)`
- `func TestResourceBaseAndLabel(t *testing.T)`
- `func TestLabelTemplateByCategory(t *testing.T)`
- `func TestDefaultTemplatesContainResourceID(t *testing.T)`
- `func TestBuiltinTemplates(t *testing.T)`
- `func TestScrapeJobAndMonitoringRule(t *testing.T)`
- `func TestConfigModelsSmoke(t *testing.T)`
- `func TestEdgeAgentAndBusinessMetric(t *testing.T)`
- `func newMemDB(t *testing.T) *gorm.DB`
- `func TestScrapeJobSecretsNotSerialized(t *testing.T)`
- `func TestHostSharedContractColumns(t *testing.T)`
- `func TestImportRecordErrorsJSONRoundTrip(t *testing.T)`
- `func TestProtectedPrometheusLabels(t *testing.T)`
- `func TestLabelRules(t *testing.T)`
- `func TestBlackboxTargetJSONRoundTrip(t *testing.T)`
- `func TestScrapeJobBlackboxTargetsPersistence(t *testing.T)`
- `func TestExporterMetricLibraryMonitorTypesSerialization(t *testing.T)`
- `func TestExporterInstallationConfirmationDefaultAndPK(t *testing.T)`
- `func TestInstallationStatusEnums(t *testing.T)`
- `func TestConfigCenterEnumConstants(t *testing.T)`
- `func TestConfigCenterValidationStatus(t *testing.T)`
- `func TestConfigCenterEnumCollections(t *testing.T)`
- `func TestConfigChangeItemJSONRoundTrip(t *testing.T)`
- `func TestConfigDraftMetadataJSONRoundTrip(t *testing.T)`
- `func TestConfigDeploymentStatusValues(t *testing.T)`
- `func TestTokenMasked(t *testing.T)`
- `func TestLabelTemplateSnapshotSmoke(t *testing.T)`
- `func TestEdgeComponentGuardEnums(t *testing.T)`
- `func TestRegistrationStatusEnums(t *testing.T)`
- `func TestEdgeComponentJSONRoundTripAndTimeSerialization(t *testing.T)`
- `func TestEdgeHeartbeatComponentsPersistence(t *testing.T)`
- `func TestEdgeAgentSyncFieldsAndComponents(t *testing.T)`
- `func TestDefaultMappingBuildersInterfaceServiceHasNoComposite(t *testing.T)`

### `platform/models/monitoring_rule.go`

- `type RuleContentMode = string`
- `type ScopeType = string`
- `type MonitoringRule struct`

### `platform/models/network_domain.go`

- `type DomainType = string`
- `type DomainStatus = string`
- `type ChannelType = string`
- `type AgentType = string`
- `type RegistrationStatus = string`
- `type NetworkDomain struct`
- `method (NetworkDomain) TableName() string`

### `platform/models/os_dict.go`

- `type OSOption struct`
- `func ListOSOptions() []OSOption`
- `func osKeywordsFor(family string) []string`
- `func OSKeywordsForLinux() []string`
- `func OSKeywordsForWindows() []string`

### `platform/models/os_dict_test.go`

- `func TestOSKeywordsFor(t *testing.T)`
- `func TestOSOptionsAllClassified(t *testing.T)`
- `func familyNames(family string) []string`
- `func contains(kws []string, kw string) bool`

### `platform/models/platform_dict.go`

- `type PlatformDict struct`

### `platform/models/resource.go`

- `type ResourceType = string`
- `type BaseModel struct`
- `type Resource interface`
- `type Middleware struct`
- `type Application struct`
- `method (*Middleware) GetResourceID() string`
- `method (*Middleware) GetResourceType() ResourceType`
- `method (*Middleware) GetAppCode() string`
- `method (*Middleware) GetCloudCode() string`
- `method (*Middleware) GetEnv() string`
- `method (*Middleware) GetCluster() string`
- `method (*Middleware) GetStatus() string`
- `method (*Application) GetResourceID() string`
- `method (*Application) GetResourceType() ResourceType`
- `method (*Application) GetAppCode() string`
- `method (*Application) GetCloudCode() string`
- `method (*Application) GetEnv() string`
- `method (*Application) GetCluster() string`
- `method (*Application) GetStatus() string`
- `method (*Middleware) GetResourceCategory() ResourceCategory`
- `method (*Application) GetResourceCategory() ResourceCategory`

### `platform/models/resource_base.go`

- `type SourceType = string`
- `type ResourceBase struct`
- `method (*ResourceBase) GetResourceID() string`
- `method (*ResourceBase) GetAppCode() string`
- `method (*ResourceBase) GetCloudCode() string`
- `method (*ResourceBase) GetEnv() string`
- `method (*ResourceBase) GetCluster() string`
- `method (*ResourceBase) GetStatus() string`

### `platform/models/resource_category.go`

- `type ResourceCategory = string`
- `func ValidResourceCategories() []ResourceCategory`

### `platform/models/resource_label.go`

- `type LabelSource = string`
- `type ResourceLabel struct`

### `platform/models/scrape_job.go`

- `type JobType = string`
- `type AuthType = string`
- `type ChangeStatus = string`
- `type MappingOverride struct`
- `type InstanceSelectionMode = string`
- `type ScrapeJob struct`

### `platform/models/status_mapping.go`

- `type ResourceStatus = string`
- `type ResourceStatusMapping struct`
- `func DefaultStatusMappings() []ResourceStatusMapping`

### `platform/models/tenant.go`

- `type TenantStatus = string`
- `type Tenant struct`
- `method (Tenant) TableName() string`

### `platform/models/user.go`

- `type UserStatus = string`
- `type User struct`
- `method (User) TableName() string`
- `type Session struct`
- `method (Session) TableName() string`
- `type LoginLog struct`
- `method (LoginLog) TableName() string`

### `platform/models/user_test.go`

- `func TestUserTableNames(t *testing.T)`
- `func TestUserJSONDoesNotExposePasswordHash(t *testing.T)`
- `func TestUserStatusConstants(t *testing.T)`
- `func TestSessionTTLSemantic(t *testing.T)`
- `func TestSessionJSONContract(t *testing.T)`
- `func TestLoginLogJSONContract(t *testing.T)`

### `platform/models/zone_type.go`

- `type ZoneTypeCode = string`
- `type ZoneType struct`

### `platform/modules/m01/domain/builtin_collection_templates.go`

- `func BuiltinCollectionTemplates() []CollectionTemplate`
- `func BuiltinCollectionTemplate(code string) (CollectionTemplate, bool)`

### `platform/modules/m01/domain/candidate_fields.go`

- `type FieldKind = string`
- `type FieldSpec struct`
- `method (FieldSpec) AppliesTo(category ResourceCategory) bool`
- `method (FieldSpec) Supports(operator RuleOperator) bool`
- `method (FieldSpec) ValidateValue(value string) error`
- `func FieldSpecs() []FieldSpec`
- `func FieldSpecFor(key string) (FieldSpec, bool)`
- `func AllowedFieldKeys() []string`

### `platform/modules/m01/domain/collection_template.go`

- `type CollectionTemplate struct`
- `func ValidateCollectionTemplate(t CollectionTemplate) error`
- `func ValidateCollectionTemplateCode(code string) error`
- `func NormalizeCollectionTemplate(t *CollectionTemplate)`

### `platform/modules/m01/domain/collection_template_test.go`

- `func newTemplate() domain.CollectionTemplate`
- `func TestBuiltinCollectionTemplatesByCategory(t *testing.T)`
- `func TestBuiltinCollectionTemplatesAreValidRecipes(t *testing.T)`
- `func TestBuiltinHostTemplatesAreOrthogonal(t *testing.T)`
- `func TestValidateCollectionTemplate(t *testing.T)`
- `func TestNormalizeCollectionTemplate(t *testing.T)`
- `func TestValidateSelectorRejectsUnknownField(t *testing.T)`
- `func TestValidateSelectorRejectsFieldOutsideCategory(t *testing.T)`
- `func TestValidateSelectorRejectsBooleanArbitraryValue(t *testing.T)`
- `func TestValidateSelectorRejectsContainsOnBoolean(t *testing.T)`
- `func TestValidateSelectorValueArity(t *testing.T)`
- `func TestValidateSelectorAcceptsSupportedShapes(t *testing.T)`
- `func TestValidateSelectorRejectsUnknownLogic(t *testing.T)`
- `func TestValidateSelectorAcceptsRegisteredCustomFields(t *testing.T)`
- `func TestFieldDictionaryCoversCapabilities(t *testing.T)`

### `platform/modules/m01/domain/entities.go`

- `type SyncState struct`
- `type MappingOverride struct`
- `type ExporterTemplate struct`
- `type Job struct`
- `type JobGroup struct`
- `type Rule struct`
- `type MetricAnchor struct`
- `type Metric struct`
- `type BusinessMetric struct`
- `type Installation struct`
- `type ProbeModule struct`

### `platform/modules/m01/domain/enums.go`

- `type JobType = string`
- `method (JobType) Valid() bool`
- `type ResourceCategory = string`
- `method (ResourceCategory) Valid() bool`
- `type AuthType = string`
- `method (AuthType) Valid() bool`
- `type Scheme = string`
- `method (Scheme) Valid() bool`
- `type InstanceSelectionMode = string`
- `method (InstanceSelectionMode) Valid() bool`
- `type DraftStatus = string`
- `method (DraftStatus) Valid() bool`
- `type JobGroupStatus = string`
- `method (JobGroupStatus) Valid() bool`
- `type SyncStatus = string`
- `method (SyncStatus) Valid() bool`
- `type ExporterSource = string`
- `method (ExporterSource) Valid() bool`
- `type RuleContentMode = string`
- `method (RuleContentMode) Valid() bool`
- `type RuleScope = string`
- `type RuleType = string`
- `method (RuleType) Valid() bool`
- `type MetricType = string`
- `method (MetricType) Valid() bool`
- `type BusinessMetricStatus = string`
- `method (BusinessMetricStatus) Valid() bool`
- `type RegisterSource = string`
- `method (RegisterSource) Valid() bool`
- `type InstallationStatus = string`
- `method (InstallationStatus) Valid() bool`

### `platform/modules/m01/domain/errors.go`

- `type ValidationError struct`
- `method (*ValidationError) Error() string`
- `method (*ValidationError) ErrorKind() apierror.Kind`
- `func NewValidationError(field, message string) *ValidationError`
- `func NewValidationErrorf(field, format string, args ...any) *ValidationError`
- `type NotFoundError struct`
- `method (*NotFoundError) Error() string`
- `method (*NotFoundError) ErrorKind() apierror.Kind`
- `type ConflictError struct`
- `method (*ConflictError) Error() string`
- `method (*ConflictError) ErrorKind() apierror.Kind`
- `type ForbiddenError struct`
- `method (*ForbiddenError) Error() string`
- `method (*ForbiddenError) ErrorKind() apierror.Kind`

### `platform/modules/m01/domain/id.go`

- `func NewID() (string, error)`

### `platform/modules/m01/domain/job.go`

- `func ValidateJobName(name string) error`
- `func TargetFieldForCategory(category ResourceCategory) (string, error)`
- `type JobParams struct`
- `func ResolveJobParams(input JobParams, template *CollectionTemplate, exporter *ExporterTemplate, category ResourceCategory) …`
- `func ComputeTemplateOverrides(input, effective JobParams, template *CollectionTemplate) []MappingOverride`
- `func ResolvePort(ref ResourceRef, templatePort, exporterPort int) int`
- `func ResourceAddress(ref ResourceRef, mappingPort, exporterPort int) string`
- `func HostFromURL(raw string) string`
- `func ResolvePortWithSource(ref ResourceRef, mappingPort, exporterPort int) (int, string)`

### `platform/modules/m01/domain/label_template.go`

- `type LabelTemplateRef struct`

### `platform/modules/m01/domain/params.go`

- `func ValidDuration(s string) bool`
- `func ParseDurationSeconds(s string) (int64, bool)`
- `func ValidateScrapeTiming(interval, timeout string) error`
- `func ValidateMetricsPath(path string) error`
- `func ValidatePort(port int) error`

### `platform/modules/m01/domain/params_test.go`

- `func TestValidDuration(t *testing.T)`
- `func TestParseDurationSeconds(t *testing.T)`
- `func TestValidateScrapeTiming(t *testing.T)`
- `func TestValidateMetricsPathAndPort(t *testing.T)`
- `func TestCollectionTemplateCodeHelpers(t *testing.T)`

### `platform/modules/m01/domain/port_source_test.go`

- `func TestResolvePortWithSource(t *testing.T)`

### `platform/modules/m01/domain/resource.go`

- `type ResourceRef struct`
- `method (ResourceRef) Selectable() bool`
- `type DomainRef struct`
- `method (DomainRef) AuthorizedFor(tenantID string) bool`
- `method (DomainRef) Eligible() bool`
- `type CandidateFilterOp = string`
- `type CandidateFilter struct`
- `type CandidateQuery struct`
- `type CandidatePage struct`
- `type DomainHit struct`

### `platform/modules/m01/domain/rule.go`

- `type RuleGroup struct`
- `type RuleEntry struct`
- `type RuleFile struct`
- `type JobRefIssue struct`
- `func ParseRules(content string) (*RuleFile, error)`
- `method (*RuleFile) GroupNames() []string`
- `method (*RuleFile) RuleCount() int`
- `method (*RuleFile) JobRefIssues(jobNames []string) []JobRefIssue`
- `func ruleJobRefIssues(group string, rule RuleEntry, jobs map[string]struct{}) []JobRefIssue`
- `func jobExists(jobs map[string]struct{}, op, ref string) (bool, bool)`

### `platform/modules/m01/domain/selector.go`

- `type Selector struct`
- `type ScopeFilter struct`
- `type RuleLogic = string`
- `method (RuleLogic) Valid() bool`
- `type RuleOperator = string`
- `method (RuleOperator) Valid() bool`
- `method (Selector) Empty() bool`
- `method (Selector) Normalize() Selector`
- `func ValidateSelector(selector Selector, category ResourceCategory) error`
- `func ValidateSelectorWith(selector Selector, category ResourceCategory, isCustomField func(key string) bool) error`
- `func validateScopeFilter(category ResourceCategory, filter ScopeFilter, isCustomField func(string) bool) error`
- `func validateCustomFilter(filter ScopeFilter) error`
- `func prefixSelectorField(index int, field string) string`
- `func itoa(value int) string`

### `platform/modules/m01/dto/business_metric.go`

- `type BusinessMetricRequest struct`
- `method (BusinessMetricRequest) ToDomain() *domain.BusinessMetric`
- `type BusinessMetricResponse struct`
- `func FromBusinessMetric(item *domain.BusinessMetric) BusinessMetricResponse`

### `platform/modules/m01/dto/candidate_query.go`

- `type CandidateFilterRequest struct`
- `type CandidateQueryRequest struct`
- `type CandidateIDsRequest struct`
- `type DomainHitResponse struct`
- `type CandidateQueryResponse struct`
- `type CandidateIDsResponse struct`
- `type CandidateFilterFieldResponse struct`
- `type CandidateFilterOptionResponse struct`
- `type CandidateFilterSchemaResponse struct`

### `platform/modules/m01/dto/collection_template.go`

- `type SelectorFilterDTO struct`
- `method (SelectorFilterDTO) ToDomain() domain.ScopeFilter`
- `func FromScopeFilter(filter domain.ScopeFilter) SelectorFilterDTO`
- `type SelectorDTO struct`
- `method (SelectorDTO) ToDomain() domain.Selector`
- `func FromSelector(selector domain.Selector) SelectorDTO`
- `type CollectionTemplateResponse struct`
- `func FromCollectionTemplate(t *domain.CollectionTemplate, exporterName, labelName string, jobCount int64) CollectionTemplate…`
- `type CollectionTemplateRequest struct`
- `method (CollectionTemplateRequest) ToDomain(code string) domain.CollectionTemplate`
- `type CandidateFieldResponse struct`
- `func FromFieldSpec(spec domain.FieldSpec) CandidateFieldResponse`
- `func NewCustomFieldResponse(key, label, kind, category string) CandidateFieldResponse`
- `type TemplateImpactResponse struct`

### `platform/modules/m01/dto/exporter_template.go`

- `type ExporterTemplateRequest struct`
- `method (ExporterTemplateRequest) ToDomain() *domain.ExporterTemplate`
- `type ExporterTemplateResponse struct`
- `func FromExporterTemplate(item *domain.ExporterTemplate) ExporterTemplateResponse`
- `func FromExporterTemplates(items []*domain.ExporterTemplate) []ExporterTemplateResponse`

### `platform/modules/m01/dto/job.go`

- `type JobRequest struct`
- `method (JobRequest) ToDomain() *domain.Job`
- `type SyncResponse struct`
- `type JobResponse struct`
- `func FromJob(job *domain.Job, exporterName, domainName, labelName, groupName string) JobResponse`

### `platform/modules/m01/dto/job_group.go`

- `type JobGroupRequest struct`
- `type JobGroupStatusRequest struct`
- `type JobGroupSyncResponse struct`
- `type JobGroupChildResponse struct`
- `type JobGroupResponse struct`
- `type AdoptJobGroupRequest struct`

### `platform/modules/m01/dto/job_instances.go`

- `type CandidateResponse struct`
- `func FromCandidate(ref domain.ResourceRef, templateCode, targetAddress string, selectable bool, disabledReason string) Candi…`
- `type InstallationResponse struct`
- `func FromInstallation(item *domain.Installation) *InstallationResponse`
- `type JobInstanceResponse struct`
- `type InstallationRequest struct`
- `type PreviewTarget struct`
- `type PreviewSkip struct`
- `type PreviewResponse struct`

### `platform/modules/m01/dto/metric.go`

- `type MetricRequest struct`
- `method (MetricRequest) ToDomain() *domain.Metric`
- `type MetricResponse struct`
- `func FromMetric(item *domain.Metric) MetricResponse`

### `platform/modules/m01/dto/probe_module.go`

- `type ProbeModuleRequest struct`
- `type ProbeModuleResponse struct`
- `func FromProbeModule(item *domain.ProbeModule, referencedJobCount int64) ProbeModuleResponse`

### `platform/modules/m01/dto/rule.go`

- `type RuleRequest struct`
- `method (RuleRequest) ToDomain() *domain.Rule`
- `type RuleResponse struct`
- `func FromRule(rule *domain.Rule) RuleResponse`
- `type RuleValidateRequest struct`
- `type RulePromQL struct`
- `type RuleValidateResponse struct`

### `platform/modules/m01/dto/time.go`

- `func formatTime(t time.Time) string`

### `platform/modules/m01/handler/actor.go`

- `func requestContext(c *gin.Context) context.Context`

### `platform/modules/m01/handler/admin_gate_test.go`

- `func TestCollectionTemplateWritesRespectBuiltinGuard(t *testing.T)`
- `func TestMetricLibraryWritesRequireAdmin(t *testing.T)`
- `func TestMetricLibraryUserEntryValidation(t *testing.T)`

### `platform/modules/m01/handler/business_metric.go`

- `type BusinessMetricHandler struct`
- `func NewBusinessMetricHandler(svc *service.BusinessMetricService) *BusinessMetricHandler`
- `method (*BusinessMetricHandler) List(c *gin.Context)`
- `method (*BusinessMetricHandler) Create(c *gin.Context)`
- `method (*BusinessMetricHandler) Get(c *gin.Context)`
- `method (*BusinessMetricHandler) Update(c *gin.Context)`
- `method (*BusinessMetricHandler) Delete(c *gin.Context)`

### `platform/modules/m01/handler/candidate_query.go`

- `method (*JobHandler) QueryCandidates(c *gin.Context)`
- `method (*JobHandler) QueryCandidateIDs(c *gin.Context)`
- `method (*JobHandler) CandidateFilterSchema(c *gin.Context)`
- `func candidateQuery(c *gin.Context, req dto.CandidateQueryRequest, page, pageSize int) domain.CandidateQuery`
- `func candidateTenantScope(c *gin.Context) []string`

### `platform/modules/m01/handler/candidate_query_test.go`

- `func TestCandidateQueryWithComposableFilters(t *testing.T)`
- `func TestCandidateQueryRejectsInvalidFilters(t *testing.T)`

### `platform/modules/m01/handler/catalog_test.go`

- `func TestMetricLibraryCRUD(t *testing.T)`
- `func TestMetricLibraryListFilters(t *testing.T)`
- `func TestBusinessMetricLifecycle(t *testing.T)`
- `func TestProbeModulesReadOnly(t *testing.T)`

### `platform/modules/m01/handler/collection_template.go`

- `type CollectionTemplateHandler struct`
- `func NewCollectionTemplateHandler(svc *service.CollectionTemplateService, fields references.CustomFieldReader) *CollectionTe…`
- `method (*CollectionTemplateHandler) List(c *gin.Context)`
- `method (*CollectionTemplateHandler) Get(c *gin.Context)`
- `method (*CollectionTemplateHandler) Create(c *gin.Context)`
- `method (*CollectionTemplateHandler) Update(c *gin.Context)`
- `method (*CollectionTemplateHandler) Delete(c *gin.Context)`
- `method (*CollectionTemplateHandler) Impact(c *gin.Context)`
- `func formatTemplateTime(t time.Time) string`
- `method (*CollectionTemplateHandler) CandidateFields(c *gin.Context)`

### `platform/modules/m01/handler/errors.go`

- `func respondError(c *gin.Context, err error)`

### `platform/modules/m01/handler/exporter_template.go`

- `type ExporterTemplateHandler struct`
- `func NewExporterTemplateHandler(svc *service.ExporterTemplateService) *ExporterTemplateHandler`
- `method (*ExporterTemplateHandler) List(c *gin.Context)`
- `method (*ExporterTemplateHandler) Create(c *gin.Context)`
- `method (*ExporterTemplateHandler) Get(c *gin.Context)`
- `method (*ExporterTemplateHandler) Update(c *gin.Context)`
- `method (*ExporterTemplateHandler) Delete(c *gin.Context)`

### `platform/modules/m01/handler/job.go`

- `type JobHandler struct`
- `func NewJobHandler(svc *service.JobService) *JobHandler`
- `method (*JobHandler) List(c *gin.Context)`
- `method (*JobHandler) Create(c *gin.Context)`
- `method (*JobHandler) Get(c *gin.Context)`
- `method (*JobHandler) Update(c *gin.Context)`
- `method (*JobHandler) Delete(c *gin.Context)`
- `method (*JobHandler) Candidates(c *gin.Context)`
- `method (*JobHandler) Instances(c *gin.Context)`
- `method (*JobHandler) ConfirmInstallation(c *gin.Context)`
- `method (*JobHandler) DeleteInstallation(c *gin.Context)`
- `method (*JobHandler) Preview(c *gin.Context)`

### `platform/modules/m01/handler/job_group.go`

- `type JobGroupHandler struct`
- `func NewJobGroupHandler(svc *service.JobGroupService) *JobGroupHandler`
- `method (*JobGroupHandler) List(c *gin.Context)`
- `method (*JobGroupHandler) Create(c *gin.Context)`
- `method (*JobGroupHandler) Adopt(c *gin.Context)`
- `method (*JobGroupHandler) Get(c *gin.Context)`
- `method (*JobGroupHandler) Update(c *gin.Context)`
- `method (*JobGroupHandler) SetStatus(c *gin.Context)`
- `method (*JobGroupHandler) Delete(c *gin.Context)`
- `func jobGroupID(c *gin.Context) (string, bool)`
- `func jobGroupInput(req dto.JobGroupRequest, createdBy string) service.JobGroupInput`
- `func fromJobGroupView(view *service.JobGroupView) dto.JobGroupResponse`

### `platform/modules/m01/handler/job_group_test.go`

- `func TestJobGroupLifecycle(t *testing.T)`
- `func TestJobGroupSetEnabled(t *testing.T)`

### `platform/modules/m01/handler/job_test.go`

- `func TestJobCRUDCandidatesPreview(t *testing.T)`
- `func TestJobValidatesOfflineAndDomain(t *testing.T)`
- `func TestBlackboxJobDerivesTargetField(t *testing.T)`
- `func TestJobRejectsInvalidPayloads(t *testing.T)`
- `func TestJobListFilters(t *testing.T)`

### `platform/modules/m01/handler/json.go`

- `func bindJSON(c *gin.Context, out any) error`

### `platform/modules/m01/handler/metric.go`

- `type MetricHandler struct`
- `func NewMetricHandler(svc *service.MetricService) *MetricHandler`
- `method (*MetricHandler) List(c *gin.Context)`
- `method (*MetricHandler) Create(c *gin.Context)`
- `method (*MetricHandler) Get(c *gin.Context)`
- `method (*MetricHandler) Update(c *gin.Context)`
- `method (*MetricHandler) Delete(c *gin.Context)`

### `platform/modules/m01/handler/pagination.go`

- `func parsePagination(c *gin.Context) (int, int)`
- `func boolQuery(c *gin.Context, key string) *bool`

### `platform/modules/m01/handler/probe_module.go`

- `type ProbeModuleHandler struct`
- `func NewProbeModuleHandler(svc *service.ProbeModuleService) *ProbeModuleHandler`
- `method (*ProbeModuleHandler) List(c *gin.Context)`
- `method (*ProbeModuleHandler) Get(c *gin.Context)`

### `platform/modules/m01/handler/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, exporters *ExporterTemplateHandler, templates *CollectionTemplateHandler, job…`

### `platform/modules/m01/handler/routes_test.go`

- `func testAdmin() *models.User`
- `func testRegularUser() *models.User`
- `func newTestRouter(t *testing.T) (*gin.Engine, *gorm.DB)`
- `func seedHandlerTemplates(t *testing.T, gormDB *gorm.DB)`
- `func newTestRouterAs(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB)`
- `func doJSON(t *testing.T, router *gin.Engine, method, path, body string) (int, map[string]any)`
- `func TestExporterTemplateCRUDAndValidation(t *testing.T)`
- `func TestCollectionTemplateCRUDAndGuards(t *testing.T)`

### `platform/modules/m01/handler/rule.go`

- `type RuleHandler struct`
- `func NewRuleHandler(svc *service.RuleService) *RuleHandler`
- `method (*RuleHandler) List(c *gin.Context)`
- `method (*RuleHandler) Create(c *gin.Context)`
- `method (*RuleHandler) Get(c *gin.Context)`
- `method (*RuleHandler) Update(c *gin.Context)`
- `method (*RuleHandler) Delete(c *gin.Context)`
- `method (*RuleHandler) Validate(c *gin.Context)`

### `platform/modules/m01/handler/rule_test.go`

- `func ruleBody(content string, extra map[string]any) string`
- `func TestRuleCRUDAndValidate(t *testing.T)`
- `func TestRuleJobRefGateAndEscapeHatch(t *testing.T)`
- `func TestRuleRejectsInvalidContent(t *testing.T)`

### `platform/modules/m01/jobref/jobref.go`

- `type Severity = string`
- `type Issue struct`
- `type ruleEntry struct`
- `type ruleGroup struct`
- `type rulesFile struct`
- `func Validate(rulesContent string, jobNames []string) []Issue`
- `func validateRule(group string, rule ruleEntry, jobs map[string]struct{}) []Issue`
- `func jobExists(jobs map[string]struct{}, op, ref string) (hit bool, determinable bool)`

### `platform/modules/m01/jobref/jobref_test.go`

- `func TestValidateMatchesExistingJobs(t *testing.T)`
- `func TestValidateLiteralMissingIsWarning(t *testing.T)`
- `func TestValidateUpIsError(t *testing.T)`
- `func TestValidateRegexMissingIsErrorForUp(t *testing.T)`
- `func TestValidateRegexMatchesAnyJob(t *testing.T)`
- `func TestValidateInvalidYAMLReturnsNil(t *testing.T)`
- `func TestValidateNoJobMatcherSkips(t *testing.T)`
- `func TestValidateDedupesRepeatedMatcher(t *testing.T)`
- `func TestValidateInvalidRegexSkipped(t *testing.T)`

### `platform/modules/m01/module.go`

- `type Repositories struct`
- `type Options struct`
- `type Module struct`
- `func NewModule(db *gorm.DB, opts Options) (*Module, error)`
- `method (*Module) Name() string`
- `method (*Module) RegisterRoutes(platform *gin.RouterGroup) error`
- `method (*Module) Repositories() Repositories`
- `method (*Module) CollectionTemplateService() *service.CollectionTemplateService`
- `method (*Module) JobGroupService() *service.JobGroupService`
- `method (*Module) ReconcileNow(ctx context.Context) error`
- `method (*Module) LabelTemplateResolver() service.LabelTemplateResolver`
- `method (*Module) LabelTemplateUsageChecker() *references.LabelTemplateUsageChecker`
- `method (*Module) SyncResultSink() *references.SyncSink`
- `method (*Module) Bootstrap(ctx context.Context) error`
- `method (*Module) StartBackground(ctx context.Context)`

### `platform/modules/m01/module_test.go`

- `func TestNewModuleRequiresDatabase(t *testing.T)`
- `func TestModuleWiring(t *testing.T)`

### `platform/modules/m01/references/candidate_query_test.go`

- `func newCandidateDB(t *testing.T) *gorm.DB`
- `func TestQueryCandidatesMatchesCanonicalOSTypes(t *testing.T)`
- `func linuxSelector() domain.Selector`
- `func windowsSelector() domain.Selector`

### `platform/modules/m01/references/candidate_scope_test.go`

- `func newCapabilityDB(t *testing.T) *gorm.DB`
- `func hostSelector(field string, values ...string) domain.Selector`
- `func candidateIDs(t *testing.T, reader *references.GORMResourceReader, selector domain.Selector) []string`
- `func TestSameHostMatchesOSAndNPUSelectors(t *testing.T)`
- `func TestSelectorDrivesCandidatesWithoutRegistry(t *testing.T)`
- `func TestCustomFieldSelectorDrivesCandidates(t *testing.T)`
- `func TestUnknownSelectorFieldIsRejected(t *testing.T)`
- `func TestCategoryMismatchIsRejected(t *testing.T)`
- `func TestCategoryIsRequired(t *testing.T)`
- `func TestCountBySelectorTracksScope(t *testing.T)`

### `platform/modules/m01/references/domain.go`

- `type DomainReader interface`
- `type GORMDomainReader struct`
- `func NewDomainReader(db *gorm.DB) *GORMDomainReader`
- `method (*GORMDomainReader) Get(ctx context.Context, id string) (domain.DomainRef, bool, error)`
- `func parseTenantList(raw string) []string`

### `platform/modules/m01/references/field_dictionary.go`

- `type CustomField struct`
- `type CustomFieldReader interface`
- `type GORMCustomFieldReader struct`
- `func NewCustomFieldReader(db *gorm.DB) *GORMCustomFieldReader`
- `method (*GORMCustomFieldReader) ListCustomFields(ctx context.Context) ([]CustomField, error)`

### `platform/modules/m01/references/label_template.go`

- `type GORMLabelTemplateReader struct`
- `func NewLabelTemplateReader(db *gorm.DB) *GORMLabelTemplateReader`
- `method (*GORMLabelTemplateReader) Resolve(ctx context.Context, id string) (domain.LabelTemplateRef, bool, error)`
- `type LabelTemplateUsageChecker struct`
- `func NewLabelTemplateUsageChecker(db *gorm.DB) *LabelTemplateUsageChecker`
- `method (*LabelTemplateUsageChecker) CountReferences(ctx context.Context, templateID string) (int64, error)`

### `platform/modules/m01/references/label_template_test.go`

- `func openReferencesDB(t *testing.T) *gorm.DB`
- `func TestLabelTemplateReader(t *testing.T)`
- `func TestLabelTemplateUsageChecker(t *testing.T)`

### `platform/modules/m01/references/resource.go`

- `type ResourceReader interface`
- `type GORMResourceReader struct`
- `func NewResourceReader(db *gorm.DB) *GORMResourceReader`
- `type resourceRow struct`
- `func formatResourceTime(t *time.Time) string`
- `method (resourceRow) toDomain() domain.ResourceRef`
- `func ValidateCandidateFilter(filter domain.CandidateFilter) error`
- `method (*GORMResourceReader) ListCandidates(ctx context.Context, query domain.CandidateQuery) ([]domain.ResourceRef, int64, er…`
- `method (*GORMResourceReader) QueryCandidates(ctx context.Context, query domain.CandidateQuery) (domain.CandidatePage, error)`
- `method (*GORMResourceReader) GetMany(ctx context.Context, resourceIDs []string) (map[string]domain.ResourceRef, error)`
- `method (*GORMResourceReader) resolveSelector(ctx context.Context, query domain.CandidateQuery) (domain.ResourceCategory, domai…`
- `method (*GORMResourceReader) customFields(ctx context.Context, category domain.ResourceCategory) (map[string]struct{}, error)`
- `method (*GORMResourceReader) selectorPredicate(ctx context.Context, filters []domain.ScopeFilter, logic domain.RuleLogic) (str…`
- `func scopeFilterClause(filter domain.ScopeFilter) (string, []any, error)`
- `func customFieldClause(filter domain.ScopeFilter) (string, []any, error)`
- `func containsAnyClause(column string, keywords []string) (string, []any, error)`
- `method (*GORMResourceReader) ValidateSelector(ctx context.Context, category domain.ResourceCategory, selector domain.Selector)…`
- `method (*GORMResourceReader) CountBySelector(ctx context.Context, category domain.ResourceCategory, selector domain.Selector) …`
- `func likeKeywordPattern(keyword string) string`
- `func normalizePage(page, pageSize int) (int, int)`

### `platform/modules/m01/references/sync_sink.go`

- `type SyncSink struct`
- `func NewSyncSink(db *gorm.DB) *SyncSink`
- `method (*SyncSink) RecordDomainSync(ctx context.Context, domainID, version string, generatedAt time.Time, outcomes map[string]…`
- `method (*SyncSink) RecordRuleSync(ctx context.Context, version string, generatedAt time.Time, outcomes map[string]string) error`
- `method (*SyncSink) updatedAfter(rowTime, generatedAt time.Time) bool`
- `func statusFor(errMsg string) string`
- `type syncJobRecord struct`
- `method (syncJobRecord) TableName() string`
- `type syncRuleRecord struct`
- `method (syncRuleRecord) TableName() string`

### `platform/modules/m01/references/sync_sink_test.go`

- `func TestSyncSinkRecordsDomainOutcomes(t *testing.T)`
- `func TestSyncSinkRecordsRuleOutcomes(t *testing.T)`
- `type syncCountingLogger struct`
- `method (*syncCountingLogger) LogMode(logger.LogLevel) logger.Interface`
- `method (*syncCountingLogger) Info(context.Context, string, ...any)`
- `method (*syncCountingLogger) Warn(context.Context, string, ...any)`
- `method (*syncCountingLogger) Error(context.Context, string, ...any)`
- `method (*syncCountingLogger) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error)`
- `method (*syncCountingLogger) updateCount() int`
- `func TestSyncSinkBatchesUpdatesPerMessage(t *testing.T)`
- `func TestUpdatedAfterComparesUTC(t *testing.T)`

### `platform/modules/m01/repository/business_metric.go`

- `type BusinessMetricFilter struct`
- `type BusinessMetricRepository interface`
- `type GORMBusinessMetricRepository struct`
- `func NewBusinessMetricRepository(db *gorm.DB) *GORMBusinessMetricRepository`
- `method (*GORMBusinessMetricRepository) Create(ctx context.Context, metric *domain.BusinessMetric) error`
- `method (*GORMBusinessMetricRepository) Get(ctx context.Context, id string) (*domain.BusinessMetric, error)`
- `method (*GORMBusinessMetricRepository) GetByName(ctx context.Context, name string) (*domain.BusinessMetric, bool, error)`
- `method (*GORMBusinessMetricRepository) List(ctx context.Context, filter BusinessMetricFilter) ([]*domain.BusinessMetric, int64…`
- `method (*GORMBusinessMetricRepository) Update(ctx context.Context, metric *domain.BusinessMetric) error`
- `method (*GORMBusinessMetricRepository) SoftDelete(ctx context.Context, id string) error`

### `platform/modules/m01/repository/collection_template.go`

- `type collectionTemplateRecord struct`
- `method (collectionTemplateRecord) TableName() string`
- `method (collectionTemplateRecord) toDomain() *domain.CollectionTemplate`
- `func collectionTemplateFromDomain(t *domain.CollectionTemplate) collectionTemplateRecord`
- `type TemplateFilter struct`
- `type TemplateReferenceCounts struct`
- `method (TemplateReferenceCounts) Total() int64`
- `type CollectionTemplateRepository interface`
- `type GORMCollectionTemplateRepository struct`
- `func NewCollectionTemplateRepository(db *gorm.DB) *GORMCollectionTemplateRepository`
- `method (*GORMCollectionTemplateRepository) Create(ctx context.Context, template *domain.CollectionTemplate) error`
- `method (*GORMCollectionTemplateRepository) Get(ctx context.Context, code string) (*domain.CollectionTemplate, error)`
- `method (*GORMCollectionTemplateRepository) Find(ctx context.Context, code string) (*domain.CollectionTemplate, bool, error)`
- `method (*GORMCollectionTemplateRepository) List(ctx context.Context, filter TemplateFilter) ([]*domain.CollectionTemplate, int…`
- `method (*GORMCollectionTemplateRepository) Update(ctx context.Context, template *domain.CollectionTemplate) error`
- `method (*GORMCollectionTemplateRepository) SoftDelete(ctx context.Context, code string) error`
- `method (*GORMCollectionTemplateRepository) CountReferences(ctx context.Context, code string) (TemplateReferenceCounts, error)`
- `method (*GORMCollectionTemplateRepository) anchoredMetrics(q *gorm.DB, code string) *gorm.DB`
- `method (*GORMCollectionTemplateRepository) CountByExporterTemplate(ctx context.Context, exporterID string) (int64, error)`
- `method (*GORMCollectionTemplateRepository) CountByLabelTemplate(ctx context.Context, labelTemplateID string) (int64, error)`

### `platform/modules/m01/repository/errors.go`

- `func mapWriteError(err error, entity, field, value string) error`
- `func isNotFound(err error) bool`
- `func notFound(entity, id string) error`
- `func nilIfEmpty(value string) *string`
- `func derefString(value *string) string`

### `platform/modules/m01/repository/exporter_template.go`

- `type ExporterTemplateFilter struct`
- `type ExporterTemplateRepository interface`
- `type GORMExporterTemplateRepository struct`
- `func NewExporterTemplateRepository(db *gorm.DB) *GORMExporterTemplateRepository`
- `method (*GORMExporterTemplateRepository) Create(ctx context.Context, template *domain.ExporterTemplate) error`
- `method (*GORMExporterTemplateRepository) Get(ctx context.Context, id string) (*domain.ExporterTemplate, error)`
- `method (*GORMExporterTemplateRepository) GetByName(ctx context.Context, name string) (*domain.ExporterTemplate, error)`
- `method (*GORMExporterTemplateRepository) List(ctx context.Context, filter ExporterTemplateFilter) ([]*domain.ExporterTemplate,…`
- `method (*GORMExporterTemplateRepository) Update(ctx context.Context, template *domain.ExporterTemplate) error`
- `method (*GORMExporterTemplateRepository) SoftDelete(ctx context.Context, id string) error`

### `platform/modules/m01/repository/installation.go`

- `type InstallationRepository interface`
- `type GORMInstallationRepository struct`
- `func NewInstallationRepository(db *gorm.DB) *GORMInstallationRepository`
- `method (*GORMInstallationRepository) Upsert(ctx context.Context, installation *domain.Installation) error`
- `method (*GORMInstallationRepository) Get(ctx context.Context, resourceID, jobID string) (*domain.Installation, error)`
- `method (*GORMInstallationRepository) ListByJob(ctx context.Context, jobID string) ([]*domain.Installation, error)`
- `method (*GORMInstallationRepository) Delete(ctx context.Context, resourceID, jobID string) error`
- `method (*GORMInstallationRepository) find(ctx context.Context, resourceID, jobID string) (installationRecord, bool, error)`

### `platform/modules/m01/repository/job.go`

- `type JobFilter struct`
- `type JobRepository interface`
- `type GORMJobRepository struct`
- `func NewJobRepository(db *gorm.DB) *GORMJobRepository`
- `method (*GORMJobRepository) Create(ctx context.Context, job *domain.Job) error`
- `method (*GORMJobRepository) Get(ctx context.Context, id string) (*domain.Job, error)`
- `method (*GORMJobRepository) List(ctx context.Context, filter JobFilter) ([]*domain.Job, int64, error)`
- `method (*GORMJobRepository) Update(ctx context.Context, job *domain.Job) error`
- `method (*GORMJobRepository) SoftDelete(ctx context.Context, id string) error`
- `method (*GORMJobRepository) CountByLabelTemplate(ctx context.Context, labelTemplateID string) (int64, error)`
- `method (*GORMJobRepository) CountByNetworkDomain(ctx context.Context, domainID string) (int64, error)`
- `method (*GORMJobRepository) ListAll(ctx context.Context) ([]*domain.Job, error)`
- `method (*GORMJobRepository) ListActiveNames(ctx context.Context) ([]string, error)`
- `method (*GORMJobRepository) CountByProbeModule(ctx context.Context, name string) (int64, error)`

### `platform/modules/m01/repository/job_group.go`

- `type JobGroupFilter struct`
- `type JobGroupRepository interface`
- `type GORMJobGroupRepository struct`
- `func NewJobGroupRepository(db *gorm.DB) *GORMJobGroupRepository`
- `method (*GORMJobGroupRepository) Create(ctx context.Context, group *domain.JobGroup) error`
- `method (*GORMJobGroupRepository) Get(ctx context.Context, id string) (*domain.JobGroup, error)`
- `method (*GORMJobGroupRepository) List(ctx context.Context, filter JobGroupFilter) ([]*domain.JobGroup, int64, error)`
- `method (*GORMJobGroupRepository) Update(ctx context.Context, group *domain.JobGroup) error`
- `method (*GORMJobGroupRepository) SoftDelete(ctx context.Context, id string) error`
- `method (*GORMJobGroupRepository) CountByName(ctx context.Context, name string) (int64, error)`
- `type jobGroupRecord struct`
- `method (jobGroupRecord) TableName() string`
- `method (jobGroupRecord) toDomain() *domain.JobGroup`
- `func jobGroupFromDomain(g *domain.JobGroup) jobGroupRecord`
- `type GroupPlan struct`
- `method (*GORMJobGroupRepository) Apply(ctx context.Context, plan GroupPlan) error`
- `method (*GORMJobGroupRepository) ListJobsByGroup(ctx context.Context, groupID string) ([]*domain.Job, error)`
- `method (*GORMJobGroupRepository) ListJobsByGroups(ctx context.Context, groupIDs []string) (map[string][]*domain.Job, error)`

### `platform/modules/m01/repository/metric.go`

- `type MetricFilter struct`
- `type MetricRepository interface`
- `type GORMMetricRepository struct`
- `func NewMetricRepository(db *gorm.DB) *GORMMetricRepository`
- `method (*GORMMetricRepository) Create(ctx context.Context, metric *domain.Metric) error`
- `method (*GORMMetricRepository) Get(ctx context.Context, id string) (*domain.Metric, error)`
- `method (*GORMMetricRepository) GetBuiltinByName(ctx context.Context, name string) (*domain.Metric, bool, error)`
- `method (*GORMMetricRepository) List(ctx context.Context, filter MetricFilter) ([]*domain.Metric, int64, error)`
- `method (*GORMMetricRepository) whereTemplateIn(q *gorm.DB, monitorTypes []string) *gorm.DB`
- `method (*GORMMetricRepository) whereCategoryIn(q *gorm.DB, category string) *gorm.DB`
- `method (*GORMMetricRepository) HasAnchorConflict(ctx context.Context, metricName string, monitorTypes []string, excludeID stri…`
- `method (*GORMMetricRepository) Update(ctx context.Context, metric *domain.Metric) error`
- `method (*GORMMetricRepository) SoftDelete(ctx context.Context, id string) error`

### `platform/modules/m01/repository/models.go`

- `type exporterTemplateRecord struct`
- `method (exporterTemplateRecord) TableName() string`
- `method (exporterTemplateRecord) toDomain() *domain.ExporterTemplate`
- `func exporterTemplateFromDomain(e *domain.ExporterTemplate) exporterTemplateRecord`
- `type jobRecord struct`
- `method (jobRecord) TableName() string`
- `method (jobRecord) toDomain() *domain.Job`
- `func jobFromDomain(j *domain.Job) jobRecord`
- `type ruleRecord struct`
- `method (ruleRecord) TableName() string`
- `method (ruleRecord) toDomain() *domain.Rule`
- `func ruleFromDomain(r *domain.Rule) ruleRecord`
- `type metricRecord struct`
- `method (metricRecord) TableName() string`
- `method (metricRecord) toDomain() *domain.Metric`
- `func metricFromDomain(m *domain.Metric) metricRecord`
- `type businessMetricRecord struct`
- `method (businessMetricRecord) TableName() string`
- `method (businessMetricRecord) toDomain() *domain.BusinessMetric`
- `func businessMetricFromDomain(m *domain.BusinessMetric) businessMetricRecord`
- `type installationRecord struct`
- `method (installationRecord) TableName() string`
- `method (installationRecord) toDomain() *domain.Installation`
- `func installationFromDomain(i *domain.Installation) installationRecord`
- `type probeModuleRecord struct`
- `method (probeModuleRecord) TableName() string`
- `method (probeModuleRecord) toDomain() *domain.ProbeModule`
- `func probeModuleFromDomain(m *domain.ProbeModule) probeModuleRecord`
- `func nonNilStrings(in []string) []string`
- `func nonNilOverrides(in []domain.MappingOverride) []domain.MappingOverride`
- `func nonNilAnchors(in []domain.MetricAnchor) []domain.MetricAnchor`
- `func nonNilMap(in map[string]string) map[string]string`
- `func nonNilSelector(selector domain.Selector) domain.Selector`

### `platform/modules/m01/repository/probe_module.go`

- `type ProbeModuleFilter struct`
- `type ProbeModuleRepository interface`
- `type GORMProbeModuleRepository struct`
- `func NewProbeModuleRepository(db *gorm.DB) *GORMProbeModuleRepository`
- `method (*GORMProbeModuleRepository) Create(ctx context.Context, module *domain.ProbeModule) error`
- `method (*GORMProbeModuleRepository) Get(ctx context.Context, id string) (*domain.ProbeModule, error)`
- `method (*GORMProbeModuleRepository) GetByName(ctx context.Context, name string) (*domain.ProbeModule, error)`
- `method (*GORMProbeModuleRepository) List(ctx context.Context, filter ProbeModuleFilter) ([]*domain.ProbeModule, int64, error)`
- `method (*GORMProbeModuleRepository) Update(ctx context.Context, module *domain.ProbeModule) error`
- `method (*GORMProbeModuleRepository) SoftDelete(ctx context.Context, id string) error`

### `platform/modules/m01/repository/query.go`

- `func normalizePage(page, pageSize int) (int, int)`
- `func paginate(q *gorm.DB, page, pageSize int) *gorm.DB`
- `func keywordFilter(q *gorm.DB, column, keyword string) *gorm.DB`

### `platform/modules/m01/repository/repository_test.go`

- `func assertNotFound(t *testing.T, err error)`
- `func openTestDB(t *testing.T) *gorm.DB`
- `func newExporter(name string) *domain.ExporterTemplate`
- `func newJob(name string) *domain.Job`
- `func TestExporterTemplateRepository(t *testing.T)`
- `func newCollectionTemplate(code, exporterID string) *domain.CollectionTemplate`
- `func TestCollectionTemplateRepository(t *testing.T)`
- `func TestJobRepository(t *testing.T)`
- `func TestRuleRepository(t *testing.T)`
- `func TestMetricRepository(t *testing.T)`
- `func TestMetricRepositoryTemplateAnchorFilters(t *testing.T)`
- `func TestMetricRepositoryAnchorConflict(t *testing.T)`
- `func TestBusinessMetricRepository(t *testing.T)`
- `func TestInstallationRepository(t *testing.T)`
- `func TestProbeModuleRepository(t *testing.T)`
- `func TestJobNameUniquePerDomain(t *testing.T)`
- `func TestJobGroupIDRoundTrip(t *testing.T)`
- `func TestJobGroupRepository(t *testing.T)`

### `platform/modules/m01/repository/rule.go`

- `type RuleFilter struct`
- `type RuleRepository interface`
- `type GORMRuleRepository struct`
- `func NewRuleRepository(db *gorm.DB) *GORMRuleRepository`
- `method (*GORMRuleRepository) Create(ctx context.Context, rule *domain.Rule) error`
- `method (*GORMRuleRepository) Get(ctx context.Context, id string) (*domain.Rule, error)`
- `method (*GORMRuleRepository) List(ctx context.Context, filter RuleFilter) ([]*domain.Rule, int64, error)`
- `method (*GORMRuleRepository) Update(ctx context.Context, rule *domain.Rule) error`
- `method (*GORMRuleRepository) SoftDelete(ctx context.Context, id string) error`
- `method (*GORMRuleRepository) ListEnabledReady(ctx context.Context) ([]*domain.Rule, error)`

### `platform/modules/m01/seed/seed.go`

- `type templateSeed struct`
- `func DefaultTemplates() []templateSeed`
- `func Run(db *gorm.DB) error`
- `func seedCollectionTemplates(ctx context.Context, exporters *repository.GORMExporterTemplateRepository, templates *repositor…`
- `func seedExporters(ctx context.Context, repo *repository.GORMExporterTemplateRepository) error`
- `func seedMetrics(ctx context.Context, repo *repository.GORMMetricRepository) error`
- `func seedProbeModules(ctx context.Context, repo *repository.GORMProbeModuleRepository) error`
- `func isNotFound(err error) bool`

### `platform/modules/m01/seed/seed_test.go`

- `func openSeedDB(t *testing.T) *gorm.DB`
- `func countRows(t *testing.T, db *gorm.DB, table string) int64`
- `func TestRunSeedsBuiltinsIdempotently(t *testing.T)`
- `func TestRunRejectsNilDB(t *testing.T)`
- `func TestRunDoesNotClobberUserEditedTemplate(t *testing.T)`
- `func TestDefaultTemplatesBindExporterNames(t *testing.T)`

### `platform/modules/m01/service/actor.go`

- `type Actor struct`
- `type actorContextKey struct`
- `func WithActor(ctx context.Context, actor Actor) context.Context`
- `func ActorFrom(ctx context.Context) (Actor, bool)`

### `platform/modules/m01/service/business_metric.go`

- `type BusinessMetricService struct`
- `func NewBusinessMetricService(repo repository.BusinessMetricRepository) *BusinessMetricService`
- `method (*BusinessMetricService) List(ctx context.Context, filter repository.BusinessMetricFilter) ([]*domain.BusinessMetric, i…`
- `method (*BusinessMetricService) Get(ctx context.Context, id string) (*domain.BusinessMetric, error)`
- `method (*BusinessMetricService) Create(ctx context.Context, metric *domain.BusinessMetric) (*domain.BusinessMetric, error)`
- `method (*BusinessMetricService) Update(ctx context.Context, id string, input *domain.BusinessMetric) (*domain.BusinessMetric, …`
- `method (*BusinessMetricService) Delete(ctx context.Context, id string) error`
- `func normalizeBusinessMetric(metric *domain.BusinessMetric)`
- `func validateBusinessMetric(metric *domain.BusinessMetric) error`
- `func validateBusinessStatus(from, to domain.BusinessMetricStatus) error`

### `platform/modules/m01/service/collection_template.go`

- `type CollectionTemplateView struct`
- `type CollectionTemplateService struct`
- `func NewCollectionTemplateService( repo repository.CollectionTemplateRepository, exporters repository.ExporterTemplateReposi…`
- `method (*CollectionTemplateService) List(ctx context.Context, filter repository.TemplateFilter) ([]CollectionTemplateView, int…`
- `method (*CollectionTemplateService) Get(ctx context.Context, code string) (*CollectionTemplateView, error)`
- `method (*CollectionTemplateService) Catalog(ctx context.Context, code string) (*domain.CollectionTemplate, *domain.ExporterTem…`
- `method (*CollectionTemplateService) Create(ctx context.Context, template *domain.CollectionTemplate) (*CollectionTemplateView,…`
- `method (*CollectionTemplateService) Update(ctx context.Context, code string, template *domain.CollectionTemplate) (*Collection…`
- `method (*CollectionTemplateService) Delete(ctx context.Context, code string) error`
- `method (*CollectionTemplateService) Impact(ctx context.Context, code string) (repository.TemplateReferenceCounts, domain.Colle…`
- `method (*CollectionTemplateService) EnsureBuiltins(ctx context.Context) error`
- `method (*CollectionTemplateService) view(ctx context.Context, template *domain.CollectionTemplate) (*CollectionTemplateView, e…`
- `method (*CollectionTemplateService) validate(ctx context.Context, template *domain.CollectionTemplate) error`
- `method (*CollectionTemplateService) exporterName(ctx context.Context, id string) (string, error)`
- `method (*CollectionTemplateService) labelName(ctx context.Context, id string) (string, error)`
- `func requireAdminForBuiltin(ctx context.Context, builtin bool) error`

### `platform/modules/m01/service/collection_template_test.go`

- `func newUserTemplate(code, exporterID string) *domain.CollectionTemplate`
- `func TestCreateCollectionTemplateIsImmediatelyUsable(t *testing.T)`
- `func TestCreateCollectionTemplateValidation(t *testing.T)`
- `func TestUpdateCollectionTemplate(t *testing.T)`
- `func TestBuiltinCollectionTemplateWritesRequirePlatformAdmin(t *testing.T)`
- `func TestDeleteCollectionTemplateGuards(t *testing.T)`
- `func TestEnsureBuiltinsIsCreateOnly(t *testing.T)`
- `func TestCatalogRejectsUnboundTemplate(t *testing.T)`

### `platform/modules/m01/service/exporter_template.go`

- `type ExporterTemplateService struct`
- `func NewExporterTemplateService(repo repository.ExporterTemplateRepository, templates repository.CollectionTemplateRepositor…`
- `method (*ExporterTemplateService) List(ctx context.Context, filter repository.ExporterTemplateFilter) ([]*domain.ExporterTempl…`
- `method (*ExporterTemplateService) Get(ctx context.Context, id string) (*domain.ExporterTemplate, error)`
- `method (*ExporterTemplateService) Create(ctx context.Context, input *domain.ExporterTemplate) (*domain.ExporterTemplate, error)`
- `method (*ExporterTemplateService) Update(ctx context.Context, id string, input *domain.ExporterTemplate) (*domain.ExporterTemp…`
- `method (*ExporterTemplateService) Delete(ctx context.Context, id string) error`
- `func normalizeExporter(template *domain.ExporterTemplate)`
- `func validateExporter(template *domain.ExporterTemplate) error`
- `func validateOptionalURL(field, raw string) error`

### `platform/modules/m01/service/job.go`

- `type ResourceReader interface`
- `type DomainReader interface`
- `type JobView struct`
- `type CandidateView struct`
- `type JobInstanceView struct`
- `type PreviewTarget struct`
- `type PreviewSkip struct`
- `type JobService struct`
- `type SelectorValidator interface`
- `method (*JobService) SetSelectorValidator(validator SelectorValidator)`
- `func NewJobService( jobs repository.JobRepository, exporters repository.ExporterTemplateRepository, templates *CollectionTem…`
- `method (*JobService) SetJobGroupResolver(groups repository.JobGroupRepository)`
- `method (*JobService) List(ctx context.Context, filter repository.JobFilter) ([]JobView, int64, error)`
- `method (*JobService) Get(ctx context.Context, id string) (*JobView, error)`
- `method (*JobService) Create(ctx context.Context, input *domain.Job, enabled *bool) (*JobView, error)`
- `method (*JobService) Update(ctx context.Context, id string, input *domain.Job, enabled *bool, syncMappingDefaults bool) (*JobV…`
- `method (*JobService) Delete(ctx context.Context, id string) error`
- `type CandidateFilterField struct`
- `type CandidateFilterOption struct`
- `func CandidateFilterSchema() []CandidateFilterField`
- `type CandidateQueryResult struct`
- `method (*JobService) QueryCandidates(ctx context.Context, query domain.CandidateQuery) (CandidateQueryResult, error)`
- `func normalizeCandidateFilters(query *domain.CandidateQuery) error`
- `func validateCandidateFilterValues(filter domain.CandidateFilter) error`
- `func intersectStrings(left, right []string) []string`
- `method (*JobService) ListCandidates(ctx context.Context, query domain.CandidateQuery) ([]CandidateView, int64, error)`
- `method (*JobService) ListInstances(ctx context.Context, jobID string) ([]JobInstanceView, error)`
- `method (*JobService) ConfirmInstallation(ctx context.Context, jobID, resourceID string, actualPort int, confirmedBy, notes str…`
- `method (*JobService) DeleteInstallation(ctx context.Context, jobID, resourceID string) error`
- `method (*JobService) Preview(ctx context.Context, jobID string) (string, []PreviewTarget, []PreviewSkip, error)`
- `method (*JobService) prepare(ctx context.Context, job *domain.Job, existing *domain.Job) error`
- `func normalizeJob(job *domain.Job)`
- `method (*JobService) resolveCatalog(ctx context.Context, job *domain.Job) (*domain.CollectionTemplate, *domain.ExporterTemplat…`
- `method (*JobService) requireDomain(ctx context.Context, domainID string) (domain.DomainRef, error)`
- `method (*JobService) validateLabelTemplate(ctx context.Context, job *domain.Job) error`
- `method (*JobService) validateInstances(ctx context.Context, job *domain.Job, existing *domain.Job) error`
- `method (*JobService) applyCredentials(job *domain.Job, existing *domain.Job) error`
- `method (*JobService) catalogForCandidate(ctx context.Context, templateCode string) (*domain.CollectionTemplate, *domain.Export…`
- `method (*JobService) catalogForJob(ctx context.Context, job *domain.Job) (*domain.CollectionTemplate, *domain.ExporterTemplate…`
- `method (*JobService) view(ctx context.Context, job *domain.Job) (*JobView, error)`
- `func targetAddressForJob(ref domain.ResourceRef, job *domain.Job, template *domain.CollectionTemplate, exporter *domain.Expo…`
- `func targetAddress(ref domain.ResourceRef, template *domain.CollectionTemplate, exporter *domain.ExporterTemplate) string`
- `func applyMappingDefaults(input, existing *domain.Job)`
- `func sealCredential(raw string) string`
- `func uniqueStrings(values []string) []string`
- `func contains(values []string, target string) bool`
- `func enforceGroupChildEditScope(input, existing *domain.Job) error`

### `platform/modules/m01/service/job_group.go`

- `type JobGroupSyncSummary struct`
- `type JobGroupChildView struct`
- `type JobGroupView struct`
- `type JobGroupInput struct`
- `type JobGroupService struct`
- `func NewJobGroupService( groups repository.JobGroupRepository, jobs *JobService, resources ResourceReader, domains DomainRea…`
- `method (*JobGroupService) Create(ctx context.Context, input JobGroupInput) (*JobGroupView, error)`
- `method (*JobGroupService) Update(ctx context.Context, id string, input JobGroupInput) (*JobGroupView, error)`
- `method (*JobGroupService) SetEnabled(ctx context.Context, id string, enabled bool) (*JobGroupView, error)`
- `method (*JobGroupService) Delete(ctx context.Context, id string) error`
- `method (*JobGroupService) List(ctx context.Context, filter repository.JobGroupFilter) ([]*JobGroupView, int64, error)`
- `method (*JobGroupService) Get(ctx context.Context, id string) (*JobGroupView, error)`
- `method (*JobGroupService) buildPlan( ctx context.Context, existing *domain.JobGroup, existingChildren []*domain.Job, input Job…`
- `method (*JobGroupService) view(ctx context.Context, group *domain.JobGroup) (*JobGroupView, error)`
- `func DeriveGroupSyncSummary(group *domain.JobGroup, children []*domain.Job) JobGroupSyncSummary`
- `method (*JobGroupService) Adopt(ctx context.Context, jobID string, input JobGroupInput) (*JobGroupView, error)`

### `platform/modules/m01/service/job_group_test.go`

- `type groupResourceReader struct`
- `method (groupResourceReader) ListCandidates(context.Context, domain.CandidateQuery) ([]domain.ResourceRef, int64, error)`
- `method (groupResourceReader) QueryCandidates(_ context.Context, _ domain.CandidateQuery) (domain.CandidatePage, error)`
- `method (groupResourceReader) GetMany(_ context.Context, ids []string) (map[string]domain.ResourceRef, error)`
- `type groupDomainReader struct`
- `method (groupDomainReader) Get(_ context.Context, id string) (domain.DomainRef, bool, error)`
- `func eligibleDomain(id, name string) domain.DomainRef`
- `func hostRef(id, domainID string) domain.ResourceRef`
- `func newGroupTestStack(t *testing.T) (*gorm.DB, *JobGroupService, *JobService)`
- `func hostGroupInput(ids ...string) JobGroupInput`
- `func TestCreateJobGroupFansOutOneChildPerDomain(t *testing.T)`
- `func TestUpdateJobGroupReconcilesChildren(t *testing.T)`
- `func TestDeleteJobGroupCascadesToChildren(t *testing.T)`
- `func TestCreateJobGroupDisabledDisablesChildren(t *testing.T)`
- `func TestDeriveGroupSyncSummary(t *testing.T)`
- `func TestGroupChildJobRestrictedEdit(t *testing.T)`

### `platform/modules/m01/service/job_scope_test.go`

- `func TestJobTenantScopeEnforced(t *testing.T)`

### `platform/modules/m01/service/metric.go`

- `type MetricService struct`
- `func NewMetricService(repo repository.MetricRepository) *MetricService`
- `method (*MetricService) List(ctx context.Context, filter repository.MetricFilter) ([]*domain.Metric, int64, error)`
- `method (*MetricService) Get(ctx context.Context, id string) (*domain.Metric, error)`
- `method (*MetricService) Create(ctx context.Context, metric *domain.Metric) (*domain.Metric, error)`
- `method (*MetricService) Update(ctx context.Context, id string, input *domain.Metric) (*domain.Metric, error)`
- `method (*MetricService) Delete(ctx context.Context, id string) error`
- `method (*MetricService) ensureNoAnchorConflict(ctx context.Context, metric *domain.Metric, excludeID string) error`
- `func normalizeMetric(metric *domain.Metric)`
- `func normalizeMetricLabels(labels []string) []string`
- `func normalizeMetricAnchors(anchors []domain.MetricAnchor) []domain.MetricAnchor`
- `func validateMetric(metric *domain.Metric) error`

### `platform/modules/m01/service/ports.go`

- `type LabelTemplateResolver interface`
- `type NoopLabelTemplateResolver struct`
- `method (NoopLabelTemplateResolver) Resolve(_ context.Context, id string) (domain.LabelTemplateRef, bool, error)`

### `platform/modules/m01/service/probe_module.go`

- `type ProbeModuleService struct`
- `func NewProbeModuleService(repo repository.ProbeModuleRepository, jobs repository.JobRepository) *ProbeModuleService`
- `method (*ProbeModuleService) List(ctx context.Context, filter repository.ProbeModuleFilter) ([]*domain.ProbeModule, int64, err…`
- `method (*ProbeModuleService) Get(ctx context.Context, id string) (*domain.ProbeModule, error)`
- `method (*ProbeModuleService) ReferenceCount(ctx context.Context, name string) (int64, error)`

### `platform/modules/m01/service/promtool.go`

- `type PromQLChecker interface`
- `type PromtoolChecker struct`
- `func NewPromtoolChecker() *PromtoolChecker`
- `method (*PromtoolChecker) Check(ctx context.Context, ruleContent string) (string, string)`

### `platform/modules/m01/service/reconcile.go`

- `type ReconcileService struct`
- `func NewReconcileService(jobs repository.JobRepository, resources ResourceReader, domains DomainReader, interval time.Durati…`
- `method (*ReconcileService) Run(ctx context.Context)`
- `method (*ReconcileService) ReconcileOnce(ctx context.Context) (int, error)`
- `method (*ReconcileService) reconcileAndLog(ctx context.Context)`

### `platform/modules/m01/service/reconcile_test.go`

- `func TestReconcileReclaimsMissingInstances(t *testing.T)`
- `func TestReconcileDisablesGroupChildrenWhenDomainUnavailable(t *testing.T)`

### `platform/modules/m01/service/rule.go`

- `type RuleValidation struct`
- `type RuleService struct`
- `func NewRuleService( rules repository.RuleRepository, jobs repository.JobRepository, exporters repository.ExporterTemplateRe…`
- `method (*RuleService) List(ctx context.Context, filter repository.RuleFilter) ([]*domain.Rule, int64, error)`
- `method (*RuleService) Get(ctx context.Context, id string) (*domain.Rule, error)`
- `method (*RuleService) Create(ctx context.Context, input *domain.Rule, ack bool, ackReason string) (*domain.Rule, error)`
- `method (*RuleService) Update(ctx context.Context, id string, input *domain.Rule, ack bool, ackReason string) (*domain.Rule, er…`
- `method (*RuleService) Delete(ctx context.Context, id string) error`
- `method (*RuleService) Validate(ctx context.Context, id, content string) (*RuleValidation, error)`
- `method (*RuleService) prepare(ctx context.Context, rule *domain.Rule, existing *domain.Rule, ack bool) error`
- `method (*RuleService) evaluate(ctx context.Context, content, excludeID string) (*RuleValidation, error)`
- `func normalizeRule(rule *domain.Rule)`

### `platform/modules/m01/service/service_test.go`

- `func TestNormalizeExporterDefaults(t *testing.T)`
- `func TestValidateExporter(t *testing.T)`
- `func TestNoopLabelTemplateResolver(t *testing.T)`
- `func newServiceDB(t *testing.T, _ string) *gorm.DB`
- `func seedNodeTemplate(t *testing.T, gormDB *gorm.DB) (*domain.ExporterTemplate, *domain.CollectionTemplate)`
- `func newTemplateService(gormDB *gorm.DB) *CollectionTemplateService`

### `platform/modules/m05/domain/health.go`

- `type UpHealthIndex struct`
- `func NewUpHealthIndex(isOne, isZero map[string]bool) *UpHealthIndex`
- `type UpHealthQuerier interface`
- `type HealthCounts struct`
- `func ClassifyUpHealth(dispatched []string, idx *UpHealthIndex) *HealthCounts`

### `platform/modules/m05/domain/health_test.go`

- `func TestClassifyUpHealth(t *testing.T)`

### `platform/modules/m05/domain/panel.go`

- `type Panel struct`
- `type CreatePanelInput struct`
- `type UpdatePanelInput struct`

### `platform/modules/m05/dto/summary.go`

- `type Summary struct`
- `type CategorySummary struct`
- `type SubtypeSummary struct`
- `type AppSummary struct`
- `type PlatformAppSummary struct`
- `type PlatformAppCell struct`
- `type CloudSummary struct`
- `type ProbeTargetItem struct`
- `type CollectionHealth struct`

### `platform/modules/m05/handler/panel_handler.go`

- `type PanelHandler struct`
- `func NewPanelHandler(svc *service.PanelService) *PanelHandler`
- `type panelRequest struct`
- `type panelDTO struct`
- `func toPanelDTO(panel domain.Panel) panelDTO`
- `method (*PanelHandler) List(c *gin.Context)`
- `method (*PanelHandler) Get(c *gin.Context)`
- `method (*PanelHandler) Create(c *gin.Context)`
- `method (*PanelHandler) Update(c *gin.Context)`
- `func parsePanelID(raw string) (uint, error)`
- `func decodeStrictJSON(c *gin.Context, target any) error`

### `platform/modules/m05/handler/panel_handler_test.go`

- `func TestParsePanelID(t *testing.T)`
- `func TestDecodeStrictJSON(t *testing.T)`

### `platform/modules/m05/handler/routes.go`

- `type Handlers struct`
- `func RegisterRoutes(platform *gin.RouterGroup, h Handlers)`

### `platform/modules/m05/handler/summary_handler.go`

- `type SummaryHandler struct`
- `func NewSummaryHandler(svc *service.SummaryService) *SummaryHandler`
- `method (*SummaryHandler) Get(c *gin.Context)`

### `platform/modules/m05/module.go`

- `type Options struct`
- `type Module struct`
- `func NewModule(db *gorm.DB, opts Options) (*Module, error)`
- `method (*Module) Name() string`
- `method (*Module) RegisterRoutes(platform *gin.RouterGroup) error`

### `platform/modules/m05/module_test.go`

- `func newTestDB(t *testing.T) *gorm.DB`
- `func seedUsersAndSessions(t *testing.T, gormDB *gorm.DB) (adminToken, viewerToken string)`
- `func newTestRouter(t *testing.T, gormDB *gorm.DB, opts Options) *gin.Engine`
- `func doJSON(t *testing.T, router http.Handler, method, path, token, body string) (int, map[string]any)`
- `func doSummary(t *testing.T, router http.Handler, token string) (int, dto.Summary)`
- `func seedReferenceData(t *testing.T, gormDB *gorm.DB)`
- `func insertResource(t *testing.T, gormDB *gorm.DB, id, category, domainID, appCode, bizCode, platformCode, subtype string)`
- `func insertJob(t *testing.T, gormDB *gorm.DB, id, jobType, domainID, selectedJSON string, enabled bool, draftStatus string)`
- `func nullIfEmpty(value string) any`
- `func TestRoutesRequireAuthenticationAndAdmin(t *testing.T)`
- `func TestSummaryEmptyDatabase(t *testing.T)`
- `func TestSummaryAggregatesCoversResourcesJobsAndDictionaries(t *testing.T)`
- `func TestSummaryCollectionHealthInjected(t *testing.T)`
- `type fixedQuerier struct`
- `method (fixedQuerier) UpHealth(context.Context) (*domain.UpHealthIndex, error)`
- `func TestPanelCRUD(t *testing.T)`

### `platform/modules/m05/repository/panel_repository.go`

- `type PanelRepository interface`
- `type panelRecord struct`
- `method (panelRecord) TableName() string`
- `method (panelRecord) toDomain() domain.Panel`
- `type GORMPanelRepository struct`
- `func NewGORMPanelRepository(db *gorm.DB) *GORMPanelRepository`
- `method (*GORMPanelRepository) List(ctx context.Context, page, pageSize int) ([]domain.Panel, int64, error)`
- `method (*GORMPanelRepository) Get(ctx context.Context, id uint) (domain.Panel, bool, error)`
- `method (*GORMPanelRepository) Create(ctx context.Context, input domain.CreatePanelInput) (domain.Panel, error)`
- `method (*GORMPanelRepository) Update(ctx context.Context, id uint, input domain.UpdatePanelInput) (domain.Panel, bool, error)`
- `method (*GORMPanelRepository) ExistsByName(ctx context.Context, name string, exceptID uint) (bool, error)`
- `func isUniqueViolation(err error) bool`

### `platform/modules/m05/repository/prom_up_health.go`

- `type PromUpHealthQuerier struct`
- `func NewPromUpHealthQuerier(baseURL *url.URL, client *http.Client) *PromUpHealthQuerier`
- `method (*PromUpHealthQuerier) UpHealth(ctx context.Context) (*domain.UpHealthIndex, error)`

### `platform/modules/m05/repository/prom_up_health_test.go`

- `func TestPromUpHealthQuerierClassifiesSamples(t *testing.T)`
- `func TestPromUpHealthQuerierDegrades(t *testing.T)`

### `platform/modules/m05/repository/summary_repository.go`

- `type ResourceRow struct`
- `type JobRow struct`
- `type DomainRow struct`
- `type AppPlatformRelRow struct`
- `type ProbeEndpoint struct`
- `type JobCounts struct`
- `type SummaryRepository interface`
- `type GORMSummaryRepository struct`
- `func NewGORMSummaryRepository(db *gorm.DB) *GORMSummaryRepository`
- `method (*GORMSummaryRepository) Resources(ctx context.Context) ([]ResourceRow, error)`
- `type subtypeSource struct`
- `method (*GORMSummaryRepository) ResourceSubtypes(ctx context.Context, category string) (map[string]string, error)`
- `method (*GORMSummaryRepository) ReadyJobs(ctx context.Context) ([]JobRow, error)`
- `method (*GORMSummaryRepository) ScrapeJobCounts(ctx context.Context) (JobCounts, error)`
- `method (*GORMSummaryRepository) MonitoredDomainCount(ctx context.Context) (int64, error)`
- `method (*GORMSummaryRepository) Domains(ctx context.Context) ([]DomainRow, error)`
- `method (*GORMSummaryRepository) AppNames(ctx context.Context) (map[string]string, error)`
- `method (*GORMSummaryRepository) BizNames(ctx context.Context) (map[string]string, error)`
- `method (*GORMSummaryRepository) PlatformNames(ctx context.Context) (map[string]string, error)`
- `method (*GORMSummaryRepository) CloudNames(ctx context.Context) (map[string]string, error)`
- `method (*GORMSummaryRepository) nameMap(ctx context.Context, query, what string) (map[string]string, error)`
- `method (*GORMSummaryRepository) AppPlatformRels(ctx context.Context) ([]AppPlatformRelRow, error)`
- `method (*GORMSummaryRepository) InterfaceServices(ctx context.Context, resourceIDs []string) (map[string]ProbeEndpoint, error)`
- `method (*GORMSummaryRepository) Applications(ctx context.Context, resourceIDs []string) (map[string]ProbeEndpoint, error)`

### `platform/modules/m05/service/panel_service.go`

- `type PanelPage struct`
- `type PanelService struct`
- `func NewPanelService(repo repository.PanelRepository) *PanelService`
- `method (*PanelService) List(ctx context.Context, page, pageSize int) (PanelPage, error)`
- `method (*PanelService) Get(ctx context.Context, id uint) (domain.Panel, error)`
- `method (*PanelService) Create(ctx context.Context, input domain.CreatePanelInput) (domain.Panel, error)`
- `method (*PanelService) Update(ctx context.Context, id uint, input domain.UpdatePanelInput) (domain.Panel, error)`
- `func normalizePanelInput(name, rawURL string) (string, string, error)`
- `func errPanelNotFound() error`
- `func errPanelNameConflict() error`

### `platform/modules/m05/service/summary_service.go`

- `type SummaryService struct`
- `func NewSummaryService(repo repository.SummaryRepository, health domain.UpHealthQuerier) *SummaryService`
- `type readyJob struct`
- `type summaryInput struct`
- `method (*SummaryService) Build(ctx context.Context) (*dto.Summary, error)`
- `method (*SummaryService) load(ctx context.Context) (*summaryInput, error)`
- `func decodeSelectedInstanceIDs(row repository.JobRow) ([]string, error)`
- `func probeResourceIDs(jobs []readyJob) []string`
- `type categoryAgg struct`
- `type subtypeAgg struct`
- `type appAgg struct`
- `type cloudAgg struct`
- `func assembleSummary(in *summaryInput) (*dto.Summary, []string)`
- `func buildCategorySummary(cats map[string]*categoryAgg) []dto.CategorySummary`
- `func buildAppSummary(apps map[string]*appAgg, appNames, bizNames map[string]string) []dto.AppSummary`
- `func accumulateHostCell(cells map[string]map[string]int, platformCode, appCode string)`
- `func buildPlatformAppSummary( hostCells map[string]map[string]int, platformNames map[string]string, appNames map[string]stri…`
- `func platformAppRow( platformCode string, row map[string]int, platformNames map[string]string, appNames map[string]string, )…`
- `func resolvePlatformName(code string, platformNames map[string]string) string`
- `func resolveAppName(code string, appNames map[string]string) string`
- `func accumulateCloudCell(aggs map[string]*cloudAgg, cloudCode string, monitored bool)`
- `func buildCloudSummary(aggs map[string]*cloudAgg, cloudNames map[string]string) []dto.CloudSummary`
- `func cloudSummaryRow(code string, agg *cloudAgg, cloudNames map[string]string) dto.CloudSummary`
- `func resolveCloudName(code string, cloudNames map[string]string) string`
- `func buildProbeTargets(in *summaryInput, live map[string]repository.ResourceRow) []dto.ProbeTargetItem`
- `func appPlatformDisplayNames(rels []repository.AppPlatformRelRow, platformNames map[string]string) map[string][]string`
- `func probeAppName(appCode string, appNames map[string]string) string`
- `func probePlatformNames(res repository.ResourceRow, appPlatformNames map[string][]string, platformNames map[string]string) s…`

### `platform/modules/m05/service/summary_service_test.go`

- `type fakeSummaryRepo struct`
- `method (*fakeSummaryRepo) Resources(context.Context) ([]repository.ResourceRow, error)`
- `method (*fakeSummaryRepo) ResourceSubtypes(_ context.Context, category string) (map[string]string, error)`
- `method (*fakeSummaryRepo) ReadyJobs(context.Context) ([]repository.JobRow, error)`
- `method (*fakeSummaryRepo) ScrapeJobCounts(context.Context) (repository.JobCounts, error)`
- `method (*fakeSummaryRepo) MonitoredDomainCount(context.Context) (int64, error)`
- `method (*fakeSummaryRepo) Domains(context.Context) ([]repository.DomainRow, error)`
- `method (*fakeSummaryRepo) AppNames(context.Context) (map[string]string, error)`
- `method (*fakeSummaryRepo) BizNames(context.Context) (map[string]string, error)`
- `method (*fakeSummaryRepo) PlatformNames(context.Context) (map[string]string, error)`
- `method (*fakeSummaryRepo) CloudNames(context.Context) (map[string]string, error)`
- `method (*fakeSummaryRepo) AppPlatformRels(context.Context) ([]repository.AppPlatformRelRow, error)`
- `method (*fakeSummaryRepo) InterfaceServices(context.Context, []string) (map[string]repository.ProbeEndpoint, error)`
- `method (*fakeSummaryRepo) Applications(context.Context, []string) (map[string]repository.ProbeEndpoint, error)`
- `type fakeUpHealthQuerier struct`
- `method (fakeUpHealthQuerier) UpHealth(context.Context) (*domain.UpHealthIndex, error)`
- `func emptySummaryRepo() *fakeSummaryRepo`
- `func TestBuildSummaryEmptyDatabase(t *testing.T)`
- `func richerSummaryRepo() *fakeSummaryRepo`
- `func TestBuildSummaryAggregates(t *testing.T)`
- `type appRow struct`
- `func TestBuildSummaryPlatformTopNAndOther(t *testing.T)`
- `func sumCells(cells []dto.PlatformAppCell) int`
- `func TestBuildSummaryCollectionHealth(t *testing.T)`
- `func TestBuildSummaryMonitoredIntersectionWithLiveResources(t *testing.T)`
- `func TestBuildSummaryRejectsBrokenSelectedIDs(t *testing.T)`
- `func TestBuildSummaryRepositoryError(t *testing.T)`
- `func TestBuildSummaryBizMajorityTieBreak(t *testing.T)`
- `func TestBuildSummaryProbeTargetsSkipUnusableRows(t *testing.T)`

### `platform/modules/m06/domain/cloud_dict.go`

- `type CloudDict struct`
- `type CreateCloudDictInput struct`
- `method (*CreateCloudDictInput) Normalize() error`
- `type CloudDictNotFoundError struct`
- `method (*CloudDictNotFoundError) Error() string`
- `method (*CloudDictNotFoundError) ErrorKind() apierror.Kind`
- `type CloudDictExistsError struct`
- `method (*CloudDictExistsError) Error() string`
- `method (*CloudDictExistsError) ErrorKind() apierror.Kind`
- `type CloudDictInUseError struct`
- `method (*CloudDictInUseError) Error() string`
- `method (*CloudDictInUseError) ErrorKind() apierror.Kind`

### `platform/modules/m06/domain/ids.go`

- `func ReadDeployCode() string`
- `func GenerateDomainID(deployCode, domainCode string) (string, error)`
- `func RandomDomainCode() (string, error)`

### `platform/modules/m06/domain/login_log.go`

- `type LoginLog struct`
- `type InvalidTimeRangeError struct`
- `method (*InvalidTimeRangeError) Error() string`
- `method (*InvalidTimeRangeError) ErrorKind() apierror.Kind`

### `platform/modules/m06/domain/network_domain.go`

- `type DomainType = string`
- `type DomainStatus = string`
- `type NetworkDomain struct`
- `type CreateNetworkDomainInput struct`
- `type UpdateNetworkDomainInput struct`
- `method (UpdateNetworkDomainInput) HasChanges() bool`
- `type ResourceSummary struct`
- `type Impact struct`
- `func ParseDomainStatus(raw string) (DomainStatus, error)`
- `func ParseDomainType(raw string) (*DomainType, error)`
- `type NetworkDomainNotFoundError struct`
- `method (*NetworkDomainNotFoundError) Error() string`
- `method (*NetworkDomainNotFoundError) ErrorKind() apierror.Kind`
- `type DomainInUseError struct`
- `method (*DomainInUseError) Error() string`
- `method (*DomainInUseError) ErrorKind() apierror.Kind`

### `platform/modules/m06/domain/network_domain_test.go`

- `func TestGenerateDomainID(t *testing.T)`
- `func TestRandomDomainCode(t *testing.T)`
- `func TestParseDomainType(t *testing.T)`
- `func TestParseDomainStatus(t *testing.T)`
- `func TestDomainInUseError(t *testing.T)`
- `func TestNetworkDomainNotFoundError(t *testing.T)`

### `platform/modules/m06/domain/tenant.go`

- `type TenantStatus = string`
- `method (TenantStatus) Valid() bool`
- `func ParseTenantStatus(raw string) (TenantStatus, error)`
- `type Tenant struct`
- `type UpdateTenantInput struct`
- `method (UpdateTenantInput) HasChanges() bool`
- `type ValidationError struct`
- `method (*ValidationError) Error() string`
- `method (*ValidationError) ErrorKind() apierror.Kind`
- `type TenantNotFoundError struct`
- `method (*TenantNotFoundError) Error() string`
- `method (*TenantNotFoundError) ErrorKind() apierror.Kind`
- `type ForbiddenError struct`
- `method (*ForbiddenError) Error() string`
- `method (*ForbiddenError) ErrorKind() apierror.Kind`
- `type ConflictError struct`
- `method (*ConflictError) Error() string`
- `method (*ConflictError) ErrorKind() apierror.Kind`

### `platform/modules/m06/domain/user.go`

- `type UserStatus = string`
- `type UserRole = string`
- `type User struct`
- `type CreateUserInput struct`
- `type UpdateUserInput struct`
- `method (UpdateUserInput) HasChanges() bool`
- `func ParseUserStatus(raw string) (UserStatus, error)`
- `func ParseUserRole(raw string) (UserRole, error)`
- `type UserNotFoundError struct`
- `method (*UserNotFoundError) Error() string`
- `method (*UserNotFoundError) ErrorKind() apierror.Kind`
- `type UsernameTakenError struct`
- `method (*UsernameTakenError) Error() string`
- `method (*UsernameTakenError) ErrorKind() apierror.Kind`
- `type LastAdminError struct`
- `method (*LastAdminError) Error() string`
- `method (*LastAdminError) ErrorKind() apierror.Kind`
- `func NewUserID() (string, error)`

### `platform/modules/m06/domain/user_test.go`

- `func TestNewUserID(t *testing.T)`
- `func TestParseUserStatus(t *testing.T)`
- `func TestParseUserRole(t *testing.T)`
- `func TestUserErrors(t *testing.T)`

### `platform/modules/m06/dto/cloud_dict.go`

- `type CloudDictResponse struct`
- `func FromCloudDict(item *domain.CloudDict) CloudDictResponse`
- `type CreateCloudDictRequest struct`
- `method (CreateCloudDictRequest) ToDomain() domain.CreateCloudDictInput`
- `type UpdateCloudDictRequest struct`

### `platform/modules/m06/dto/login_log.go`

- `type ListLoginLogsResponse struct`
- `type LoginLogResponse struct`
- `func FromLoginLog(log *domain.LoginLog) LoginLogResponse`

### `platform/modules/m06/dto/network_domain.go`

- `type NetworkDomainResponse struct`
- `type CreateNetworkDomainRequest struct`
- `method (CreateNetworkDomainRequest) ToDomain() (domain.CreateNetworkDomainInput, error)`
- `type UpdateNetworkDomainRequest struct`
- `method (UpdateNetworkDomainRequest) ToDomain() domain.UpdateNetworkDomainInput`
- `type UpdateNetworkDomainStatusRequest struct`
- `type UpdateNetworkDomainStatusResponse struct`
- `type DeleteNetworkDomainResponse struct`
- `type ImpactResponse struct`
- `type SampleResource struct`
- `func FromNetworkDomain(item *domain.NetworkDomain) NetworkDomainResponse`
- `func FromImpact(impact *domain.Impact) ImpactResponse`

### `platform/modules/m06/dto/tenant.go`

- `type ListTenantsResponse struct`
- `type TenantResponse struct`
- `type UpdateTenantRequest struct`
- `method (UpdateTenantRequest) ToDomain() domain.UpdateTenantInput`
- `func FromDomain(t *domain.Tenant) TenantResponse`

### `platform/modules/m06/dto/user.go`

- `type ListUsersResponse struct`
- `type UserResponse struct`
- `type CreateUserRequest struct`
- `method (CreateUserRequest) ToDomain() domain.CreateUserInput`
- `type UpdateUserRequest struct`
- `method (UpdateUserRequest) ToDomain() domain.UpdateUserInput`
- `type UpdateUserStatusRequest struct`
- `type ResetPasswordRequest struct`
- `type DeleteUserResponse struct`
- `type ResetPasswordResponse struct`
- `func FromUser(user *domain.User) UserResponse`

### `platform/modules/m06/handler/cloud_dict_handler.go`

- `type CloudDictHandler struct`
- `func NewCloudDictHandler(svc *service.CloudDictService) *CloudDictHandler`
- `method (*CloudDictHandler) Create(c *gin.Context)`
- `method (*CloudDictHandler) Update(c *gin.Context)`

### `platform/modules/m06/handler/cloud_dict_handler_test.go`

- `func newCloudDictTestRouter(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB)`
- `func TestCloudDictCreateAndDisable(t *testing.T)`
- `func TestCloudDictCreateValidation(t *testing.T)`
- `func TestCloudDictDisableGuards(t *testing.T)`
- `func TestCloudDictRequiresAdmin(t *testing.T)`

### `platform/modules/m06/handler/login_log_handler.go`

- `type LoginLogHandler struct`
- `func NewLoginLogHandler(svc *service.LoginLogService) *LoginLogHandler`
- `method (*LoginLogHandler) List(c *gin.Context)`
- `func parseRFC3339Query(c *gin.Context, key string) (*time.Time, error)`

### `platform/modules/m06/handler/network_domain_handler.go`

- `type NetworkDomainHandler struct`
- `func NewNetworkDomainHandler(svc *service.NetworkDomainService) *NetworkDomainHandler`
- `method (*NetworkDomainHandler) Impact(c *gin.Context)`
- `method (*NetworkDomainHandler) Create(c *gin.Context)`
- `method (*NetworkDomainHandler) Update(c *gin.Context)`
- `method (*NetworkDomainHandler) UpdateStatus(c *gin.Context)`
- `method (*NetworkDomainHandler) Delete(c *gin.Context)`
- `func decodeStrictJSON(c *gin.Context, target any) error`

### `platform/modules/m06/handler/network_domain_handler_test.go`

- `type fakeMonitoring struct`
- `method (*fakeMonitoring) Available() bool`
- `method (*fakeMonitoring) Impact(context.Context, string) (references.MonitoringImpact, error)`
- `method (*fakeMonitoring) RetireDomain(_ context.Context, domainID string) error`
- `func newNetworkDomainTestRouter(t *testing.T, user *models.User, monitoring references.MonitoringRetirer) (*gin.Engine, *gor…`
- `func TestNetworkDomainCreateAndList(t *testing.T)`
- `func TestNetworkDomainUpdate(t *testing.T)`
- `func TestNetworkDomainStatus(t *testing.T)`
- `func TestNetworkDomainDelete(t *testing.T)`
- `func TestNetworkDomainReadsAllowUsersButMutationsRequireAdmin(t *testing.T)`
- `func TestNetworkDomainErrorEnvelope(t *testing.T)`

### `platform/modules/m06/handler/routes.go`

- `type Handlers struct`
- `func RegisterRoutes(platform *gin.RouterGroup, h Handlers)`

### `platform/modules/m06/handler/storage_handler.go`

- `type StorageHandler struct`
- `func NewStorageHandler(svc *storage.Service) *StorageHandler`
- `method (*StorageHandler) GetOverview(c *gin.Context)`
- `method (*StorageHandler) UpdateRetention(c *gin.Context)`

### `platform/modules/m06/handler/storage_handler_test.go`

- `func newStorageTestRouter(t *testing.T, user *models.User, envFile string, promURL *url.URL) *gin.Engine`
- `func mockStorageProm(t *testing.T) *url.URL`
- `func TestStorageOverviewAndRetentionUpdate(t *testing.T)`
- `func TestStorageUnconfiguredEnvReturnsActionable503(t *testing.T)`
- `func TestStorageRequiresAdmin(t *testing.T)`

### `platform/modules/m06/handler/tenant_handler.go`

- `type TenantHandler struct`
- `func NewTenantHandler(svc *service.TenantService) *TenantHandler`
- `method (*TenantHandler) List(c *gin.Context)`
- `method (*TenantHandler) Get(c *gin.Context)`
- `method (*TenantHandler) Update(c *gin.Context)`
- `method (*TenantHandler) Create(c *gin.Context)`
- `method (*TenantHandler) ChangeStatus(c *gin.Context)`
- `func parsePagination(c *gin.Context) (int, int)`

### `platform/modules/m06/handler/tenant_handler_test.go`

- `func newTenantTestRouter(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB)`
- `func adminUser() *models.User`
- `func doRequest(t *testing.T, router *gin.Engine, method, path, body string) (int, map[string]any)`
- `func TestTenantListAndGet(t *testing.T)`
- `func TestTenantUpdateOnlyMutableFields(t *testing.T)`
- `func TestTenantLifecycleEndpointsForbidden(t *testing.T)`
- `func TestTenantAdminGateRejectsUsers(t *testing.T)`

### `platform/modules/m06/handler/user_handler.go`

- `type UserHandler struct`
- `func NewUserHandler(svc *service.UserService) *UserHandler`
- `method (*UserHandler) List(c *gin.Context)`
- `method (*UserHandler) Create(c *gin.Context)`
- `method (*UserHandler) Update(c *gin.Context)`
- `method (*UserHandler) UpdateStatus(c *gin.Context)`
- `method (*UserHandler) ResetPassword(c *gin.Context)`
- `method (*UserHandler) Delete(c *gin.Context)`

### `platform/modules/m06/handler/user_handler_test.go`

- `func newUserTestRouter(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB)`
- `func countSessions(t *testing.T, db *gorm.DB, userID string) int64`
- `func TestUserCreateListGet(t *testing.T)`
- `func TestUserUpdateAndRoleGuards(t *testing.T)`
- `func TestUserStatusAndLastAdminGuard(t *testing.T)`
- `func TestUserResetPasswordAndDelete(t *testing.T)`
- `func TestLoginLogsFiltersAndShape(t *testing.T)`
- `func TestUserAndLoginLogAdminGate(t *testing.T)`

### `platform/modules/m06/module.go`

- `type Options struct`
- `type Module struct`
- `func NewModule(db *gorm.DB, opts Options) (*Module, error)`
- `method (*Module) Name() string`
- `method (*Module) RegisterRoutes(platform *gin.RouterGroup) error`

### `platform/modules/m06/references/m07.go`

- `type M07Reader interface`
- `type GORMM07Reader struct`
- `func NewGORMM07Reader(db *gorm.DB) *GORMM07Reader`
- `method (*GORMM07Reader) CountByDomain(ctx context.Context, domainID string) (int64, error)`
- `method (*GORMM07Reader) SamplesByDomain(ctx context.Context, domainID string, limit int) ([]domain.ResourceSummary, error)`

### `platform/modules/m06/references/monitoring.go`

- `type MonitoringImpact struct`
- `type MonitoringRetirer interface`
- `type NoopMonitoring struct`
- `method (NoopMonitoring) Available() bool`
- `method (NoopMonitoring) Impact(context.Context, string) (MonitoringImpact, error)`
- `method (NoopMonitoring) RetireDomain(context.Context, string) error`

### `platform/modules/m06/references/scrape_jobs.go`

- `type ScrapeJobCounter interface`
- `type NoopScrapeJobCounter struct`
- `method (NoopScrapeJobCounter) CountByDomain(context.Context, string) (int64, error)`
- `type GORMScrapeJobCounter struct`
- `func NewGORMScrapeJobCounter(db *gorm.DB) *GORMScrapeJobCounter`
- `method (*GORMScrapeJobCounter) CountByDomain(ctx context.Context, domainID string) (int64, error)`

### `platform/modules/m06/references/scrape_jobs_test.go`

- `func TestGORMScrapeJobCounter(t *testing.T)`

### `platform/modules/m06/repository/cloud_dict_repository.go`

- `type CloudDictRepository interface`
- `type GORMCloudDictRepository struct`
- `func NewGORMCloudDictRepository(db *gorm.DB) *GORMCloudDictRepository`
- `func cloudDictFromModel(row *models.CloudDict) *domain.CloudDict`
- `method (*GORMCloudDictRepository) Get(ctx context.Context, code string) (*domain.CloudDict, bool, error)`
- `method (*GORMCloudDictRepository) Create(ctx context.Context, entry domain.CloudDict) (*domain.CloudDict, error)`
- `method (*GORMCloudDictRepository) Disable(ctx context.Context, code string) (*domain.CloudDict, error)`
- `method (*GORMCloudDictRepository) CountNetworkDomains(ctx context.Context, code string) (int64, error)`

### `platform/modules/m06/repository/dictionary_repository.go`

- `type DictionaryRepository interface`
- `type GORMDictionaryRepository struct`
- `func NewGORMDictionaryRepository(db *gorm.DB) *GORMDictionaryRepository`
- `method (*GORMDictionaryRepository) CloudEnabled(ctx context.Context, code string) (bool, error)`
- `method (*GORMDictionaryRepository) TenantActive(ctx context.Context, id string) (bool, error)`

### `platform/modules/m06/repository/login_log_repository.go`

- `type ListLoginLogsFilter struct`
- `type LoginLogRepository interface`
- `type GORMLoginLogRepository struct`
- `func NewGORMLoginLogRepository(db *gorm.DB) *GORMLoginLogRepository`
- `method (*GORMLoginLogRepository) List(ctx context.Context, filter ListLoginLogsFilter) ([]*domain.LoginLog, int64, error)`

### `platform/modules/m06/repository/network_domain_repository.go`

- `type networkDomainRecord struct`
- `method (networkDomainRecord) TableName() string`
- `type ListNetworkDomainsFilter struct`
- `type NetworkDomainRepository interface`
- `type GORMNetworkDomainRepository struct`
- `func NewGORMNetworkDomainRepository(db *gorm.DB) *GORMNetworkDomainRepository`
- `method (*GORMNetworkDomainRepository) List(ctx context.Context, filter ListNetworkDomainsFilter) ([]*domain.NetworkDomain, int…`
- `method (*GORMNetworkDomainRepository) Get(ctx context.Context, id string) (*domain.NetworkDomain, error)`
- `method (*GORMNetworkDomainRepository) NameExists(ctx context.Context, name, excludeID string) (bool, error)`
- `method (*GORMNetworkDomainRepository) IDExistsIncludingDeleted(ctx context.Context, id string) (bool, error)`
- `method (*GORMNetworkDomainRepository) Create(ctx context.Context, item *domain.NetworkDomain) error`
- `func isUniqueViolation(err error) bool`
- `method (*GORMNetworkDomainRepository) Update(ctx context.Context, id string, input domain.UpdateNetworkDomainInput) (*domain.N…`
- `method (*GORMNetworkDomainRepository) UpdateStatus(ctx context.Context, id string, status domain.DomainStatus) error`
- `method (*GORMNetworkDomainRepository) Delete(ctx context.Context, id string) error`
- `func syncTenantCaches(ctx context.Context, tx *gorm.DB, tenantIDs ...string) error`
- `func toDomainDomain(row *networkDomainRecord) *domain.NetworkDomain`
- `func fromDomainDomain(item *domain.NetworkDomain) *networkDomainRecord`

### `platform/modules/m06/repository/tenant_repository.go`

- `type ListTenantsFilter struct`
- `type TenantRepository interface`
- `type GORMRepository struct`
- `func NewGORMRepository(db *gorm.DB) *GORMRepository`
- `method (*GORMRepository) List(ctx context.Context, filter ListTenantsFilter) ([]*domain.Tenant, int64, error)`
- `method (*GORMRepository) Get(ctx context.Context, id string) (*domain.Tenant, error)`
- `method (*GORMRepository) Update(ctx context.Context, id string, input domain.UpdateTenantInput) (*domain.Tenant, error)`
- `func toDomain(row *models.Tenant) *domain.Tenant`

### `platform/modules/m06/repository/user_repository.go`

- `type ListUsersFilter struct`
- `type UserRepository interface`
- `type GORMUserRepository struct`
- `func NewGORMUserRepository(db *gorm.DB) *GORMUserRepository`
- `method (*GORMUserRepository) List(ctx context.Context, filter ListUsersFilter) ([]*domain.User, int64, error)`
- `method (*GORMUserRepository) Get(ctx context.Context, id string) (*domain.User, error)`
- `method (*GORMUserRepository) Create(ctx context.Context, user *domain.User, passwordHash string) error`
- `method (*GORMUserRepository) UpdateProfile(ctx context.Context, id string, input domain.UpdateUserInput) (*domain.User, error)`
- `method (*GORMUserRepository) UpdateStatus(ctx context.Context, id string, status domain.UserStatus) (*domain.User, error)`
- `method (*GORMUserRepository) UpdatePassword(ctx context.Context, id, passwordHash string) error`
- `method (*GORMUserRepository) Delete(ctx context.Context, id string) error`
- `method (*GORMUserRepository) CountActiveAdmins(ctx context.Context, excludeUserID string) (int64, error)`
- `func deleteSessionsByUserID(tx *gorm.DB, userID string) error`
- `func toDomainUser(row *models.User) *domain.User`

### `platform/modules/m06/service/cloud_dict_service.go`

- `type CloudDictService struct`
- `func NewCloudDictService(repo repository.CloudDictRepository) *CloudDictService`
- `method (*CloudDictService) Create(ctx context.Context, input domain.CreateCloudDictInput) (*domain.CloudDict, error)`
- `method (*CloudDictService) Disable(ctx context.Context, code string) (*domain.CloudDict, error)`

### `platform/modules/m06/service/login_log_service.go`

- `type LoginLogService struct`
- `func NewLoginLogService(logs repository.LoginLogRepository) *LoginLogService`
- `method (*LoginLogService) List(ctx context.Context, filter repository.ListLoginLogsFilter) ([]*domain.LoginLog, int64, error)`

### `platform/modules/m06/service/network_domain_service.go`

- `type NetworkDomainService struct`
- `func NewNetworkDomainService( domains repository.NetworkDomainRepository, dictionary repository.DictionaryRepository, m07 re…`
- `method (*NetworkDomainService) List(ctx context.Context, filter repository.ListNetworkDomainsFilter) ([]*domain.NetworkDomain,…`
- `method (*NetworkDomainService) Get(ctx context.Context, id string) (*domain.NetworkDomain, error)`
- `method (*NetworkDomainService) Create(ctx context.Context, input domain.CreateNetworkDomainInput) (*domain.NetworkDomain, erro…`
- `method (*NetworkDomainService) Update(ctx context.Context, id string, input domain.UpdateNetworkDomainInput) (*domain.NetworkD…`
- `method (*NetworkDomainService) UpdateStatus(ctx context.Context, id string, rawStatus string) (*domain.Impact, error)`
- `method (*NetworkDomainService) Impact(ctx context.Context, id string) (*domain.Impact, error)`
- `method (*NetworkDomainService) Delete(ctx context.Context, id string) (*domain.Impact, error)`
- `method (*NetworkDomainService) computeImpact(ctx context.Context, id string) (*domain.Impact, error)`
- `method (*NetworkDomainService) normalizeTenantIDs(ctx context.Context, raw []string) ([]string, error)`
- `func stringValue(value *domain.DomainType) string`

### `platform/modules/m06/service/network_domain_service_test.go`

- `type stubDomainRepo struct`
- `method (*stubDomainRepo) Get(context.Context, string) (*domain.NetworkDomain, error)`
- `method (*stubDomainRepo) Delete(context.Context, string) error`
- `method (*stubDomainRepo) UpdateStatus(context.Context, string, domain.DomainStatus) error`
- `type stubM07Reader struct`
- `method (*stubM07Reader) CountByDomain(context.Context, string) (int64, error)`
- `method (*stubM07Reader) SamplesByDomain(context.Context, string, int) ([]domain.ResourceSummary, error)`
- `type stubScrapeJobCounter struct`
- `method (*stubScrapeJobCounter) CountByDomain(context.Context, string) (int64, error)`
- `func TestImpactIncludesScrapeJobCount(t *testing.T)`
- `func TestDeleteRejectedByScrapeJobs(t *testing.T)`

### `platform/modules/m06/service/tenant_service.go`

- `type TenantService struct`
- `func NewTenantService(repo repository.TenantRepository) *TenantService`
- `method (*TenantService) List(ctx context.Context, filter repository.ListTenantsFilter) ([]*domain.Tenant, int64, error)`
- `method (*TenantService) Get(ctx context.Context, id string) (*domain.Tenant, error)`
- `method (*TenantService) Update(ctx context.Context, id string, input domain.UpdateTenantInput) (*domain.Tenant, error)`
- `method (*TenantService) Create(context.Context) error`
- `method (*TenantService) ChangeStatus(context.Context, string) error`

### `platform/modules/m06/service/user_service.go`

- `type UserService struct`
- `func NewUserService(users repository.UserRepository) *UserService`
- `method (*UserService) List(ctx context.Context, filter repository.ListUsersFilter) ([]*domain.User, int64, error)`
- `method (*UserService) Get(ctx context.Context, id string) (*domain.User, error)`
- `method (*UserService) Create(ctx context.Context, input domain.CreateUserInput) (*domain.User, error)`
- `method (*UserService) Update(ctx context.Context, id string, input domain.UpdateUserInput) (*domain.User, error)`
- `method (*UserService) UpdateStatus(ctx context.Context, id, rawStatus string) (*domain.User, error)`
- `method (*UserService) ResetPassword(ctx context.Context, id, newPassword string) error`
- `method (*UserService) Delete(ctx context.Context, id string) error`
- `func normalizeRole(raw string) (domain.UserRole, error)`
- `func validatePassword(password string) error`

### `platform/modules/m06/storage/diskusage_unix.go`

- `func diskUsage(dirPath string) (total, used, free uint64, err error)`

### `platform/modules/m06/storage/diskusage_windows.go`

- `func diskUsage(dirPath string) (total, used, free uint64, err error)`

### `platform/modules/m06/storage/retention.go`

- `type RetentionValues struct`
- `func ValidateRetentionTime(s string) error`
- `func ValidateRetentionSize(s string) error`
- `func parsePromDuration(s string) (time.Duration, error)`
- `func parsePromBytes(s string) (int64, error)`
- `func valuesEqual(a, b RetentionValues) bool`
- `func durationEqual(a, b string) bool`
- `func bytesEqual(a, b string) bool`
- `func readRetentionPolicy(path string) (vals RetentionValues, found bool, err error)`
- `func writeRetentionPolicy(path string, vals RetentionValues) error`

### `platform/modules/m06/storage/service.go`

- `type Options struct`
- `type RetentionState struct`
- `type DiskInfo struct`
- `type LogRotationInfo struct`
- `type Overview struct`
- `type Service struct`
- `func NewService(opts Options) *Service`
- `method (*Service) Overview(ctx context.Context) (*Overview, error)`
- `method (*Service) UpdateRetention(ctx context.Context, timeValue, sizeValue string) (*Overview, error)`
- `func readDesired(envFile string) (RetentionValues, bool, error)`
- `method (*Service) fetchRuntimeFlags(ctx context.Context) (RetentionValues, string, bool)`
- `method (*Service) diskEntries(tsdbPath string, runtimeOK bool) []DiskInfo`
- `func newDiskInfo(label, dirPath string) DiskInfo`

### `platform/modules/m06/storage/service_test.go`

- `func mockPromFlags(t *testing.T, retentionTime, retentionSize, tsdbPath string) *url.URL`
- `func TestValidateRetention(t *testing.T)`
- `func TestWriteRetentionPolicyAtomic(t *testing.T)`
- `func TestOverviewRuntimeDefaultAndDisk(t *testing.T)`
- `func TestOverviewPendingRestartNormalization(t *testing.T)`
- `func TestOverviewDegradesWhenPrometheusDown(t *testing.T)`
- `func TestOverviewLogRootDiskRow(t *testing.T)`
- `func TestUpdateRetentionWritesAndReportsPending(t *testing.T)`
- `func TestUpdateRetentionRejectsInvalidAndUnconfigured(t *testing.T)`

### `platform/modules/m06/storage/system.go`

- `func detectLogRotation() LogRotationInfo`
- `func readConf(path string) (content string, ok bool)`

### `platform/modules/m07/dictionary/declaration.go`

- `type DeclaredEntry struct`
- `type DeclarationWriter interface`
- `method (*GORMRepository) EnsureDeclarations(ctx context.Context, biz, app, platform []DeclaredEntry) error`
- `method (*GORMRepository) EnsureDeclaredBusinessDomains(ctx context.Context, entries []DeclaredEntry) error`
- `method (*GORMRepository) EnsureDeclaredApplications(ctx context.Context, entries []DeclaredEntry) error`
- `method (*GORMRepository) EnsureDeclaredPlatforms(ctx context.Context, entries []DeclaredEntry) error`
- `func isNotFound(err error) bool`

### `platform/modules/m07/dictionary/declaration_test.go`

- `func TestEnsureDeclarations(t *testing.T)`

### `platform/modules/m07/dictionary/models.go`

- `type businessDomainRecord struct`
- `method (businessDomainRecord) TableName() string`
- `type applicationDictRecord struct`
- `method (applicationDictRecord) TableName() string`
- `type platformDictRecord struct`
- `method (platformDictRecord) TableName() string`
- `type cloudDictRecord struct`
- `method (cloudDictRecord) TableName() string`
- `type networkDomainRecord struct`
- `method (networkDomainRecord) TableName() string`
- `type appPlatformRelRecord struct`
- `method (appPlatformRelRecord) TableName() string`
- `type dictionaryAuditLogRecord struct`
- `method (dictionaryAuditLogRecord) TableName() string`

### `platform/modules/m07/dictionary/repository.go`

- `type BusinessDomain struct`
- `type Application struct`
- `type Platform struct`
- `type DictionaryAuditLog struct`
- `type Cloud struct`
- `type AppPlatformRel struct`
- `type OSOption struct`
- `type Repository interface`
- `type GORMRepository struct`
- `func NewGORMRepository(db *gorm.DB) *GORMRepository`
- `method (*GORMRepository) BusinessDomainEnabled(ctx context.Context, code string) (bool, error)`
- `method (*GORMRepository) ApplicationEnabled(ctx context.Context, code string) (bool, error)`
- `method (*GORMRepository) PlatformEnabled(ctx context.Context, code string) (bool, error)`
- `method (*GORMRepository) NetworkDomainUsable(ctx context.Context, id string) (bool, error)`
- `method (*GORMRepository) PlatformBelongsToApp(ctx context.Context, appCode, platformCode string) (bool, error)`
- `method (*GORMRepository) PrimaryPlatformOfApp(ctx context.Context, appCode string) (string, bool, error)`
- `method (*GORMRepository) ListBusinessDomains(ctx context.Context) ([]BusinessDomain, error)`
- `method (*GORMRepository) ListApplications(ctx context.Context) ([]Application, error)`
- `method (*GORMRepository) ListPlatforms(ctx context.Context) ([]Platform, error)`
- `method (*GORMRepository) CreateBusinessDomain(ctx context.Context, code, name, description string) (*BusinessDomain, error)`
- `method (*GORMRepository) UpdateBusinessDomain(ctx context.Context, code string, name, description *string, enabled *bool) (*Bu…`
- `method (*GORMRepository) CreateApplication(ctx context.Context, appCode, appName, description string, platformCodes []string) …`
- `method (*GORMRepository) UpdateApplication(ctx context.Context, appCode string, appName, description, status *string) (*Applic…`
- `method (*GORMRepository) CreatePlatform(ctx context.Context, platformCode, platformName, description string) (*Platform, error)`
- `method (*GORMRepository) UpdatePlatform(ctx context.Context, platformCode string, platformName, description *string, enabled *…`
- `method (*GORMRepository) ensureAbsent(ctx context.Context, model any, column, value string) error`
- `func optionalString(value string) *string`
- `func derefString(value *string) string`
- `method (*GORMRepository) ListClouds(ctx context.Context) ([]Cloud, error)`
- `method (*GORMRepository) ListAppPlatformRels(ctx context.Context, appCode, platformCode string) ([]AppPlatformRel, error)`
- `method (*GORMRepository) CreateAppPlatformRel(ctx context.Context, appCode, platformCode string, isPrimary bool) (*AppPlatform…`
- `func createAppPlatformRelTx(tx *gorm.DB, appCode, platformCode string, isPrimary bool) (*AppPlatformRel, error)`
- `method (*GORMRepository) SetPrimaryAppPlatformRel(ctx context.Context, relID string, isPrimary bool) (*AppPlatformRel, error)`
- `method (*GORMRepository) DeleteAppPlatformRel(ctx context.Context, relID string) error`
- `method (*GORMRepository) ListOSOptions(ctx context.Context) ([]OSOption, error)`
- `func dictionaryStatus(enabled bool, mergedInto *string, revokedAt *time.Time) string`
- `method (*GORMRepository) businessDomainReferenceCounts(ctx context.Context) (map[string]int64, error)`
- `method (*GORMRepository) applicationReferenceCounts(ctx context.Context) (map[string]int64, error)`
- `method (*GORMRepository) platformReferenceCounts(ctx context.Context) (map[string]int64, error)`
- `method (*GORMRepository) CountBusinessDomainReferences(ctx context.Context, code string) (int64, error)`
- `method (*GORMRepository) CountApplicationReferences(ctx context.Context, code string) (int64, error)`
- `method (*GORMRepository) CountPlatformReferences(ctx context.Context, code string) (int64, error)`
- `method (*GORMRepository) cloudReferenceCounts(ctx context.Context) (map[string]int64, error)`
- `method (*GORMRepository) CountCloudReferences(ctx context.Context, cloudCode string) (int64, error)`
- `method (*GORMRepository) RevokeBusinessDomain(ctx context.Context, code, operator string) (*BusinessDomain, error)`
- `method (*GORMRepository) RevokeApplication(ctx context.Context, appCode, operator string) (*Application, error)`
- `method (*GORMRepository) RevokePlatform(ctx context.Context, platformCode, operator string) (*Platform, error)`
- `method (*GORMRepository) RevokeCloud(ctx context.Context, cloudCode, operator string) (*Cloud, error)`
- `method (*GORMRepository) MergeBusinessDomain(ctx context.Context, source, target, operator string) (int64, error)`
- `method (*GORMRepository) MergeApplication(ctx context.Context, source, target, operator string) (int64, error)`
- `method (*GORMRepository) MergePlatform(ctx context.Context, source, target, operator string) (int64, error)`
- `method (*GORMRepository) MergeCloud(ctx context.Context, source, target, operator string) (int64, error)`
- `func migrateAppPlatformRelsTx(tx *gorm.DB, fromApp, toApp string) error`
- `func migratePlatformRelsTx(tx *gorm.DB, fromPlatform, toPlatform string) error`
- `func ensurePrimaryAppPlatformTx(tx *gorm.DB, appCode string) error`
- `func insertDictionaryAuditTx(tx *gorm.DB, entry DictionaryAuditLog) error`
- `method (*GORMRepository) ListDictionaryAuditLogs(ctx context.Context, dictionaryType, code string, limit int) ([]DictionaryAud…`
- `func loadBusinessDomainTx(tx *gorm.DB, code string) (*businessDomainRecord, error)`
- `func loadApplicationTx(tx *gorm.DB, appCode string) (*applicationDictRecord, error)`
- `func loadPlatformTx(tx *gorm.DB, platformCode string) (*platformDictRecord, error)`
- `func loadCloudTx(tx *gorm.DB, cloudCode string) (*cloudDictRecord, error)`
- `func ensureMergeable(revokedAt *time.Time, mergedInto *string) error`
- `func countBusinessDomainReferencesTx(tx *gorm.DB, code string) (int64, error)`
- `func countApplicationReferencesTx(tx *gorm.DB, code string) (int64, error)`
- `func countPlatformReferencesTx(tx *gorm.DB, code string) (int64, error)`
- `func countCloudReferencesTx(tx *gorm.DB, cloudCode string) (int64, error)`

### `platform/modules/m07/dictionary/service.go`

- `type Resolver interface`
- `type Service struct`
- `func NewService(repo Repository) *Service`
- `method (*Service) ValidateResource(ctx context.Context, resource *domain.Resource) error`
- `method (*Service) ValidateResourceUpdate(ctx context.Context, before, after *domain.Resource) error`
- `method (*Service) validateResource(ctx context.Context, before, after *domain.Resource) error`
- `method (*Service) PrimaryPlatformOfApp(ctx context.Context, appCode string) (string, bool, error)`
- `method (*Service) PlatformBelongsToApp(ctx context.Context, appCode, platformCode string) (bool, error)`
- `method (*Service) ValidateReferenceTarget(ctx context.Context, field, code string) error`
- `method (*Service) ListBusinessDomains(ctx context.Context) ([]BusinessDomain, error)`
- `method (*Service) CreateBusinessDomain(ctx context.Context, code, name, description string) (*BusinessDomain, error)`
- `method (*Service) UpdateBusinessDomain(ctx context.Context, code string, name, description *string, enabled *bool) (*BusinessD…`
- `method (*Service) ListApplications(ctx context.Context) ([]Application, error)`
- `method (*Service) CreateApplication(ctx context.Context, appCode, appName, description string, platformCodes []string) (*Appli…`
- `func normalizePlatformCodes(raw []string) ([]string, error)`
- `method (*Service) UpdateApplication(ctx context.Context, appCode string, appName, description, status *string) (*Application, …`
- `method (*Service) ListPlatforms(ctx context.Context) ([]Platform, error)`
- `method (*Service) CreatePlatform(ctx context.Context, platformCode, platformName, description string) (*Platform, error)`
- `method (*Service) UpdatePlatform(ctx context.Context, platformCode string, platformName, description *string, enabled *bool) (…`
- `method (*Service) ListClouds(ctx context.Context) ([]Cloud, error)`
- `method (*Service) RevokeBusinessDomain(ctx context.Context, code, operator string) (*BusinessDomain, error)`
- `method (*Service) RevokeApplication(ctx context.Context, appCode, operator string) (*Application, error)`
- `method (*Service) RevokePlatform(ctx context.Context, platformCode, operator string) (*Platform, error)`
- `method (*Service) MergeBusinessDomain(ctx context.Context, source, target, operator string) (int64, error)`
- `method (*Service) MergeApplication(ctx context.Context, source, target, operator string) (int64, error)`
- `method (*Service) MergePlatform(ctx context.Context, source, target, operator string) (int64, error)`
- `method (*Service) RevokeCloud(ctx context.Context, cloudCode, operator string) (*Cloud, error)`
- `method (*Service) MergeCloud(ctx context.Context, source, target, operator string) (int64, error)`
- `func validateMergeCodes(source, target, field string) (string, string, error)`
- `method (*Service) ListDictionaryAuditLogs(ctx context.Context, dictionaryType, code string, limit int) ([]DictionaryAuditLog, …`
- `method (*Service) ListAppPlatformRels(ctx context.Context, appCode, platformCode string) ([]AppPlatformRel, error)`
- `method (*Service) CreateAppPlatformRel(ctx context.Context, appCode, platformCode string, isPrimary bool) (*AppPlatformRel, er…`
- `method (*Service) SetPrimaryAppPlatformRel(ctx context.Context, relID string, isPrimary bool) (*AppPlatformRel, error)`
- `method (*Service) DeleteAppPlatformRel(ctx context.Context, relID string) error`
- `method (*Service) ListOSOptions(ctx context.Context) ([]OSOption, error)`
- `method (*Service) EnsureDeclarations(ctx context.Context, biz, app, platform []DeclaredEntry) error`

### `platform/modules/m07/dictionary/service_test.go`

- `func openDictionaryTestDB(t *testing.T) *gorm.DB`
- `func testResource() *domain.Resource`
- `func TestServiceValidateResource(t *testing.T)`
- `func TestServicePrimaryPlatform(t *testing.T)`
- `func TestServiceAppPlatformRelCRUD(t *testing.T)`
- `func TestCreateApplicationRequiresPlatforms(t *testing.T)`
- `func TestServiceList(t *testing.T)`
- `func TestValidateResourceUpdateIgnoresUnchangedDisabledRefs(t *testing.T)`
- `func TestDictionaryRevokeLifecycle(t *testing.T)`
- `func assertResourceTouchRecorded(t *testing.T, db *gorm.DB, resourceID string)`
- `func TestDictionaryMergeBusinessDomain(t *testing.T)`
- `func TestDictionaryMergeApplicationMigratesRelations(t *testing.T)`
- `func TestDictionaryMergePlatformMigratesOwnership(t *testing.T)`
- `func TestDictionaryCloudLifecycle(t *testing.T)`
- `func TestDictionaryCloudMergeMigratesNetworkDomainLabels(t *testing.T)`
- `func boolPtr(v bool) *bool`

### `platform/modules/m07/domain/attributes.go`

- `type Attributes interface`
- `type HostAttributes struct`
- `method (HostAttributes) Category() Category`
- `method (HostAttributes) Validate() error`
- `type DatabaseAttributes struct`
- `method (DatabaseAttributes) Category() Category`
- `method (DatabaseAttributes) Validate() error`
- `type MiddlewareAttributes struct`
- `method (MiddlewareAttributes) Category() Category`
- `method (MiddlewareAttributes) Validate() error`
- `type ApplicationAttributes struct`
- `method (ApplicationAttributes) Category() Category`
- `method (ApplicationAttributes) Validate() error`
- `type GenericTargetAttributes struct`
- `method (GenericTargetAttributes) Category() Category`
- `method (GenericTargetAttributes) Validate() error`
- `type InterfaceServiceAttributes struct`
- `method (InterfaceServiceAttributes) Category() Category`
- `method (InterfaceServiceAttributes) Validate() error`
- `func validateIPv4(field, raw string) error`
- `func validatePort(field string, port int, required bool) error`
- `func validateURL(field, raw string, schemes ...string) error`
- `func isOneOf(value string, allowed ...string) bool`
- `func ValidateCategoryAttributes(category Category, attrs Attributes) error`

### `platform/modules/m07/domain/builtin_fields.go`

- `type FieldValueType = string`
- `type BuiltinField struct`
- `func CategoryLabel(c Category) string`
- `func BuiltinFields(c Category) []BuiltinField`
- `func ownershipFields(withPlatform bool) []BuiltinField`
- `func runtimeFields() []BuiltinField`
- `func hostBuiltinFields() []BuiltinField`
- `func databaseBuiltinFields() []BuiltinField`
- `func middlewareBuiltinFields() []BuiltinField`
- `func applicationBuiltinFields() []BuiltinField`
- `func interfaceServiceBuiltinFields() []BuiltinField`
- `func genericTargetBuiltinFields() []BuiltinField`

### `platform/modules/m07/domain/capability.go`

- `type AttributeValueType = string`
- `method (AttributeValueType) Valid() bool`
- `type AttributeStatus = string`
- `method (AttributeStatus) Valid() bool`
- `type AttributeGroup = string`
- `func ValidAttributeGroups() []AttributeGroup`
- `method (AttributeGroup) Valid() bool`
- `func AttributeGroupLabel(g AttributeGroup) string`
- `type AttributeDefinition struct`
- `method (AttributeDefinition) Validate() error`
- `method (AttributeDefinition) EffectiveStatus() AttributeStatus`
- `method (AttributeDefinition) ValidateValue(raw string) (string, error)`
- `type ResourceAttribute struct`
- `method (*ResourceAttribute) Validate() error`
- `method (ResourceAttribute) String() string`

### `platform/modules/m07/domain/category.go`

- `type Category = string`
- `func AllCategories() []Category`
- `method (Category) Valid() bool`
- `func ParseCategory(raw string) (Category, error)`
- `func CategoryHint() string`
- `method (Category) IsComposed() bool`
- `method (Category) IsStatic() bool`

### `platform/modules/m07/domain/dedup.go`

- `func DedupKey(r *Resource) (string, error)`

### `platform/modules/m07/domain/domain_test.go`

- `func validResource(category Category, attrs Attributes) *Resource`
- `func TestDedupKey(t *testing.T)`
- `func TestResourceValidate(t *testing.T)`
- `func TestParseCategory(t *testing.T)`
- `func TestNewResourceID(t *testing.T)`
- `func mustID(t *testing.T) string`

### `platform/modules/m07/domain/errors.go`

- `type ValidationError struct`
- `method (*ValidationError) Error() string`
- `method (*ValidationError) ErrorKind() apierror.Kind`
- `func newValidationError(field, format string, args ...any) *ValidationError`
- `type NotFoundError struct`
- `method (*NotFoundError) Error() string`
- `method (*NotFoundError) ErrorKind() apierror.Kind`
- `type ConflictError struct`
- `method (*ConflictError) Error() string`
- `method (*ConflictError) ErrorKind() apierror.Kind`
- `type UnsupportedCategoryError struct`
- `method (*UnsupportedCategoryError) Error() string`
- `method (*UnsupportedCategoryError) ErrorKind() apierror.Kind`

### `platform/modules/m07/domain/id.go`

- `func NewResourceID() (string, error)`

### `platform/modules/m07/domain/import.go`

- `type ImportMode = string`
- `type ImportStatus = string`
- `type ImportErrorDetail struct`
- `type ImportRecord struct`

### `platform/modules/m07/domain/label.go`

- `type LabelSource = string`
- `type Label struct`
- `func ValidateLabelKey(key string) error`
- `func ValidateLabelValue(value string) error`
- `method (*Label) Validate() error`
- `func IsWritableCategory(category Category) bool`
- `type ForbiddenError struct`
- `method (*ForbiddenError) Error() string`
- `method (*ForbiddenError) ErrorKind() apierror.Kind`

### `platform/modules/m07/domain/label_template.go`

- `type LabelSourceType = string`
- `method (LabelSourceType) Valid() bool`
- `type LabelMapping struct`
- `type LabelTemplate struct`
- `method (*LabelTemplate) Normalize()`
- `method (*LabelTemplate) Validate() error`
- `type LabelTemplateNotFoundError struct`
- `method (*LabelTemplateNotFoundError) Error() string`
- `method (*LabelTemplateNotFoundError) ErrorKind() apierror.Kind`
- `type LabelTemplateConflictError struct`
- `method (*LabelTemplateConflictError) Error() string`
- `method (*LabelTemplateConflictError) ErrorKind() apierror.Kind`

### `platform/modules/m07/domain/label_template_test.go`

- `func validTemplate() *LabelTemplate`
- `func TestLabelTemplateValidate(t *testing.T)`
- `func TestLabelTemplateNormalize(t *testing.T)`

### `platform/modules/m07/domain/resource.go`

- `type Resource struct`
- `method (*Resource) Validate() error`
- `method (*Resource) validateOwnership() error`
- `method (*Resource) EnsureDedupKey() error`
- `method (*Resource) Normalize()`

### `platform/modules/m07/domain/status.go`

- `type Status = string`
- `method (Status) Valid() bool`
- `type SourceType = string`
- `method (SourceType) Valid() bool`
- `type Environment = string`
- `method (Environment) Valid() bool`

### `platform/modules/m07/dto/attribute.go`

- `type AttributeDefinitionRequest struct`
- `method (AttributeDefinitionRequest) ToDomain() *domain.AttributeDefinition`
- `type AttributeDefinitionResponse struct`
- `func FromAttributeDefinition(def *domain.AttributeDefinition) AttributeDefinitionResponse`
- `type RemoveDefinitionResponse struct`
- `type AttributeValuePayload struct`
- `type ReplaceAttributesRequest struct`
- `type ResourceAttributeResponse struct`
- `func FromResourceAttribute(attr *domain.ResourceAttribute) ResourceAttributeResponse`
- `func formatAttributeTime(t time.Time) string`

### `platform/modules/m07/dto/attributes.go`

- `type HostAttributes struct`
- `method (HostAttributes) ToDomain() domain.HostAttributes`
- `type DatabaseAttributes struct`
- `method (DatabaseAttributes) ToDomain() domain.DatabaseAttributes`
- `type MiddlewareAttributes struct`
- `method (MiddlewareAttributes) ToDomain() domain.MiddlewareAttributes`
- `type ApplicationAttributes struct`
- `method (ApplicationAttributes) ToDomain() domain.ApplicationAttributes`
- `type GenericTargetAttributes struct`
- `method (GenericTargetAttributes) ToDomain() domain.GenericTargetAttributes`
- `type InterfaceServiceAttributes struct`
- `method (InterfaceServiceAttributes) ToDomain() domain.InterfaceServiceAttributes`

### `platform/modules/m07/dto/ci_model.go`

- `type CIModelResponse struct`
- `type BuiltinFieldResponse struct`
- `type AttributeGroupOption struct`
- `type CIModelListResponse struct`
- `func FromBuiltinField(field domain.BuiltinField) BuiltinFieldResponse`
- `func AvailableAttributeGroups() []AttributeGroupOption`
- `func FromCIModel(category domain.Category, label string, builtin []domain.BuiltinField, custom []*domain.AttributeDefinition…`

### `platform/modules/m07/dto/dictionary.go`

- `type BusinessDomain struct`
- `type Application struct`
- `type Platform struct`
- `type DictionaryAuditLog struct`
- `type Cloud struct`
- `type OSOption struct`
- `type AppPlatformRel struct`
- `func FromAppPlatformRel(item *dictionary.AppPlatformRel) AppPlatformRel`
- `func FromBusinessDomains(items []dictionary.BusinessDomain) []BusinessDomain`
- `func FromBusinessDomain(item *dictionary.BusinessDomain) BusinessDomain`
- `func fromBusinessDomain(item dictionary.BusinessDomain) BusinessDomain`
- `func FromApplications(items []dictionary.Application) []Application`
- `func FromApplication(item *dictionary.Application) Application`
- `func fromApplication(item dictionary.Application) Application`
- `func FromPlatforms(items []dictionary.Platform) []Platform`
- `func FromPlatform(item *dictionary.Platform) Platform`
- `func fromPlatform(item dictionary.Platform) Platform`
- `func FromDictionaryAuditLogs(items []dictionary.DictionaryAuditLog) []DictionaryAuditLog`
- `func FromClouds(items []dictionary.Cloud) []Cloud`
- `func FromCloud(item *dictionary.Cloud) Cloud`
- `func fromCloud(item dictionary.Cloud) Cloud`
- `func FromOSOptions(items []dictionary.OSOption) []OSOption`
- `func FromAppPlatformRels(items []dictionary.AppPlatformRel) []AppPlatformRel`

### `platform/modules/m07/dto/import.go`

- `type ImportError struct`
- `type ImportRecord struct`
- `func FromImportRecord(record *domain.ImportRecord) ImportRecord`
- `func FromImportRecords(records []*domain.ImportRecord) []ImportRecord`

### `platform/modules/m07/dto/label.go`

- `type Label struct`
- `type CreateLabelRequest struct`
- `type UpdateLabelRequest struct`
- `func FromLabels(items []domain.Label) []Label`
- `func FromLabel(item *domain.Label) Label`

### `platform/modules/m07/dto/label_template.go`

- `type LabelTemplateRequest struct`
- `method (LabelTemplateRequest) ToDomain() *domain.LabelTemplate`
- `type LabelTemplateResponse struct`
- `func FromLabelTemplate(item *domain.LabelTemplate) LabelTemplateResponse`
- `func FromLabelTemplates(items []*domain.LabelTemplate) []LabelTemplateResponse`

### `platform/modules/m07/dto/references.go`

- `type JobReference struct`
- `type ReferencesResponse struct`

### `platform/modules/m07/dto/resource.go`

- `type CreateResourceRequest struct`
- `type UpdateResourceRequest struct`
- `method (CreateResourceRequest) ToDomain() (*domain.Resource, error)`
- `method (UpdateResourceRequest) ToDomain() (*domain.Resource, error)`
- `func DecodeAttributes(category domain.Category, raw json.RawMessage) (domain.Attributes, error)`
- `type ListResponse struct`
- `type BulkReassignRequest struct`
- `type BulkReassignFailure struct`
- `type BulkReassignResponse struct`
- `type BulkScrapePortRequest struct`
- `type BulkScrapePortResponse struct`
- `type BulkReassignFailureResponse struct`
- `type ResourceResponse struct`
- `func FromDomain(r *domain.Resource) ResourceResponse`
- `func attributesToDTO(attrs domain.Attributes) any`

### `platform/modules/m07/dto/resource_test.go`

- `func TestCreateResourceRequestToDomain(t *testing.T)`
- `func TestDecodeAttributesRejectsUnknownCategory(t *testing.T)`
- `func TestFromDomainMapsAttributes(t *testing.T)`

### `platform/modules/m07/handler/attribute_handler.go`

- `type AttributeHandler struct`
- `func NewAttributeHandler(svc *service.AttributeService, ciModel *service.CIModelService) *AttributeHandler`
- `method (*AttributeHandler) ListDefinitions(c *gin.Context)`
- `method (*AttributeHandler) ListModels(c *gin.Context)`
- `method (*AttributeHandler) GetModel(c *gin.Context)`
- `method (*AttributeHandler) CreateDefinition(c *gin.Context)`
- `method (*AttributeHandler) UpdateDefinition(c *gin.Context)`
- `method (*AttributeHandler) RemoveDefinition(c *gin.Context)`
- `method (*AttributeHandler) ListResourceAttributes(c *gin.Context)`
- `method (*AttributeHandler) ReplaceResourceAttributes(c *gin.Context)`

### `platform/modules/m07/handler/attribute_test.go`

- `func TestAttributeDefinitionAndResourceValues(t *testing.T)`
- `func TestCIModelBuiltinAndCustomFields(t *testing.T)`
- `func ciModelOf(t *testing.T, list []any, category string) map[string]any`

### `platform/modules/m07/handler/dictionary_handler.go`

- `type DictionaryHandler struct`
- `func NewDictionaryHandler(svc *dictionary.Service) *DictionaryHandler`
- `method (*DictionaryHandler) ListBusinessDomains(c *gin.Context)`
- `type createBusinessDomainRequest struct`
- `method (*DictionaryHandler) CreateBusinessDomain(c *gin.Context)`
- `type updateBusinessDomainRequest struct`
- `method (*DictionaryHandler) UpdateBusinessDomain(c *gin.Context)`
- `method (*DictionaryHandler) ListApplications(c *gin.Context)`
- `type createApplicationRequest struct`
- `method (*DictionaryHandler) CreateApplication(c *gin.Context)`
- `type updateApplicationRequest struct`
- `method (*DictionaryHandler) UpdateApplication(c *gin.Context)`
- `method (*DictionaryHandler) ListPlatforms(c *gin.Context)`
- `type createPlatformRequest struct`
- `method (*DictionaryHandler) CreatePlatform(c *gin.Context)`
- `type updatePlatformRequest struct`
- `method (*DictionaryHandler) UpdatePlatform(c *gin.Context)`
- `method (*DictionaryHandler) ListClouds(c *gin.Context)`
- `method (*DictionaryHandler) ListOSOptions(c *gin.Context)`
- `method (*DictionaryHandler) ListAppPlatformRels(c *gin.Context)`
- `type createAppPlatformRelRequest struct`
- `method (*DictionaryHandler) CreateAppPlatformRel(c *gin.Context)`
- `type updateAppPlatformRelRequest struct`
- `method (*DictionaryHandler) UpdateAppPlatformRel(c *gin.Context)`
- `method (*DictionaryHandler) DeleteAppPlatformRel(c *gin.Context)`
- `method (*DictionaryHandler) RevokeBusinessDomain(c *gin.Context)`
- `method (*DictionaryHandler) RevokeApplication(c *gin.Context)`
- `method (*DictionaryHandler) RevokePlatform(c *gin.Context)`
- `type mergeDictionaryRequest struct`
- `method (*DictionaryHandler) MergeBusinessDomain(c *gin.Context)`
- `method (*DictionaryHandler) MergeApplication(c *gin.Context)`
- `method (*DictionaryHandler) MergePlatform(c *gin.Context)`
- `method (*DictionaryHandler) RevokeCloud(c *gin.Context)`
- `method (*DictionaryHandler) MergeCloud(c *gin.Context)`
- `method (*DictionaryHandler) ListDictionaryAuditLogs(c *gin.Context)`
- `func dictionaryOperator(c *gin.Context) string`
- `func respondDictionaryError(c *gin.Context, err error)`

### `platform/modules/m07/handler/errors.go`

- `func respondError(c *gin.Context, err error)`

### `platform/modules/m07/handler/golden_test.go`

- `func normalizeResourcePayload(t *testing.T, data map[string]any) map[string]any`
- `func TestV3GoldenResource(t *testing.T)`
- `func TestV3GoldenList(t *testing.T)`
- `func TestV3GoldenError(t *testing.T)`

### `platform/modules/m07/handler/import_handler.go`

- `type ImportHandler struct`
- `func NewImportHandler(svc *service.ImportService) *ImportHandler`
- `method (*ImportHandler) Import(c *gin.Context)`
- `method (*ImportHandler) List(c *gin.Context)`
- `method (*ImportHandler) Get(c *gin.Context)`
- `method (*ImportHandler) DownloadTemplate(c *gin.Context)`
- `func buildTemplateWorkbook(columns []string) ([]byte, error)`

### `platform/modules/m07/handler/label_handler.go`

- `type LabelHandler struct`
- `func NewLabelHandler(svc *service.LabelService) *LabelHandler`
- `method (*LabelHandler) List(c *gin.Context)`
- `method (*LabelHandler) Create(c *gin.Context)`
- `method (*LabelHandler) Update(c *gin.Context)`
- `method (*LabelHandler) Delete(c *gin.Context)`

### `platform/modules/m07/handler/label_template_handler.go`

- `type LabelTemplateHandler struct`
- `func NewLabelTemplateHandler(svc *service.LabelTemplateService) *LabelTemplateHandler`
- `method (*LabelTemplateHandler) List(c *gin.Context)`
- `method (*LabelTemplateHandler) Create(c *gin.Context)`
- `method (*LabelTemplateHandler) Get(c *gin.Context)`
- `method (*LabelTemplateHandler) Update(c *gin.Context)`
- `method (*LabelTemplateHandler) Delete(c *gin.Context)`
- `func boolQuery(c *gin.Context, key string) *bool`

### `platform/modules/m07/handler/label_template_test.go`

- `func TestLabelTemplateCRUD(t *testing.T)`

### `platform/modules/m07/handler/resource_handler.go`

- `type ResourceHandler struct`
- `func NewResourceHandler(svc *service.ResourceService, refs references.Reader) *ResourceHandler`
- `method (*ResourceHandler) List(c *gin.Context)`
- `method (*ResourceHandler) Get(c *gin.Context)`
- `method (*ResourceHandler) Create(c *gin.Context)`
- `method (*ResourceHandler) Update(c *gin.Context)`
- `method (*ResourceHandler) Delete(c *gin.Context)`
- `method (*ResourceHandler) References(c *gin.Context)`
- `method (*ResourceHandler) BulkReassign(c *gin.Context)`
- `method (*ResourceHandler) BulkSetScrapePort(c *gin.Context)`
- `func parsePagination(c *gin.Context) (int, int)`

### `platform/modules/m07/handler/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, resources *ResourceHandler, dictionaries *DictionaryHandler, labels *LabelHan…`

### `platform/modules/m07/handler/routes_test.go`

- `func newTestRouter(t *testing.T) (*gin.Engine, *gorm.DB)`
- `func doJSON(t *testing.T, router *gin.Engine, method, path, body string) (int, map[string]any)`
- `func TestV3ResourceAndLabelRoutes(t *testing.T)`
- `func TestV3ImportRoute(t *testing.T)`
- `func buildImportXLSX(t *testing.T) []byte`
- `func TestV3ResourceValidation(t *testing.T)`
- `func TestV3DictionaryWriteLifecycle(t *testing.T)`
- `func TestV3CloudDictReadView(t *testing.T)`
- `func TestV3ImportTemplateXLSX(t *testing.T)`
- `func TestV3DictionaryLifecycleRoutes(t *testing.T)`
- `func TestV3CloudLifecycleRoutes(t *testing.T)`
- `func TestV3BulkReassignRoute(t *testing.T)`

### `platform/modules/m07/importer/capability_test.go`

- `func TestParseExcelAcceptsLegacyHostHeader(t *testing.T)`
- `func TestParseExcelCarriesCapabilityColumns(t *testing.T)`
- `func TestParseExcelRejectsIllegalBoolean(t *testing.T)`
- `func TestParseExcelRejectsMalformedAttributes(t *testing.T)`

### `platform/modules/m07/importer/declare.go`

- `type DeclareEntry struct`
- `type DeclareSheets struct`
- `method (*DeclareSheets) Empty() bool`
- `func ParseDeclareSheets(fileBytes []byte) (*DeclareSheets, error)`
- `func parseDeclareSheet(f *excelize.File, sheet, codeHeader, nameHeader string) ([]DeclareEntry, error)`
- `func ValidateDeclarations(sheets *DeclareSheets) error`
- `func validateDeclareEntries(sheet string, entries []DeclareEntry) error`
- `func sheetExists(f *excelize.File, name string) bool`
- `func cellAt(cells []string, idx int) string`

### `platform/modules/m07/importer/excel.go`

- `type Row struct`
- `func ParseExcel(fileBytes []byte, category domain.Category) ([]Row, error)`
- `func validateHeader(header, expected []string) error`
- `func applyCells(row *Row, header, cells []string)`
- `func parseBoolCell(raw string) (bool, error)`
- `func parsePort(raw string) (int, string)`
- `func trimCells(cells []string) []string`
- `func allEmpty(cells []string) bool`

### `platform/modules/m07/importer/importer_test.go`

- `func setRows(t *testing.T, f *excelize.File, sheet string, rows [][]any)`
- `func buildXLSX(t *testing.T, sheet string, rows [][]any) []byte`
- `func TestParseExcelAndValidateRows(t *testing.T)`
- `func TestValidateRowsRequiresNetworkDomain(t *testing.T)`
- `func TestParseDeclareSheets(t *testing.T)`

### `platform/modules/m07/importer/row.go`

- `type ImportRowError struct`
- `method (*ImportRowError) Error() string`
- `method (Row) ToDomain() (*domain.Resource, error)`
- `method (Row) AttributePairs() (map[string]string, error)`
- `method (Row) attributes() (domain.Attributes, error)`
- `func MapStatus(raw string) (domain.Status, error)`
- `func parseOptionalTime(raw string) (*time.Time, error)`
- `func fieldFromError(err error) string`

### `platform/modules/m07/importer/template.go`

- `func ColumnsFor(category domain.Category) ([]string, bool)`

### `platform/modules/m07/importer/validate.go`

- `type ValidatedRow struct`
- `func ValidateRows(rows []Row) ([]ValidatedRow, []domain.ImportErrorDetail)`
- `func rowErrorDetail(row Row, err error) domain.ImportErrorDetail`

### `platform/modules/m07/module.go`

- `type Options struct`
- `type Module struct`
- `func NewModule(db *gorm.DB, opts Options) (*Module, error)`
- `method (*Module) Name() string`
- `method (*Module) RegisterRoutes(platform *gin.RouterGroup) error`

### `platform/modules/m07/references/change_notifier.go`

- `type ResourceChangeNotifier interface`
- `type NoopChangeNotifier struct`
- `method (NoopChangeNotifier) ResourceChanged(context.Context, ...string)`
- `method (NoopChangeNotifier) AllResourcesChanged(context.Context)`

### `platform/modules/m07/references/label_template_usage.go`

- `type LabelTemplateUsageChecker interface`
- `type NoopLabelTemplateUsageChecker struct`
- `method (NoopLabelTemplateUsageChecker) CountReferences(context.Context, string) (int64, error)`

### `platform/modules/m07/references/reader.go`

- `type JobReference struct`
- `type Reader interface`
- `type GORMReader struct`
- `func NewGORMReader(db *gorm.DB) *GORMReader`
- `type scrapeJobRecord struct`
- `method (scrapeJobRecord) TableName() string`
- `method (*GORMReader) ListByResource(ctx context.Context, resourceID string) ([]JobReference, error)`
- `func contains(values []string, target string) bool`

### `platform/modules/m07/references/reader_test.go`

- `func TestGORMReaderListByResource(t *testing.T)`

### `platform/modules/m07/repository/attribute_repository.go`

- `type attributeDefinitionRecord struct`
- `method (attributeDefinitionRecord) TableName() string`
- `method (attributeDefinitionRecord) toDomain() *domain.AttributeDefinition`
- `func attributeDefinitionFromDomain(def *domain.AttributeDefinition) attributeDefinitionRecord`
- `type resourceAttributeRecord struct`
- `method (resourceAttributeRecord) TableName() string`
- `method (resourceAttributeRecord) toDomain() *domain.ResourceAttribute`
- `type AttributeDefinitionRepository interface`
- `type GORMAttributeDefinitionRepository struct`
- `func NewAttributeDefinitionRepository(db *gorm.DB) *GORMAttributeDefinitionRepository`
- `method (*GORMAttributeDefinitionRepository) List(ctx context.Context, category domain.Category, statuses ...domain.AttributeSt…`
- `method (*GORMAttributeDefinitionRepository) Get(ctx context.Context, id string) (*domain.AttributeDefinition, error)`
- `method (*GORMAttributeDefinitionRepository) FindByKey(ctx context.Context, category domain.Category, key string) (*domain.Attr…`
- `method (*GORMAttributeDefinitionRepository) Create(ctx context.Context, def *domain.AttributeDefinition) error`
- `method (*GORMAttributeDefinitionRepository) Update(ctx context.Context, def *domain.AttributeDefinition) error`
- `method (*GORMAttributeDefinitionRepository) SoftDelete(ctx context.Context, id string) error`
- `method (*GORMAttributeDefinitionRepository) CountResourceValues(ctx context.Context, key string) (int64, error)`
- `type ResourceAttributeRepository interface`
- `type GORMResourceAttributeRepository struct`
- `func NewResourceAttributeRepository(db *gorm.DB) *GORMResourceAttributeRepository`
- `method (*GORMResourceAttributeRepository) ListByResource(ctx context.Context, resourceID string) ([]*domain.ResourceAttribute,…`
- `method (*GORMResourceAttributeRepository) Replace(ctx context.Context, resourceID string, attrs []*domain.ResourceAttribute) e…`
- `func mapAttributeWriteError(err error) error`
- `func nonNilStrings(values []string) []string`

### `platform/modules/m07/repository/concurrency_test.go`

- `func TestConcurrentCreateSameDedupKey(t *testing.T)`
- `func TestCreateRollsBackWhenExtensionFails(t *testing.T)`

### `platform/modules/m07/repository/import_repository.go`

- `type importRecordRecord struct`
- `method (importRecordRecord) TableName() string`
- `type ImportRepository interface`
- `type GORMImportRepository struct`
- `func NewGORMImportRepository(db *gorm.DB) *GORMImportRepository`
- `method (*GORMImportRepository) Create(ctx context.Context, record *domain.ImportRecord) error`
- `method (*GORMImportRepository) List(ctx context.Context, category, status string) ([]*domain.ImportRecord, error)`
- `method (*GORMImportRepository) Get(ctx context.Context, importID string) (*domain.ImportRecord, error)`
- `func toDomainImportRecord(rec *importRecordRecord) *domain.ImportRecord`

### `platform/modules/m07/repository/label_repository.go`

- `type resourceLabelRecord struct`
- `method (resourceLabelRecord) TableName() string`
- `type LabelRepository interface`
- `type GORMLabelRepository struct`
- `func NewGORMLabelRepository(db *gorm.DB) *GORMLabelRepository`
- `method (*GORMLabelRepository) List(ctx context.Context, resourceID string) ([]domain.Label, error)`
- `method (*GORMLabelRepository) Create(ctx context.Context, label *domain.Label) error`
- `method (*GORMLabelRepository) Update(ctx context.Context, resourceID, labelID, value string) (*domain.Label, error)`
- `method (*GORMLabelRepository) Delete(ctx context.Context, resourceID, labelID string) error`
- `func toDomainLabel(rec *resourceLabelRecord) domain.Label`

### `platform/modules/m07/repository/label_repository_test.go`

- `func TestLabelRepositoryCRUD(t *testing.T)`

### `platform/modules/m07/repository/label_template_repository.go`

- `type LabelTemplateFilter struct`
- `type LabelTemplateRepository interface`
- `type labelTemplateRecord struct`
- `method (labelTemplateRecord) TableName() string`
- `method (labelTemplateRecord) toDomain() *domain.LabelTemplate`
- `func labelTemplateFromDomain(t *domain.LabelTemplate) labelTemplateRecord`
- `type GORMLabelTemplateRepository struct`
- `func NewLabelTemplateRepository(db *gorm.DB) *GORMLabelTemplateRepository`
- `method (*GORMLabelTemplateRepository) Create(ctx context.Context, template *domain.LabelTemplate) error`
- `method (*GORMLabelTemplateRepository) Get(ctx context.Context, id string) (*domain.LabelTemplate, error)`
- `method (*GORMLabelTemplateRepository) List(ctx context.Context, filter LabelTemplateFilter) ([]*domain.LabelTemplate, int64, e…`
- `method (*GORMLabelTemplateRepository) Update(ctx context.Context, template *domain.LabelTemplate) error`
- `method (*GORMLabelTemplateRepository) SoftDelete(ctx context.Context, id string) error`
- `method (*GORMLabelTemplateRepository) ClearDefault(ctx context.Context, category domain.Category, excludeID string) error`
- `func labelTemplateWriteError(err error, name, category string) error`

### `platform/modules/m07/repository/mapping.go`

- `func stringPtr(value string) *string`
- `func derefString(value *string) string`
- `func toResourceRecord(r *domain.Resource) *resourceRecord`
- `func toExtensionRecord(category domain.Category, resourceID string, attrs domain.Attributes) (any, error)`
- `func fromResourceRecord(base *resourceRecord, ext any) (*domain.Resource, error)`

### `platform/modules/m07/repository/models.go`

- `type resourceRecord struct`
- `method (resourceRecord) TableName() string`
- `type hostRecord struct`
- `method (hostRecord) TableName() string`
- `type databaseRecord struct`
- `method (databaseRecord) TableName() string`
- `type middlewareRecord struct`
- `method (middlewareRecord) TableName() string`
- `type applicationRecord struct`
- `method (applicationRecord) TableName() string`
- `type genericTargetRecord struct`
- `method (genericTargetRecord) TableName() string`
- `type interfaceServiceRecord struct`
- `method (interfaceServiceRecord) TableName() string`

### `platform/modules/m07/repository/repository.go`

- `type ListFilter struct`
- `type ResourceRepository interface`
- `type BulkReassignInput struct`
- `type GORMRepository struct`
- `func NewGORMRepository(db *gorm.DB) *GORMRepository`

### `platform/modules/m07/repository/resource_repository.go`

- `method (*GORMRepository) Create(ctx context.Context, resource *domain.Resource) error`
- `method (*GORMRepository) Get(ctx context.Context, resourceID string) (*domain.Resource, error)`
- `method (*GORMRepository) GetMany(ctx context.Context, resourceIDs []string) ([]*domain.Resource, error)`
- `func normalizeResourceIDs(resourceIDs []string) []string`
- `method (*GORMRepository) List(ctx context.Context, filter ListFilter) ([]*domain.Resource, int64, error)`
- `method (*GORMRepository) Update(ctx context.Context, resource *domain.Resource) error`
- `method (*GORMRepository) BulkSetScrapePort(ctx context.Context, resourceIDs []string, scrapePort int) (int64, error)`
- `method (*GORMRepository) SoftDelete(ctx context.Context, resourceID string) error`
- `method (*GORMRepository) BulkReassign(ctx context.Context, input BulkReassignInput) (int64, error)`
- `method (*GORMRepository) FindByDedupKey(ctx context.Context, tenantID string, category domain.Category, dedupKey string) (*dom…`
- `method (*GORMRepository) findBase(ctx context.Context, resourceID string) (*resourceRecord, error)`
- `method (*GORMRepository) loadExtension(ctx context.Context, category domain.Category, resourceID string) (any, error)`
- `func loadOne(ctx context.Context, db *gorm.DB, dest any, resourceID string) (any, error)`
- `method (*GORMRepository) loadExtensions(ctx context.Context, category domain.Category, ids []string) (map[string]any, error)`
- `method (*GORMRepository) keywordSubquery(ctx context.Context, category domain.Category, keyword string) *gorm.DB`
- `func normalizePage(page, pageSize int) (int, int)`
- `func nullable(value string) any`
- `func mapWriteError(err error, dedupKey string) error`

### `platform/modules/m07/repository/resource_repository_test.go`

- `func openRepositoryTestDB(t *testing.T) *gorm.DB`
- `func newHost(id, ip, hostname string) *domain.Resource`
- `func TestRepositoryCreateGetListUpdateDelete(t *testing.T)`
- `func TestRepositoryDedupConflict(t *testing.T)`
- `func TestRepositoryDedupIsTenantScoped(t *testing.T)`
- `func TestRepositoryApplicationAttributes(t *testing.T)`

### `platform/modules/m07/service/attribute_service.go`

- `type AttributeService struct`
- `func NewAttributeService( defs repository.AttributeDefinitionRepository, attrs repository.ResourceAttributeRepository, resou…`
- `type RemoveResult struct`
- `method (*AttributeService) ListDefinitions(ctx context.Context, category domain.Category, statuses ...domain.AttributeStatus) …`
- `method (*AttributeService) CreateDefinition(ctx context.Context, def *domain.AttributeDefinition) (*domain.AttributeDefinition…`
- `func applyAttributeDefaults(def *domain.AttributeDefinition)`
- `method (*AttributeService) UpdateDefinition(ctx context.Context, id string, patch *domain.AttributeDefinition, _ *bool) (*doma…`
- `method (*AttributeService) RemoveDefinition(ctx context.Context, id string) (*RemoveResult, error)`
- `method (*AttributeService) ListResourceAttributes(ctx context.Context, resourceID string) ([]*domain.ResourceAttribute, error)`
- `type AttributeValue struct`
- `method (*AttributeService) ReplaceResourceAttributes(ctx context.Context, resourceID string, values []AttributeValue) ([]*doma…`

### `platform/modules/m07/service/attribute_service_test.go`

- `func newAttributeService(t *testing.T) (*AttributeService, *gorm.DB)`
- `func TestCreateAttributeDefinitionNeedsNoSchemaChange(t *testing.T)`
- `func TestAttributeDefinitionValidatesTypeAndOptions(t *testing.T)`
- `func TestReplaceResourceAttributesValidatesValues(t *testing.T)`
- `func TestDeleteAttributeDefinitionBlockedWhileUsed(t *testing.T)`
- `func TestAttributeDefinitionGroupAndOrder(t *testing.T)`

### `platform/modules/m07/service/ci_model_service.go`

- `type CIModel struct`
- `type CIModelService struct`
- `func NewCIModelService(defs repository.AttributeDefinitionRepository) *CIModelService`
- `method (*CIModelService) List(ctx context.Context) ([]*CIModel, error)`
- `method (*CIModelService) Get(ctx context.Context, category domain.Category) (*CIModel, error)`

### `platform/modules/m07/service/import_capability_test.go`

- `func buildCapabilityXLSX(t *testing.T, ip, attributes string) []byte`
- `func newCapabilityImportService(t *testing.T) (*ImportService, *gorm.DB, *repository.GORMRepository)`
- `func TestImportPersistsCapabilityFlagsAndAttributes(t *testing.T)`
- `func TestImportRejectsUnregisteredAttributeKey(t *testing.T)`
- `func TestImportRejectsRemovedAttributeKey(t *testing.T)`

### `platform/modules/m07/service/import_service.go`

- `type ImportService struct`
- `func NewImportService(resources repository.ResourceRepository, imports repository.ImportRepository, dict DictionaryResolver,…`
- `method (*ImportService) SetChangeNotifier(notifier references.ResourceChangeNotifier)`
- `method (*ImportService) SetAttributeWriter(defs repository.AttributeDefinitionRepository, store repository.ResourceAttributeRe…`
- `method (*ImportService) Import(ctx context.Context, category domain.Category, mode domain.ImportMode, fileBytes []byte, operat…`
- `method (*ImportService) List(ctx context.Context, category, status string) ([]*domain.ImportRecord, error)`
- `method (*ImportService) Get(ctx context.Context, importID string) (*domain.ImportRecord, error)`
- `method (*ImportService) resolvePlatform(ctx context.Context, resource *domain.Resource) error`
- `func importDetail(rowNumber int, resource *domain.Resource, field string, err error) domain.ImportErrorDetail`
- `func toDeclared(entries []importer.DeclareEntry) []dictionary.DeclaredEntry`
- `func newImportNo() string`
- `method (*ImportService) validateImportAttributes(ctx context.Context, category domain.Category, pairs map[string]string) ([]*d…`
- `method (*ImportService) mergeImportAttributes(ctx context.Context, resourceID string, incoming []*domain.ResourceAttribute) er…`
- `func formatAttributePairs(pairs map[string]string) string`

### `platform/modules/m07/service/import_service_test.go`

- `type fakeImportRepository struct`
- `method (*fakeImportRepository) Create(_ context.Context, record *domain.ImportRecord) error`
- `method (*fakeImportRepository) List(_ context.Context, _, _ string) ([]*domain.ImportRecord, error)`
- `method (*fakeImportRepository) Get(_ context.Context, importID string) (*domain.ImportRecord, error)`
- `func buildHostXLSX(t *testing.T, ip, status string) []byte`
- `func TestImportServiceCreateOnlyAndDuplicate(t *testing.T)`
- `func TestImportServiceUpsert(t *testing.T)`
- `func TestImportNotifiesAllDomains(t *testing.T)`

### `platform/modules/m07/service/label_service.go`

- `type LabelService struct`
- `func NewLabelService(labels repository.LabelRepository, resources repository.ResourceRepository) *LabelService`
- `method (*LabelService) SetChangeNotifier(notifier references.ResourceChangeNotifier)`
- `method (*LabelService) List(ctx context.Context, resourceID string) ([]domain.Label, error)`
- `method (*LabelService) Add(ctx context.Context, resourceID, key, value string) (*domain.Label, error)`
- `method (*LabelService) Update(ctx context.Context, resourceID, labelID, value string) (*domain.Label, error)`
- `method (*LabelService) Delete(ctx context.Context, resourceID, labelID string) error`
- `method (*LabelService) notify(ctx context.Context, domainID string)`
- `method (*LabelService) writableResource(ctx context.Context, resourceID string) (*domain.Resource, error)`

### `platform/modules/m07/service/label_service_test.go`

- `type fakeLabelRepository struct`
- `func newFakeLabelRepository() *fakeLabelRepository`
- `method (*fakeLabelRepository) List(_ context.Context, resourceID string) ([]domain.Label, error)`
- `method (*fakeLabelRepository) Create(_ context.Context, label *domain.Label) error`
- `method (*fakeLabelRepository) Update(_ context.Context, resourceID, labelID, value string) (*domain.Label, error)`
- `method (*fakeLabelRepository) Delete(_ context.Context, resourceID, labelID string) error`
- `func TestLabelServicePolicy(t *testing.T)`

### `platform/modules/m07/service/label_template_service.go`

- `type LabelTemplateService struct`
- `func NewLabelTemplateService(repo repository.LabelTemplateRepository, usage references.LabelTemplateUsageChecker) *LabelTemp…`
- `method (*LabelTemplateService) SetChangeNotifier(notifier references.ResourceChangeNotifier)`
- `method (*LabelTemplateService) notifyAll(ctx context.Context)`
- `method (*LabelTemplateService) List(ctx context.Context, filter repository.LabelTemplateFilter) ([]*domain.LabelTemplate, int6…`
- `method (*LabelTemplateService) Get(ctx context.Context, id string) (*domain.LabelTemplate, error)`
- `method (*LabelTemplateService) Create(ctx context.Context, template *domain.LabelTemplate) (*domain.LabelTemplate, error)`
- `method (*LabelTemplateService) Update(ctx context.Context, id string, input *domain.LabelTemplate) (*domain.LabelTemplate, err…`
- `method (*LabelTemplateService) Delete(ctx context.Context, id string) error`

### `platform/modules/m07/service/label_template_service_test.go`

- `type fixedUsageChecker struct`
- `method (fixedUsageChecker) CountReferences(context.Context, string) (int64, error)`
- `func newLabelTemplateService(t *testing.T, usage fixedUsageChecker) (*LabelTemplateService, *gorm.DB)`
- `func TestLabelTemplateDeleteGuardsReferences(t *testing.T)`
- `func TestLabelTemplateDeleteUnreferenced(t *testing.T)`
- `func TestLabelTemplateDefaultIsExclusive(t *testing.T)`
- `func TestLabelTemplateWritesNotifyAllDomains(t *testing.T)`

### `platform/modules/m07/service/platform_resolver.go`

- `func resolvePlatformFor(ctx context.Context, resolver DictionaryResolver, resource *domain.Resource) error`

### `platform/modules/m07/service/resource_service.go`

- `type DictionaryResolver interface`
- `type ResourceService struct`
- `func NewResourceService(repo repository.ResourceRepository, dict DictionaryResolver) *ResourceService`
- `method (*ResourceService) SetChangeNotifier(notifier references.ResourceChangeNotifier)`
- `method (*ResourceService) List(ctx context.Context, filter repository.ListFilter) ([]*domain.Resource, int64, error)`
- `method (*ResourceService) Get(ctx context.Context, resourceID string) (*domain.Resource, error)`
- `method (*ResourceService) Create(ctx context.Context, resource *domain.Resource) (*domain.Resource, error)`
- `method (*ResourceService) Update(ctx context.Context, resourceID string, input *domain.Resource) (*domain.Resource, error)`
- `method (*ResourceService) Delete(ctx context.Context, resourceID string) error`
- `type BulkReassignFailure struct`
- `type BulkReassignError struct`
- `method (*BulkReassignError) Error() string`
- `type BulkReassignResult struct`
- `method (*ResourceService) BulkSetScrapePort(ctx context.Context, resourceIDs []string, scrapePort int) (int64, error)`
- `method (*ResourceService) BulkReassign(ctx context.Context, resourceIDs []string, field, targetCode string) (*BulkReassignResu…`
- `func normalizeBulkReassignIDs(resourceIDs []string) []string`
- `method (*ResourceService) notifyDomains(ctx context.Context, domainIDs ...string)`
- `method (*ResourceService) notifyAll(ctx context.Context)`
- `method (*ResourceService) resolvePlatform(ctx context.Context, resource *domain.Resource) error`

### `platform/modules/m07/service/resource_service_test.go`

- `type fakeRepository struct`
- `func newFakeRepository() *fakeRepository`
- `method (*fakeRepository) Create(_ context.Context, resource *domain.Resource) error`
- `method (*fakeRepository) Get(_ context.Context, resourceID string) (*domain.Resource, error)`
- `method (*fakeRepository) List(_ context.Context, _ repository.ListFilter) ([]*domain.Resource, int64, error)`
- `method (*fakeRepository) Update(_ context.Context, resource *domain.Resource) error`
- `method (*fakeRepository) SoftDelete(_ context.Context, resourceID string) error`
- `method (*fakeRepository) FindByDedupKey(_ context.Context, _ string, category domain.Category, dedupKey string) (*domain.Resou…`
- `method (*fakeRepository) GetMany(_ context.Context, resourceIDs []string) ([]*domain.Resource, error)`
- `method (*fakeRepository) BulkReassign(_ context.Context, input repository.BulkReassignInput) (int64, error)`
- `method (*fakeRepository) BulkSetScrapePort(_ context.Context, resourceIDs []string, scrapePort int) (int64, error)`
- `type fakeDictionary struct`
- `method (*fakeDictionary) ValidateResource(_ context.Context, _ *domain.Resource) error`
- `method (*fakeDictionary) ValidateResourceUpdate(_ context.Context, _, _ *domain.Resource) error`
- `method (*fakeDictionary) PrimaryPlatformOfApp(_ context.Context, _ string) (string, bool, error)`
- `method (*fakeDictionary) PlatformBelongsToApp(_ context.Context, appCode, platformCode string) (bool, error)`
- `method (*fakeDictionary) ValidateReferenceTarget(_ context.Context, _, _ string) error`
- `func applicationResource() *domain.Resource`
- `func TestCreateDefaultsAndPlatformFallback(t *testing.T)`
- `func TestCreateConflict(t *testing.T)`
- `func TestUpdatePreservesImmutableFields(t *testing.T)`
- `func TestDeleteNotFound(t *testing.T)`
- `func TestComposedResourceAlwaysDerivesPrimaryPlatform(t *testing.T)`
- `func TestStaticResourceKeepsExplicitPlatform(t *testing.T)`
- `func staticHostResource() *domain.Resource`
- `func TestBulkReassignBizCode(t *testing.T)`
- `func TestBulkReassignRejectsComposedPlatformChange(t *testing.T)`
- `func TestBulkReassignAppCodeDerivesComposedPlatform(t *testing.T)`
- `func TestBulkReassignRejectsUnassociatedStaticPlatform(t *testing.T)`
- `func TestBulkReassignRejectsUnassociatedPlatform(t *testing.T)`
- `func TestBulkReassignValidation(t *testing.T)`
- `type recordedChangeNotifier struct`
- `method (*recordedChangeNotifier) ResourceChanged(_ context.Context, domainIDs ...string)`
- `method (*recordedChangeNotifier) AllResourcesChanged(context.Context)`
- `func TestResourceWritesNotifyConfigSync(t *testing.T)`

### `platform/modules/m08/apply/apply.go`

- `type Reloader interface`
- `type Request struct`
- `type Result struct`
- `type Applier struct`
- `func New(dir string, reloader Reloader, logs repository.ReloadLogRepository) *Applier`
- `method (*Applier) SetClock(now func() time.Time)`
- `method (*Applier) Apply(ctx context.Context, req Request) (Result, error)`
- `method (*Applier) record(ctx context.Context, req Request, result Result, started time.Time)`
- `func sameContent(path, content string) bool`
- `func writeAtomic(path, content string) error`

### `platform/modules/m08/apply/apply_test.go`

- `type fakeReloader struct`
- `method (*fakeReloader) Reload(context.Context) error`
- `method (*fakeReloader) Verify(context.Context) error`
- `type fakeLogs struct`
- `method (*fakeLogs) Insert(_ context.Context, entry *domain.ReloadLog) error`
- `method (*fakeLogs) List(context.Context, repository.ReloadLogFilter) ([]*domain.ReloadLog, int64, error)`
- `func TestApplySucceedsAndWritesAtomically(t *testing.T)`
- `func TestApplySkipsWriteWhenUnchangedButStillReloads(t *testing.T)`
- `func TestApplyRollsBackOnReloadFailure(t *testing.T)`
- `func TestApplyUnconfiguredTargetIsRetryable(t *testing.T)`
- `func TestApplyVerifyFailureTriggersRollback(t *testing.T)`
- `func TestApplyRecordsDurationAndFinishedAt(t *testing.T)`

### `platform/modules/m08/apply/http.go`

- `type HTTPReloader struct`
- `func NewHTTPReloader(base *url.URL) *HTTPReloader`
- `method (*HTTPReloader) Reload(ctx context.Context) error`
- `method (*HTTPReloader) Verify(ctx context.Context) error`
- `method (*HTTPReloader) post(ctx context.Context, path string) error`

### `platform/modules/m08/bridge_url.go`

- `func DeriveBridgeBaseURL(listenAddr string) (string, error)`

### `platform/modules/m08/configgen/configgen.go`

- `type Input struct`
- `type Output struct`
- `func Generate(input Input) (*Output, error)`
- `func NewVersion(now time.Time, suffix string) string`
- `type globalConfig struct`
- `type alertmanagerConfig struct`
- `type routeConfig struct`
- `type inhibitRule struct`
- `type receiverConfig struct`
- `type webhookConfig struct`
- `func toRoute(node domain.RouteNode) *routeConfig`
- `func groupBy(values []string) []string`
- `func renderMatchers(matchers []domain.Matcher) []string`
- `func buildInhibitRules(rules []*domain.InhibitionRule) []inhibitRule`
- `func buildReceivers(base string, referenced map[string]bool, channels map[string]*domain.Channel) []receiverConfig`
- `func orDefault(value, fallback string) string`

### `platform/modules/m08/configgen/configgen_test.go`

- `func baseTree() []domain.RouteNode`
- `func TestGenerateMaterialisesOnlyReferencedChannels(t *testing.T)`
- `func TestGenerateRendersInhibitRules(t *testing.T)`
- `func TestGenerateRejectsUnknownReceiver(t *testing.T)`
- `func TestGenerateRequiresBridgeBaseAndSingleRoot(t *testing.T)`
- `func TestGenerateRendersNegativeMatchers(t *testing.T)`
- `func TestGenerateSkipsDisabledBranches(t *testing.T)`

### `platform/modules/m08/domain/actor.go`

- `type Actor struct`

### `platform/modules/m08/domain/channel.go`

- `type Channel struct`
- `method (Channel) ReceiverName() string`
- `func ValidateChannel(c *Channel, allowPrivate bool) []ValidationIssue`
- `func ValidateWebhookURL(raw string, allowPrivate bool) error`

### `platform/modules/m08/domain/config.go`

- `type Snapshot struct`
- `type ReloadLog struct`
- `type Silence struct`

### `platform/modules/m08/domain/enums.go`

- `type ChannelType = string`
- `func IsIM(t ChannelType) bool`
- `func IsValidChannelType(t ChannelType) bool`
- `type EventStatus = string`
- `func OpenEventStatuses() []string`
- `func IsOpenStatus(s EventStatus) bool`
- `func IsValidEventStatus(s EventStatus) bool`
- `type ReloadTrigger = string`
- `type ReloadStatus = string`
- `type PendingSection = string`
- `type AuditAction = string`
- `type AuditResult = string`

### `platform/modules/m08/domain/errors.go`

- `type ValidationError struct`
- `method (*ValidationError) Error() string`
- `method (*ValidationError) ErrorKind() apierror.Kind`
- `func NewValidationError(field, message string) *ValidationError`
- `type ValidationIssue struct`
- `type ValidationCause = string`
- `type ConfigValidationError struct`
- `method (*ConfigValidationError) Error() string`
- `method (*ConfigValidationError) ErrorKind() apierror.Kind`
- `type NotFoundError struct`
- `method (*NotFoundError) Error() string`
- `method (*NotFoundError) ErrorKind() apierror.Kind`
- `type ConflictError struct`
- `method (*ConflictError) Error() string`
- `method (*ConflictError) ErrorKind() apierror.Kind`
- `type ForbiddenError struct`
- `method (*ForbiddenError) Error() string`
- `method (*ForbiddenError) ErrorKind() apierror.Kind`
- `type UnavailableError struct`
- `method (*UnavailableError) Error() string`
- `method (*UnavailableError) ErrorKind() apierror.Kind`
- `type UpstreamError struct`
- `method (*UpstreamError) Error() string`
- `method (*UpstreamError) Unwrap() error`
- `method (*UpstreamError) ErrorKind() apierror.Kind`

### `platform/modules/m08/domain/event.go`

- `type Event struct`
- `func OccurrenceKey(fingerprint string, startsAt time.Time) string`
- `func ClosedStatus(open EventStatus) EventStatus`
- `func InferredClosedStatus(open EventStatus) EventStatus`
- `func NormalizeStatus(raw string) EventStatus`
- `func DurationSeconds(start time.Time, end *time.Time) *int64`

### `platform/modules/m08/domain/id.go`

- `func NewID() (string, error)`

### `platform/modules/m08/domain/inhibition.go`

- `type InhibitionRule struct`
- `func ValidateInhibition(r *InhibitionRule) []ValidationIssue`

### `platform/modules/m08/domain/matcher.go`

- `type Matcher struct`
- `method (Matcher) IsEqualMatch() bool`
- `method (Matcher) Validate(field string) []ValidationIssue`
- `func ValidateMatchers(field string, matchers []Matcher) []ValidationIssue`

### `platform/modules/m08/domain/route.go`

- `type RouteNode struct`
- `func ValidateRouteTree(nodes []RouteNode, allowedReceivers map[string]bool) []ValidationIssue`
- `func walkRoute(node *RouteNode, path string, depth int, allowed map[string]bool, issues *[]ValidationIssue)`
- `func CollectReceivers(nodes []RouteNode) map[string]bool`

### `platform/modules/m08/domain/route_test.go`

- `func TestValidateRouteTree(t *testing.T)`
- `func TestCollectReceiversSkipsDisabled(t *testing.T)`
- `func TestValidateWebhookURL(t *testing.T)`
- `func TestClosedStatusMapping(t *testing.T)`
- `func TestOccurrenceKeyDedupAcrossPrecision(t *testing.T)`

### `platform/modules/m08/domain/template.go`

- `type Template struct`
- `func TemplateFuncMap() template.FuncMap`
- `func titleCase(s string) string`
- `func isTitleSeparator(r rune) bool`
- `func ValidateTemplate(t *Template) []ValidationIssue`

### `platform/modules/m08/dto/config.go`

- `type ReloadSummary struct`
- `type SnapshotResponse struct`
- `type SnapshotListItem struct`
- `type ReloadLogResponse struct`
- `type RouteTreeResponse struct`
- `type SaveRouteRequest struct`
- `type SaveResult struct`

### `platform/modules/m08/dto/doc.go`

- `func MaskURL(raw string) string`

### `platform/modules/m08/dto/event.go`

- `type EventResponse struct`
- `type EventInstance struct`
- `func FromEvent(event *domain.Event, inst EventInstance, now time.Time) EventResponse`
- `type EventListResponse struct`
- `func idString(id int64) string`
- `func timePtr(t time.Time) *time.Time`

### `platform/modules/m08/dto/inhibition.go`

- `type InhibitionRequest struct`
- `method (InhibitionRequest) ToDomain() *domain.InhibitionRule`
- `type InhibitionResponse struct`
- `func FromInhibition(rule *domain.InhibitionRule) InhibitionResponse`
- `type CreateSilenceRequest struct`
- `type LabelOption struct`
- `type AuditResponse struct`

### `platform/modules/m08/dto/notify.go`

- `type ChannelRequest struct`
- `method (ChannelRequest) ToDomain() *domain.Channel`
- `type ChannelResponse struct`
- `func FromChannel(channel *domain.Channel, referencedByRoutes int) ChannelResponse`
- `type TemplateRequest struct`
- `method (TemplateRequest) ToDomain() *domain.Template`
- `type TemplateResponse struct`
- `func FromTemplate(t *domain.Template, boundChannels int64) TemplateResponse`

### `platform/modules/m08/dto/url.go`

- `func parseURL(raw string) (*url.URL, error)`
- `func firstSegment(path string) string`

### `platform/modules/m08/handler/bridge.go`

- `type BridgeHandler struct`
- `func NewBridgeHandler(notify *service.BridgeService, events *service.EventService) *BridgeHandler`
- `method (*BridgeHandler) Notify(c *gin.Context)`
- `method (*BridgeHandler) AlertsWebhook(c *gin.Context)`

### `platform/modules/m08/handler/config.go`

- `type ConfigHandler struct`
- `func NewConfigHandler(svc *service.ConfigService) *ConfigHandler`
- `method (*ConfigHandler) Current(c *gin.Context)`
- `method (*ConfigHandler) ListVersions(c *gin.Context)`
- `method (*ConfigHandler) GetVersion(c *gin.Context)`
- `method (*ConfigHandler) ReloadLogs(c *gin.Context)`
- `method (*ConfigHandler) Reload(c *gin.Context)`
- `type RouteHandler struct`
- `func NewRouteHandler(svc *service.ConfigService) *RouteHandler`
- `method (*RouteHandler) Get(c *gin.Context)`
- `method (*RouteHandler) Save(c *gin.Context)`
- `func saveResult(outcome *service.SaveOutcome) dto.SaveResult`
- `func timeOrNil(t time.Time) *time.Time`

### `platform/modules/m08/handler/event.go`

- `type EventHandler struct`
- `func NewEventHandler(svc *service.EventService) *EventHandler`
- `method (*EventHandler) List(c *gin.Context)`
- `method (*EventHandler) Current(c *gin.Context)`
- `method (*EventHandler) Stats(c *gin.Context)`
- `func eventsToDTO(views []service.EventView) []dto.EventResponse`
- `type AlertsHandler struct`
- `func NewAlertsHandler(client *service.AMClient) *AlertsHandler`
- `method (*AlertsHandler) List(c *gin.Context)`
- `func notifyStatus(alert service.AMAlert) string`

### `platform/modules/m08/handler/helpers.go`

- `func bindJSON(c *gin.Context, dest any) error`
- `func parsePagination(c *gin.Context) (int, int)`
- `func boolQuery(c *gin.Context, key string) *bool`
- `func respondError(c *gin.Context, err error)`
- `func actorOf(c *gin.Context) domain.Actor`
- `func operatorOf(c *gin.Context) string`
- `func parsePathID(c *gin.Context, name string) (int64, bool)`

### `platform/modules/m08/handler/inhibition.go`

- `type InhibitionHandler struct`
- `func NewInhibitionHandler(svc *service.InhibitionService) *InhibitionHandler`
- `method (*InhibitionHandler) List(c *gin.Context)`
- `method (*InhibitionHandler) Create(c *gin.Context)`
- `method (*InhibitionHandler) Update(c *gin.Context)`
- `method (*InhibitionHandler) SetStatus(c *gin.Context)`
- `method (*InhibitionHandler) Delete(c *gin.Context)`
- `func baseChecksumOf(c *gin.Context) string`

### `platform/modules/m08/handler/notify.go`

- `type ChannelHandler struct`
- `func NewChannelHandler(svc *service.ChannelService) *ChannelHandler`
- `method (*ChannelHandler) List(c *gin.Context)`
- `method (*ChannelHandler) Create(c *gin.Context)`
- `method (*ChannelHandler) Update(c *gin.Context)`
- `method (*ChannelHandler) Delete(c *gin.Context)`
- `type TemplateHandler struct`
- `func NewTemplateHandler(svc *service.TemplateService) *TemplateHandler`
- `method (*TemplateHandler) List(c *gin.Context)`
- `method (*TemplateHandler) Get(c *gin.Context)`
- `method (*TemplateHandler) Create(c *gin.Context)`
- `method (*TemplateHandler) Update(c *gin.Context)`
- `method (*TemplateHandler) Delete(c *gin.Context)`
- `func errRequired(field string) error`

### `platform/modules/m08/handler/routes.go`

- `type Handlers struct`
- `func RegisterRoutes(platform *gin.RouterGroup, h Handlers)`
- `func RegisterWebhookRoutes(platform *gin.RouterGroup, h Handlers)`

### `platform/modules/m08/handler/silence.go`

- `type SilenceHandler struct`
- `func NewSilenceHandler(svc *service.SilenceService) *SilenceHandler`
- `method (*SilenceHandler) List(c *gin.Context)`
- `method (*SilenceHandler) LabelOptions(c *gin.Context)`
- `method (*SilenceHandler) Create(c *gin.Context)`
- `method (*SilenceHandler) Delete(c *gin.Context)`
- `method (*SilenceHandler) Audits(c *gin.Context)`
- `func parseRFC3339(value, field string) (time.Time, error)`
- `func parseOptionalTime(value string) (*time.Time, error)`

### `platform/modules/m08/module.go`

- `type Options struct`
- `type Module struct`
- `func NewModule(db *gorm.DB, opts Options) (*Module, error)`
- `method (*Module) Name() string`
- `method (*Module) RegisterRoutes(platform *gin.RouterGroup) error`
- `method (*Module) RegisterWebhookRoutes(platform *gin.RouterGroup) error`
- `method (*Module) StartBackground(ctx context.Context)`
- `method (*Module) Config() *service.ConfigService`

### `platform/modules/m08/references/domain.go`

- `type DomainAuthorizer interface`
- `type GORMDomainAuthorizer struct`
- `func NewDomainAuthorizer(db *gorm.DB) *GORMDomainAuthorizer`
- `method (*GORMDomainAuthorizer) AuthorizedDomains(ctx context.Context, actor domain.Actor) ([]string, error)`

### `platform/modules/m08/references/resource.go`

- `type ResourceInfo struct`
- `type ResourceNamer interface`
- `type M01ResourceNamer struct`
- `func NewResourceNamer(db *gorm.DB) *M01ResourceNamer`
- `method (*M01ResourceNamer) GetMany(ctx context.Context, resourceIDs []string) (map[string]ResourceInfo, error)`

### `platform/modules/m08/repository/channel.go`

- `type ChannelFilter struct`
- `type ChannelRepository interface`
- `type GORMChannelRepository struct`
- `func NewChannelRepository(db *gorm.DB) *GORMChannelRepository`
- `method (*GORMChannelRepository) Create(ctx context.Context, channel *domain.Channel) error`
- `method (*GORMChannelRepository) Get(ctx context.Context, id string) (*domain.Channel, error)`
- `method (*GORMChannelRepository) List(ctx context.Context, filter ChannelFilter) ([]*domain.Channel, int64, error)`
- `method (*GORMChannelRepository) Update(ctx context.Context, channel *domain.Channel) error`
- `method (*GORMChannelRepository) SoftDelete(ctx context.Context, id string) error`
- `method (*GORMChannelRepository) ListAll(ctx context.Context) ([]*domain.Channel, error)`
- `method (*GORMChannelRepository) CountByTemplate(ctx context.Context, templateID string) (int64, error)`

### `platform/modules/m08/repository/common.go`

- `func mapWriteError(err error, entity, field, value string) error`
- `func isNotFound(err error) bool`
- `func notFound(entity, id string) error`
- `func paginate(q *gorm.DB, page, pageSize int) *gorm.DB`
- `func keywordLike(q *gorm.DB, keyword string, columns ...string) *gorm.DB`
- `func normalizePage(page, pageSize int) (int, int)`

### `platform/modules/m08/repository/event.go`

- `type EventFilter struct`
- `type Stats struct`
- `type EventRepository interface`
- `type GORMEventRepository struct`
- `func NewEventRepository(db *gorm.DB) *GORMEventRepository`
- `method (*GORMEventRepository) FindByOccurrenceKey(ctx context.Context, key string) (*domain.Event, bool, error)`
- `method (*GORMEventRepository) Insert(ctx context.Context, event *domain.Event) error`
- `method (*GORMEventRepository) Update(ctx context.Context, event *domain.Event) error`
- `method (*GORMEventRepository) ListOpen(ctx context.Context, networkDomain string) ([]*domain.Event, error)`
- `method (*GORMEventRepository) List(ctx context.Context, filter EventFilter) ([]*domain.Event, int64, error)`
- `method (*GORMEventRepository) Stats(ctx context.Context, dayStart, dayEnd time.Time, networkDomain string) (Stats, error)`
- `method (*GORMEventRepository) DistinctValues(ctx context.Context, column string) ([]string, error)`
- `method (*GORMEventRepository) PurgeExpired(ctx context.Context, before time.Time) (int64, error)`

### `platform/modules/m08/repository/inhibition.go`

- `type InhibitionFilter struct`
- `type InhibitionRepository interface`
- `type GORMInhibitionRepository struct`
- `func NewInhibitionRepository(db *gorm.DB) *GORMInhibitionRepository`
- `method (*GORMInhibitionRepository) Create(ctx context.Context, rule *domain.InhibitionRule) error`
- `method (*GORMInhibitionRepository) Get(ctx context.Context, id string) (*domain.InhibitionRule, error)`
- `method (*GORMInhibitionRepository) List(ctx context.Context, filter InhibitionFilter) ([]*domain.InhibitionRule, int64, error)`
- `method (*GORMInhibitionRepository) Update(ctx context.Context, rule *domain.InhibitionRule) error`
- `method (*GORMInhibitionRepository) SoftDelete(ctx context.Context, id string) error`
- `method (*GORMInhibitionRepository) ListEnabled(ctx context.Context) ([]*domain.InhibitionRule, error)`
- `type AuditFilter struct`
- `type AuditRepository interface`
- `type AuditEntry struct`
- `type GORMAuditRepository struct`
- `func NewAuditRepository(db *gorm.DB) *GORMAuditRepository`
- `method (*GORMAuditRepository) Insert(ctx context.Context, entry *AuditEntry) error`
- `method (*GORMAuditRepository) List(ctx context.Context, filter AuditFilter) ([]*AuditEntry, int64, error)`

### `platform/modules/m08/repository/models.go`

- `type channelRecord struct`
- `method (channelRecord) TableName() string`
- `func channelFromDomain(c *domain.Channel) *channelRecord`
- `method (*channelRecord) toDomain() *domain.Channel`
- `type templateRecord struct`
- `method (templateRecord) TableName() string`
- `func templateFromDomain(t *domain.Template) *templateRecord`
- `method (*templateRecord) toDomain() *domain.Template`
- `type snapshotRecord struct`
- `method (snapshotRecord) TableName() string`
- `type reloadLogRecord struct`
- `method (reloadLogRecord) TableName() string`
- `type eventRecord struct`
- `method (eventRecord) TableName() string`
- `func eventFromDomain(e *domain.Event) *eventRecord`
- `func nonNilStringMap(m map[string]string) map[string]string`
- `method (*eventRecord) toDomain() *domain.Event`
- `type inhibitionRecord struct`
- `method (inhibitionRecord) TableName() string`
- `func inhibitionFromDomain(r *domain.InhibitionRule) *inhibitionRecord`
- `method (*inhibitionRecord) toDomain() *domain.InhibitionRule`
- `type auditRecord struct`
- `method (auditRecord) TableName() string`

### `platform/modules/m08/repository/reload.go`

- `type ReloadLogFilter struct`
- `type ReloadLogRepository interface`
- `type GORMReloadLogRepository struct`
- `func NewReloadLogRepository(db *gorm.DB) *GORMReloadLogRepository`
- `method (*GORMReloadLogRepository) Insert(ctx context.Context, log *domain.ReloadLog) error`
- `method (*GORMReloadLogRepository) List(ctx context.Context, filter ReloadLogFilter) ([]*domain.ReloadLog, int64, error)`
- `func idString(id int64) string`

### `platform/modules/m08/repository/snapshot.go`

- `type SnapshotRepository interface`
- `type GORMSnapshotRepository struct`
- `func NewSnapshotRepository(db *gorm.DB) *GORMSnapshotRepository`
- `method (*GORMSnapshotRepository) CreateCurrent(ctx context.Context, snapshot *domain.Snapshot, keep int) error`
- `method (*GORMSnapshotRepository) Current(ctx context.Context) (*domain.Snapshot, error)`
- `method (*GORMSnapshotRepository) Get(ctx context.Context, id int64) (*domain.Snapshot, error)`
- `method (*GORMSnapshotRepository) List(ctx context.Context, page, pageSize int) ([]*domain.Snapshot, int64, error)`
- `func snapshotToDomain(rec *snapshotRecord) *domain.Snapshot`

### `platform/modules/m08/repository/template.go`

- `type TemplateFilter struct`
- `type TemplateRepository interface`
- `type GORMTemplateRepository struct`
- `func NewTemplateRepository(db *gorm.DB) *GORMTemplateRepository`
- `method (*GORMTemplateRepository) Create(ctx context.Context, template *domain.Template) error`
- `method (*GORMTemplateRepository) Get(ctx context.Context, id string) (*domain.Template, error)`
- `method (*GORMTemplateRepository) List(ctx context.Context, filter TemplateFilter) ([]*domain.Template, int64, error)`
- `method (*GORMTemplateRepository) Update(ctx context.Context, template *domain.Template) error`
- `method (*GORMTemplateRepository) ListAll(ctx context.Context) ([]*domain.Template, error)`
- `method (*GORMTemplateRepository) SoftDelete(ctx context.Context, id string) error`

### `platform/modules/m08/service/am.go`

- `type AMAlert struct`
- `method (AMAlert) FingerprintKey() string`
- `method (AMAlert) toWebhookAlert() WebhookAlert`
- `type AMClient struct`
- `func NewAMClient(base *url.URL) *AMClient`
- `method (*AMClient) ActiveAlerts(ctx context.Context) ([]AMAlert, error)`
- `method (*AMClient) ListSilences(ctx context.Context) ([]domain.Silence, error)`
- `method (*AMClient) CreateSilence(ctx context.Context, silence domain.Silence) (string, error)`
- `method (*AMClient) DeleteSilence(ctx context.Context, id string) error`
- `func toAMMatchers(matchers []domain.Matcher) []map[string]any`
- `method (*AMClient) getJSON(ctx context.Context, path string, dest any) error`
- `method (*AMClient) postJSON(ctx context.Context, path string, body any, dest any) error`
- `method (*AMClient) resolve(path string) (*url.URL, error)`
- `method (*AMClient) do(req *http.Request, dest any) error`

### `platform/modules/m08/service/am_test.go`

- `func TestActiveAlertsKeepsQueryInURL(t *testing.T)`

### `platform/modules/m08/service/bridge.go`

- `type BridgeService struct`
- `func NewBridgeService(channels repository.ChannelRepository, templates repository.TemplateRepository) *BridgeService`
- `method (*BridgeService) Notify(ctx context.Context, channelID string, payload WebhookPayload, raw []byte) error`
- `type renderAlert struct`
- `type renderView struct`
- `method (*BridgeService) render(ctx context.Context, channel *domain.Channel, payload WebhookPayload) (string, error)`
- `method (*BridgeService) templateFor(ctx context.Context, channel *domain.Channel) (*domain.Template, error)`
- `func imRequest(channel *domain.Channel, content string) ([]byte, string, error)`
- `func signDingtalk(target, secret string, now time.Time) (string, error)`
- `method (*BridgeService) post(ctx context.Context, channel *domain.Channel, body []byte, contentType string) error`
- `method (*BridgeService) postURL(ctx context.Context, target string, body []byte, contentType string) error`

### `platform/modules/m08/service/channel.go`

- `type ChannelService struct`
- `func NewChannelService(channels repository.ChannelRepository, templates repository.TemplateRepository, snapshots repository.…`
- `method (*ChannelService) List(ctx context.Context, filter repository.ChannelFilter) ([]*domain.Channel, int64, map[string]int,…`
- `method (*ChannelService) Get(ctx context.Context, id string) (*domain.Channel, int, error)`
- `method (*ChannelService) Create(ctx context.Context, channel *domain.Channel) (*domain.Channel, error)`
- `method (*ChannelService) Update(ctx context.Context, id string, patch *domain.Channel) (*domain.Channel, error)`
- `method (*ChannelService) Delete(ctx context.Context, id string) error`
- `method (*ChannelService) RouteReferences(ctx context.Context) (map[string]int, error)`
- `func receiverChannelID(receiver string) (string, bool)`
- `method (*ChannelService) resolveTemplate(ctx context.Context, channel *domain.Channel) error`

### `platform/modules/m08/service/channel_test.go`

- `func newChannelService(t *testing.T) (*ChannelService, *repository.GORMTemplateRepository)`
- `func TestChannelRejectsPrivateWebhookByDefault(t *testing.T)`
- `func TestChannelUpdateKeepsSecretUnlessSigningDisabled(t *testing.T)`

### `platform/modules/m08/service/config.go`

- `type SaveOutcome struct`
- `type ConfigService struct`
- `type ConfigOptions struct`
- `func NewConfigService( snapshots repository.SnapshotRepository, channels repository.ChannelRepository, inhibitions repositor…`
- `method (*ConfigService) SetClock(now func() time.Time)`
- `method (*ConfigService) Current(ctx context.Context) (*domain.Snapshot, error)`
- `method (*ConfigService) ListVersions(ctx context.Context, page, pageSize int) ([]*domain.Snapshot, int64, error)`
- `method (*ConfigService) GetVersion(ctx context.Context, id int64) (*domain.Snapshot, error)`
- `method (*ConfigService) ReloadLogs(ctx context.Context, page, pageSize int) ([]*domain.ReloadLog, int64, error)`
- `method (*ConfigService) LatestReload(ctx context.Context) (*domain.ReloadLog, bool, error)`
- `method (*ConfigService) EnabledRules(ctx context.Context) ([]*domain.InhibitionRule, error)`
- `method (*ConfigService) SaveRoutes(ctx context.Context, baseChecksum string, tree []domain.RouteNode, operator string) (*SaveO…`
- `method (*ConfigService) SaveAfterInhibitionChange(ctx context.Context, baseChecksum, operator string) (*SaveOutcome, error)`
- `method (*ConfigService) ReloadCurrent(ctx context.Context, operator string) (apply.Result, error)`
- `method (*ConfigService) save( ctx context.Context, baseChecksum string, tree []domain.RouteNode, trigger domain.ReloadTrigger,…`
- `func generateDefault(base string, tree []domain.RouteNode) (*configgen.Output, error)`
- `func generatedVersion(now time.Time, trigger domain.ReloadTrigger) string`

### `platform/modules/m08/service/config_test.go`

- `func newTestDB(t *testing.T) *gorm.DB`
- `type stubChecker struct`
- `method (*stubChecker) Check(context.Context, string) error`
- `type stubReloader struct`
- `method (*stubReloader) Reload(context.Context) error`
- `method (*stubReloader) Verify(context.Context) error`
- `func newConfigService(t *testing.T, checker ConfigChecker) (*ConfigService, *stubReloader, *gorm.DB)`
- `func TestSeedCreatesCurrentSnapshot(t *testing.T)`
- `func TestSaveRoutesAppliesAndPersists(t *testing.T)`
- `func TestSaveRoutesRejectsStaleChecksum(t *testing.T)`
- `func TestSaveRoutesValidationFailureKeepsCurrent(t *testing.T)`
- `func TestReloadCurrentDoesNotCreateVersion(t *testing.T)`

### `platform/modules/m08/service/event.go`

- `type WebhookPayload struct`
- `type WebhookAlert struct`
- `type IngestResult struct`
- `type EventView struct`
- `type EventInstance struct`
- `type EventService struct`
- `type EventOptions struct`
- `func NewEventService(events repository.EventRepository, opts EventOptions) *EventService`
- `method (*EventService) SetClock(now func() time.Time)`
- `method (*EventService) Ingest(ctx context.Context, payload WebhookPayload) (IngestResult, error)`
- `type ingestOutcome = int`
- `method (*EventService) ingestOne(ctx context.Context, alert WebhookAlert) (ingestOutcome, error)`
- `method (*EventService) Reconcile(ctx context.Context, alerts []AMAlert) (int, int, error)`
- `method (*EventService) List(ctx context.Context, filter repository.EventFilter) ([]EventView, int64, error)`
- `method (*EventService) Current(ctx context.Context, networkDomain string) ([]EventView, error)`
- `method (*EventService) Stats(ctx context.Context, networkDomain string) (repository.Stats, error)`
- `method (*EventService) PurgeExpired(ctx context.Context) (int64, error)`
- `method (*EventService) RunRetention(ctx context.Context)`
- `method (*EventService) enrich(ctx context.Context, events []*domain.Event) ([]EventView, error)`
- `func buildEvent(alert WebhookAlert, fingerprint, key string, startsAt time.Time, status domain.EventStatus, now time.Time) *…`
- `func applyAlertUpdate(event *domain.Event, alert WebhookAlert, status domain.EventStatus, now time.Time)`
- `func alertFingerprint(alert WebhookAlert) string`
- `func labelOf(labels map[string]string, key string) string`
- `func orFallback(value, fallback string) string`
- `method (IngestResult) String() string`

### `platform/modules/m08/service/event_test.go`

- `func newEventService(t *testing.T) *EventService`
- `func firingPayload() WebhookPayload`
- `func TestIngestIsIdempotentPerOccurrence(t *testing.T)`
- `func TestIngestResolveClosesEventAndUpdatesStats(t *testing.T)`
- `func TestReconcileClosesMissingEvents(t *testing.T)`
- `func TestReconcileInsertsMissingEvents(t *testing.T)`
- `func TestRetentionKeepsOpenRows(t *testing.T)`

### `platform/modules/m08/service/inhibition.go`

- `type InhibitionService struct`
- `func NewInhibitionService(rules repository.InhibitionRepository, config *ConfigService) *InhibitionService`
- `method (*InhibitionService) List(ctx context.Context, filter repository.InhibitionFilter) ([]*domain.InhibitionRule, int64, er…`
- `method (*InhibitionService) Create(ctx context.Context, rule *domain.InhibitionRule, baseChecksum, operator string) (*domain.I…`
- `method (*InhibitionService) Update(ctx context.Context, id string, patch *domain.InhibitionRule, baseChecksum, operator string…`
- `method (*InhibitionService) SetEnabled(ctx context.Context, id string, enabled bool, baseChecksum, operator string) (*domain.I…`
- `method (*InhibitionService) Delete(ctx context.Context, id, baseChecksum, operator string) (*SaveOutcome, error)`

### `platform/modules/m08/service/reconcile.go`

- `type AlertsSource interface`
- `type ReconcileService struct`
- `func NewReconcileService(events *EventService, source AlertsSource, interval time.Duration) *ReconcileService`
- `method (*ReconcileService) RunOnce(ctx context.Context) (int, int, error)`
- `method (*ReconcileService) Run(ctx context.Context)`

### `platform/modules/m08/service/seed.go`

- `type SeedOptions struct`
- `func Seed(ctx context.Context, snapshots repository.SnapshotRepository, templates repository.TemplateRepository, rules repos…`
- `method (*ConfigService) saveInitial(ctx context.Context, tree []domain.RouteNode) (*SaveOutcome, error)`
- `func seedBuiltinInhibition(ctx context.Context, rules repository.InhibitionRepository) error`
- `func seedBuiltinTemplates(ctx context.Context, templates repository.TemplateRepository) error`

### `platform/modules/m08/service/silence.go`

- `type SilenceClient interface`
- `type SilenceInput struct`
- `type LabelOption struct`
- `type SilenceService struct`
- `func NewSilenceService(client SilenceClient, authz references.DomainAuthorizer, audits repository.AuditRepository, events re…`
- `method (*SilenceService) List(ctx context.Context, actor domain.Actor) ([]domain.Silence, error)`
- `method (*SilenceService) Create(ctx context.Context, actor domain.Actor, input SilenceInput) (domain.Silence, error)`
- `method (*SilenceService) Delete(ctx context.Context, actor domain.Actor, id string) error`
- `method (*SilenceService) Audits(ctx context.Context, filter repository.AuditFilter) ([]*repository.AuditEntry, int64, error)`
- `method (*SilenceService) LabelOptions(ctx context.Context) ([]LabelOption, error)`
- `method (*SilenceService) findMatchers(ctx context.Context, id string) ([]domain.Matcher, bool, error)`
- `method (*SilenceService) authorizedSet(ctx context.Context, actor domain.Actor) (map[string]bool, error)`
- `func silenceInScope(silence domain.Silence, allowed map[string]bool) bool`
- `method (*SilenceService) audit(ctx context.Context, actor domain.Actor, action domain.AuditAction, result domain.AuditResult, …`

### `platform/modules/m08/service/template.go`

- `type TemplateService struct`
- `func NewTemplateService(templates repository.TemplateRepository, channels repository.ChannelRepository) *TemplateService`
- `method (*TemplateService) List(ctx context.Context, filter repository.TemplateFilter) ([]*domain.Template, int64, map[string]i…`
- `method (*TemplateService) Get(ctx context.Context, id string) (*domain.Template, int64, error)`
- `method (*TemplateService) Create(ctx context.Context, template *domain.Template) (*domain.Template, error)`
- `method (*TemplateService) Update(ctx context.Context, id string, patch *domain.Template) (*domain.Template, error)`
- `method (*TemplateService) Delete(ctx context.Context, id string) error`

### `platform/modules/m08/service/validate.go`

- `type ConfigChecker interface`
- `type AmtoolChecker struct`
- `func NewAmtoolChecker() *AmtoolChecker`
- `func NewAmtoolCheckerWith(lookPath func(string) (string, error), run func(ctx context.Context, bin, configPath string) (stri…`
- `method (*AmtoolChecker) Check(ctx context.Context, content string) error`
- `func parseAmtoolIssues(output string) []domain.ValidationIssue`
- `func extractLineNumber(line string) int`

### `platform/modules/m08/service/validate_test.go`

- `func TestAmtoolCheckerMissingToolIsRetryable(t *testing.T)`
- `func TestAmtoolCheckerSuccess(t *testing.T)`
- `func TestAmtoolCheckerParsesLineIssues(t *testing.T)`
- `func TestAmtoolCheckerCrashIsPlatformFault(t *testing.T)`

### `platform/modules/m09/configcenter/generator/generator.go`

- `type ConfigArtifacts struct`
- `type TargetDiagnostics struct`
- `method (TargetDiagnostics) anyOfflineOnly() bool`
- `type TargetGroup struct`
- `func buildExternalLabels(domainID, replica string) map[string]string`
- `method (*ConfigArtifacts) Checksum() string`
- `func normalizeJobFilename(jobName string) string`

### `platform/modules/m09/configcenter/generator/render.go`

- `type cfgGlobal struct`
- `type cfgAlerting struct`
- `type cfgAlertmanager struct`
- `type cfgStaticConfig struct`
- `type cfgFile struct`
- `type scrapeConf struct`
- `type basicAuthConf struct`
- `type authorizationConf struct`
- `type tlsConf struct`
- `type fileSDConf struct`
- `type relabelConf struct`
- `type JobBuild struct`
- `func AssembleWithModules(domainID, replica string, jobs []JobBuild, rules []models.MonitoringRule, alertmanagerYML, alertman…`
- `func assemble(domainID, replica string, jobs []JobBuild, rules []models.MonitoringRule, alertmanagerYML, alertmanagerAddr st…`
- `func jobScrapeConfig(job models.ScrapeJob) (scrapeConf, error)`
- `func orDefault(v, d string) string`
- `type ruleGroupsFile struct`
- `func renderRules(rules []models.MonitoringRule) string`
- `func renderBlackboxModuleDefinitions(defs []models.BlackboxModule, jobs []JobBuild) (string, error)`

### `platform/modules/m09/configcenter/generator/targets.go`

- `type SkippedInstance struct`
- `func MarshalTargetGroups(groups []TargetGroup) (string, error)`
- `func EnsureTargetsFilename(name string) error`

### `platform/modules/m09/configcenter/generator/validate.go`

- `type ToolCheckStatus = int`
- `func ValidateTargetGroups(groups []TargetGroup) error`
- `func validateTargetAddress(addr string) error`
- `func validTargetHost(host string) bool`
- `func validateLabelName(name string) error`
- `func ValidateArtifacts(ca *ConfigArtifacts, includeBlackbox bool, platformJobs []string) (models.ValidationStatus, models.Va…`
- `func emptyTargetsMessage(name string, diag *TargetDiagnostics) string`
- `func runToolChecks(ca *ConfigArtifacts, includeBlackbox bool) (ToolCheckStatus, string)`
- `func toolCheckStatus(err error) ToolCheckStatus`
- `func runPromtoolCheck(ca *ConfigArtifacts) error`
- `type toolNotExecutableError struct`
- `method (*toolNotExecutableError) Error() string`
- `method (*toolNotExecutableError) Unwrap() error`
- `func isToolNotExecutable(err error) bool`
- `func toolCheckError(tool, out string, err error) error`
- `func runBlackboxCheck(blackboxYAML string) error`
- `func runAmmtoolCheck(alertmanagerYAML string) error`

### `platform/modules/m09/configcenter/generator/validate_toolcheck_test.go`

- `func TestToolCheckErrorKeepsToolOutput(t *testing.T)`
- `func TestToolCheckErrorEmptyOutputFallsBackToExecError(t *testing.T)`
- `func TestToolCheckStatusAttribution(t *testing.T)`
- `func stubToolChecker(t *testing.T, st ToolCheckStatus, msg string)`
- `func TestValidateArtifactsPendingWhenToolNotExecutable(t *testing.T)`
- `func TestValidateArtifactsFailedWhenToolCheckUserConfig(t *testing.T)`
- `func fakeToolsInPATH(t *testing.T, tools map[string][]byte)`
- `func TestRunToolChecksClassifiesPlatformMismatchAsUnavailable(t *testing.T)`
- `func TestRunToolChecksClassifiesBlackboxPlatformMismatchAsUnavailable(t *testing.T)`
- `func TestRunToolChecksClassifiesConfigErrorAsUserConfig(t *testing.T)`

### `platform/modules/m09/configgen/configgen.go`

- `type Target struct`
- `type Job struct`
- `type Source struct`
- `type Artifacts struct`
- `type Metadata struct`
- `func Generate(src Source, version string, generatedAt time.Time) (*Artifacts, error)`
- `func toScrapeJob(domainID string, job Job) models.ScrapeJob`
- `func groupTargets(targets []Target) []generator.TargetGroup`
- `func labelKey(labels map[string]string) (string, map[string]string)`
- `func defaultIfEmpty(value, fallback string) string`
- `type ValidationResult struct`
- `func Validate(artifacts *Artifacts, platformJobs []string) ValidationResult`
- `func GenerateCenterRules(rules []models.MonitoringRule, version string, generatedAt time.Time, alertmanagerAddr string) (*Ar…`

### `platform/modules/m09/configgen/configgen_test.go`

- `func TestGenerateRendersDeterministicArtifacts(t *testing.T)`
- `func TestGenerateEmptyDomainIsValid(t *testing.T)`
- `func TestGenerateGroupsTargetsByLabels(t *testing.T)`
- `func TestGenerateRequiresDomainAndVersion(t *testing.T)`
- `func TestGenerateCenterRules(t *testing.T)`
- `func TestGenerateRendersEnabledBlackboxModules(t *testing.T)`

### `platform/modules/m09/configgen/validate_jobref_test.go`

- `func TestValidateCenterRulesUsesPlatformJobs(t *testing.T)`

### `platform/modules/m09/domain/access.go`

- `type RegistrationStatus = string`
- `type Access struct`
- `type Token struct`
- `method (*Access) IsMonitored() bool`
- `method (*Access) Monitor(now time.Time) (Token, error)`
- `method (*Access) Unmonitor() error`
- `method (*Access) ResetToken(now time.Time) (Token, error)`
- `method (*Access) Retire()`
- `method (*Access) revokeToken()`
- `func GenerateToken() (Token, error)`
- `func HashToken(plain string) string`
- `func TokenMatches(plain, storedHash string) bool`
- `func maskSecret(secret string) string`
- `func ValidateMonitorable(domainID, status, domainType string) error`
- `type ValidationError struct`
- `method (*ValidationError) Error() string`
- `method (*ValidationError) ErrorKind() apierror.Kind`
- `type NotFoundError struct`
- `method (*NotFoundError) Error() string`
- `method (*NotFoundError) ErrorKind() apierror.Kind`
- `type AgentNotFoundError struct`
- `method (*AgentNotFoundError) Error() string`
- `method (*AgentNotFoundError) ErrorKind() apierror.Kind`
- `type ConflictError struct`
- `method (*ConflictError) Error() string`
- `method (*ConflictError) ErrorKind() apierror.Kind`
- `func timePtr(t time.Time) *time.Time`

### `platform/modules/m09/domain/access_test.go`

- `func TestGenerateToken(t *testing.T)`
- `func TestTokenMatchesRejectsEmpty(t *testing.T)`
- `func TestMonitorTransitions(t *testing.T)`
- `func TestUnmonitor(t *testing.T)`
- `func TestResetToken(t *testing.T)`
- `func TestRetire(t *testing.T)`
- `func TestValidateMonitorable(t *testing.T)`

### `platform/modules/m09/domain/edgeproto.go`

- `type Component struct`
- `type TargetSnapshot struct`
- `type HeartbeatRequest struct`
- `type HeartbeatResponse struct`
- `func ValidateProtocol(raw string) error`
- `func SyncStatus(reportedVersion, currentVersion, applyError string) (status, cause string)`
- `func EffectiveAgentStatus(stored string, lastHeartbeat *time.Time, now time.Time, threshold time.Duration) string`

### `platform/modules/m09/dto/config_artifact.go`

- `type ConfigArtifactResponse struct`
- `type ListConfigArtifactsResponse struct`
- `type ConfigArtifactFileResponse struct`
- `type ConfigArtifactPreviewResponse struct`
- `func FromConfigArtifact(item *service.ArtifactView) ConfigArtifactResponse`
- `func FromConfigArtifactPreview(preview *service.ArtifactPreview) ConfigArtifactPreviewResponse`

### `platform/modules/m09/dto/config_snapshot.go`

- `type ConfigSnapshotResponse struct`
- `type ListConfigSnapshotsResponse struct`
- `func FromConfigSnapshot(item *repository.ConfigSnapshot) ConfigSnapshotResponse`

### `platform/modules/m09/dto/config_trigger.go`

- `type ConfigTriggerRequest struct`
- `type ConfigTriggerDomainResult struct`
- `type ConfigTriggerCenterResult struct`
- `type ConfigTriggerResponse struct`
- `func FromTriggerResult(result *service.TriggerResult) ConfigTriggerResponse`

### `platform/modules/m09/dto/edge_agent.go`

- `type EdgeAgentResponse struct`
- `type ListEdgeAgentsResponse struct`
- `type EdgeAgentCommandResponse struct`
- `func FromEdgeAgent(view *repository.EdgeAgentView) EdgeAgentResponse`

### `platform/modules/m09/dto/onboarding.go`

- `type OnboardingResponse struct`
- `type ListOnboardingResponse struct`
- `type InstallGuideResponse struct`
- `type MonitorResponse struct`
- `type ResetTokenResponse struct`
- `type UnmonitorResponse struct`
- `func FromOnboarding(item *repository.DomainOnboarding) OnboardingResponse`
- `func FromMonitorResult(result *service.MonitorResult) MonitorResponse`
- `func FromResetToken(result *service.ResetTokenResult) ResetTokenResponse`

### `platform/modules/m09/dto/package.go`

- `type PackageComponentResponse struct`
- `type EdgePackageResponse struct`
- `type ListEdgePackagesResponse struct`
- `func FromEdgePackage(item *service.EdgePackage) EdgePackageResponse`

### `platform/modules/m09/dto/query.go`

- `type TargetResponse struct`
- `type ListTargetsResponse struct`
- `type CoverageItemResponse struct`
- `type CoverageSummaryResponse struct`
- `type CoverageResponse struct`
- `func FromCoverageReport(report service.CoverageReport, counts service.CoverageCounts) CoverageResponse`
- `func FromEdgeTarget(row *repository.EdgeTargetRow) TargetResponse`

### `platform/modules/m09/handler/agent_handler.go`

- `type AgentHandler struct`
- `func NewAgentHandler(svc *service.EdgeService) *AgentHandler`
- `method (*AgentHandler) List(c *gin.Context)`
- `method (*AgentHandler) Get(c *gin.Context)`
- `method (*AgentHandler) Restart(c *gin.Context)`
- `method (*AgentHandler) FlushBacklog(c *gin.Context)`
- `func parseAgentID(c *gin.Context) (int64, bool)`

### `platform/modules/m09/handler/artifact_handler.go`

- `type ArtifactHandler struct`
- `func NewArtifactHandler(onboard *service.OnboardingService, artifacts *service.ArtifactService) *ArtifactHandler`
- `method (*ArtifactHandler) List(c *gin.Context)`
- `method (*ArtifactHandler) Get(c *gin.Context)`
- `method (*ArtifactHandler) Preview(c *gin.Context)`
- `method (*ArtifactHandler) Export(c *gin.Context)`
- `method (*ArtifactHandler) RecoveryBundle(c *gin.Context)`
- `method (*ArtifactHandler) artifactForRequest(c *gin.Context) (*service.ArtifactView, bool)`
- `method (*ArtifactHandler) authorizeDomain(c *gin.Context, view *service.ArtifactView) bool`
- `func parseArtifactID(c *gin.Context) (int64, bool)`
- `func parseArtifactLimit(c *gin.Context) (int, error)`
- `func writeArtifactDownload(c *gin.Context, export *service.ArtifactExport)`

### `platform/modules/m09/handler/artifact_handler_test.go`

- `func newArtifactTestStack(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB)`
- `func TestConfigArtifactListAndExportEndpoints(t *testing.T)`
- `func TestConfigArtifactViewerCanListButNotReadContent(t *testing.T)`
- `func TestConfigArtifactInvalidFilter(t *testing.T)`

### `platform/modules/m09/handler/config_trigger_handler.go`

- `type ConfigTriggerHandler struct`
- `func NewConfigTriggerHandler(svc *service.ConfigTriggerService) *ConfigTriggerHandler`
- `method (*ConfigTriggerHandler) Trigger(c *gin.Context)`

### `platform/modules/m09/handler/config_trigger_handler_test.go`

- `func newConfigTriggerRouter(t *testing.T, user *models.User) *gin.Engine`
- `func doTriggerJSON(t *testing.T, router *gin.Engine, body string) (int, map[string]any)`
- `func TestConfigTriggerEndpointWaitsAndReturnsResult(t *testing.T)`
- `func TestConfigTriggerEndpointRejectsInvalidInput(t *testing.T)`
- `func TestConfigTriggerEndpointHonorsDomainAuthorization(t *testing.T)`
- `func TestConfigTriggerEndpointAsyncIsAccepted(t *testing.T)`

### `platform/modules/m09/handler/edge_auth.go`

- `type TokenValidator interface`
- `type rejectAllValidator struct`
- `method (rejectAllValidator) Validate(context.Context, string) (string, bool)`
- `func EdgeTokenMiddleware(v TokenValidator) gin.HandlerFunc`
- `func bearerToken(c *gin.Context) string`
- `func NetworkDomainFromContext(c *gin.Context) string`

### `platform/modules/m09/handler/edge_auth_test.go`

- `type fakeValidator struct`
- `method (fakeValidator) Validate(_ context.Context, token string) (string, bool)`
- `func newEdgeTestRouter(mw gin.HandlerFunc) *gin.Engine`
- `func TestEdgeTokenMiddleware_NoToken(t *testing.T)`
- `func TestEdgeTokenMiddleware_InvalidToken(t *testing.T)`
- `func TestEdgeTokenMiddleware_ValidTokenSetsContext(t *testing.T)`
- `func TestEdgeTokenMiddleware_DefaultRejectsAll(t *testing.T)`
- `func TestBearerToken_TrimsAndRequiresPrefix(t *testing.T)`

### `platform/modules/m09/handler/edge_handler.go`

- `type EdgeHandler struct`
- `func NewEdgeHandler(svc *service.EdgeService, sync *service.ConfigSyncService) *EdgeHandler`
- `method (*EdgeHandler) Heartbeat(c *gin.Context)`
- `method (*EdgeHandler) Config(c *gin.Context)`

### `platform/modules/m09/handler/edge_handler_test.go`

- `func newEdgeRouter(t *testing.T, user *models.User) (*gin.Engine, *service.OnboardingService)`
- `func doEdgeJSON(t *testing.T, router *gin.Engine, method, path, body string, token string) (int, map[string]any)`
- `func TestEdgeHeartbeatRequiresValidToken(t *testing.T)`
- `func TestEdgeHeartbeatAndAgentCommands(t *testing.T)`
- `func TestEdgeAgentCommandsRequireAdmin(t *testing.T)`
- `func adminActor() service.Actor`
- `func itoa(id int64) string`

### `platform/modules/m09/handler/errors.go`

- `func respondError(c *gin.Context, err error)`

### `platform/modules/m09/handler/json.go`

- `func decodeStrictJSON(c *gin.Context, target any) error`

### `platform/modules/m09/handler/onboarding_handler.go`

- `type OnboardingHandler struct`
- `func NewOnboardingHandler(svc *service.OnboardingService) *OnboardingHandler`
- `method (*OnboardingHandler) List(c *gin.Context)`
- `method (*OnboardingHandler) Get(c *gin.Context)`
- `method (*OnboardingHandler) Monitor(c *gin.Context)`
- `method (*OnboardingHandler) ResetToken(c *gin.Context)`
- `method (*OnboardingHandler) Unmonitor(c *gin.Context)`
- `func actorOf(c *gin.Context) service.Actor`
- `func validRegistrationStatus(value string) bool`
- `func parsePagination(c *gin.Context) (int, int)`
- `func centerEndpoint(c *gin.Context) string`

### `platform/modules/m09/handler/onboarding_handler_test.go`

- `func newOnboardingRouter(t *testing.T, user *models.User) *gin.Engine`
- `func newOnboardingRouterWithDB(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB)`
- `func doJSON(t *testing.T, router *gin.Engine, method, path string) (int, map[string]any)`
- `func adminUser() *models.User`
- `func viewerUser() *models.User`
- `func TestOnboardingMonitorResetUnmonitor(t *testing.T)`
- `func TestOnboardingListEnvelopeAndValidation(t *testing.T)`
- `func TestOnboardingAdminViewExposesAdministrativeFields(t *testing.T)`
- `func TestOnboardingAdminViewRequiresAdmin(t *testing.T)`
- `func TestOnboardingNonEdgeScopeAndAdminGate(t *testing.T)`

### `platform/modules/m09/handler/package_handler.go`

- `type PackageHandler struct`
- `func NewPackageHandler(svc *service.PackageService) *PackageHandler`
- `method (*PackageHandler) List(c *gin.Context)`
- `method (*PackageHandler) Latest(c *gin.Context)`
- `method (*PackageHandler) Download(c *gin.Context)`

### `platform/modules/m09/handler/package_handler_test.go`

- `func newPackageRouter(t *testing.T, dir string) *gin.Engine`
- `func writePackage(t *testing.T, dir string) (string, string)`
- `func TestEdgePackagesEmptyDirectory(t *testing.T)`
- `func TestEdgePackagesListLatestAndDownload(t *testing.T)`

### `platform/modules/m09/handler/query_handler.go`

- `type QueryHandler struct`
- `func NewQueryHandler(svc *service.QueryService) *QueryHandler`
- `method (*QueryHandler) Query(c *gin.Context)`
- `method (*QueryHandler) QueryRange(c *gin.Context)`
- `method (*QueryHandler) Labels(c *gin.Context)`
- `method (*QueryHandler) LabelValues(c *gin.Context)`
- `method (*QueryHandler) Series(c *gin.Context)`
- `method (*QueryHandler) Alerts(c *gin.Context)`
- `method (*QueryHandler) Targets(c *gin.Context)`
- `method (*QueryHandler) Coverage(c *gin.Context)`
- `func parseCoveragePagination(c *gin.Context) (int, int)`
- `func validCoverageState(state string) bool`
- `func validResourceCategory(category string) bool`
- `method (*QueryHandler) proxy(c *gin.Context, path string)`
- `func mergedParams(c *gin.Context) url.Values`
- `func RegisterQueryRoutes(apiV1 *gin.RouterGroup, h *QueryHandler)`

### `platform/modules/m09/handler/query_handler_test.go`

- `func newQueryRouter(t *testing.T, user *models.User, promURL string) *gin.Engine`
- `func parseTestURL(t *testing.T, raw string) *url.URL`
- `func TestQueryTargetsAndCoverageRoutes(t *testing.T)`
- `func TestQueryGuardReturnsBadRequest(t *testing.T)`
- `func TestQueryProxyMetaEnvelopeAndBadGateway(t *testing.T)`

### `platform/modules/m09/handler/routes.go`

- `type Handlers struct`
- `func RegisterPlatformRoutes(platform *gin.RouterGroup, h Handlers)`
- `func RegisterEdgeRoutes(edge *gin.RouterGroup, h Handlers)`

### `platform/modules/m09/handler/snapshot_handler.go`

- `type SnapshotHandler struct`
- `func NewSnapshotHandler(onboard *service.OnboardingService, sync *service.ConfigSyncService) *SnapshotHandler`
- `method (*SnapshotHandler) List(c *gin.Context)`
- `method (*SnapshotHandler) Get(c *gin.Context)`
- `method (*SnapshotHandler) Content(c *gin.Context)`
- `func parseSnapshotID(c *gin.Context) (int64, bool)`

### `platform/modules/m09/handler/snapshot_handler_test.go`

- `type stubSource struct`
- `method (stubSource) BuildSource(_ context.Context, domainID string) (configgen.Source, error)`
- `method (stubSource) Fingerprint(_ context.Context, _ string) (time.Time, error)`
- `method (stubSource) EdgeDomainIDs(_ context.Context) ([]string, error)`
- `type stubValidator struct`
- `method (stubValidator) Validate(_ context.Context, _ *configgen.Artifacts, _ []string) configgen.ValidationResult`
- `func newSnapshotTestStack(t *testing.T, user *models.User) (*gin.Engine, *service.ConfigSyncService)`
- `func TestConfigSnapshotReadEndpoints(t *testing.T)`
- `func TestConfigSnapshotContentRequiresAdminAndScope(t *testing.T)`
- `func TestNoConfirmationOrRollbackRoutes(t *testing.T)`
- `func TestEdgeConfigPullETagAndMissing(t *testing.T)`

### `platform/modules/m09/module.go`

- `type Options struct`
- `type Module struct`
- `func NewModule(db *gorm.DB, opts Options) (*Module, error)`
- `method (*Module) Name() string`
- `method (*Module) RegisterRoutes(platform *gin.RouterGroup) error`
- `method (*Module) RegisterEdgeRoutes(edge *gin.RouterGroup) error`
- `method (*Module) MonitoringRetirer() references.MonitoringRetirer`
- `method (*Module) ConfigSync() *service.ConfigSyncService`
- `method (*Module) NotifyConfigSync(ctx context.Context, domainIDs []string)`
- `method (*Module) NotifyAllConfigSync(ctx context.Context)`
- `method (*Module) RegisterQueryRoutes(apiV1 *gin.RouterGroup) error`
- `method (*Module) StartBackground(ctx context.Context)`

### `platform/modules/m09/references/center_rules.go`

- `type CenterRule struct`
- `type CenterRuleSource interface`
- `type GORMCenterRuleSource struct`
- `func NewCenterRuleSource(db *gorm.DB) *GORMCenterRuleSource`
- `type centerRuleRow struct`
- `method (*GORMCenterRuleSource) ListEnabledReady(ctx context.Context) ([]CenterRule, error)`
- `method (*GORMCenterRuleSource) EffectiveJobNames(ctx context.Context) ([]string, error)`
- `method (*GORMCenterRuleSource) Fingerprint(ctx context.Context) (time.Time, error)`

### `platform/modules/m09/references/label_templates.go`

- `type labelMapping struct`
- `type labelTemplate struct`
- `type labelTemplateRow struct`
- `method (labelTemplateRow) TableName() string`
- `type labelTemplateSet struct`
- `method (*GORMSourceReader) loadLabelTemplates(ctx context.Context) (labelTemplateSet, error)`
- `method (labelTemplateSet) resolve(explicitID, category string) (labelTemplate, bool)`
- `func expandTemplateLabels(tpl labelTemplate, ref domain.ResourceRef, instance, jobName string) map[string]string`
- `func resourceFieldView(ref domain.ResourceRef) map[string]string`
- `func builtinField(sourceField, instance, jobName string) string`
- `func applyLabelTransform(value, transform string) string`
- `func systemTargetLabels(ref domain.ResourceRef) map[string]string`
- `func mergeTargetLabels(system, template map[string]string) map[string]string`
- `func positiveIntString(value int) string`

### `platform/modules/m09/references/label_templates_test.go`

- `func insertLabelTemplate(t *testing.T, gormDB *gorm.DB, id, category string, isDefault bool, mappings string)`
- `func ensureAppDict(t *testing.T, gormDB *gorm.DB, appCode string)`
- `func jobLabels(t *testing.T, source configgen.Source, jobName string) map[string]string`
- `func TestSourceReaderExpandsExplicitLabelTemplate(t *testing.T)`
- `func TestSourceReaderFallsBackToCategoryDefaultTemplate(t *testing.T)`
- `func TestSourceReaderExplicitTemplateWinsOverDefault(t *testing.T)`
- `func TestSourceReaderFallsBackToDefaultWhenExplicitUnusable(t *testing.T)`
- `func TestSourceReaderExpandsTemplateForBlackboxJob(t *testing.T)`
- `func TestSourceReaderWithoutTemplateOnlySystemLabels(t *testing.T)`
- `func TestSourceReaderProtectsSystemLabels(t *testing.T)`
- `func TestSourceReaderPlatformFallsBackToPrimaryAppPlatform(t *testing.T)`
- `func TestSourceReaderFingerprintAdvancesOnLabelTemplateChange(t *testing.T)`

### `platform/modules/m09/references/source_reader.go`

- `type SourceReader interface`
- `type GORMSourceReader struct`
- `func NewGORMSourceReader(db *gorm.DB) *GORMSourceReader`
- `method (*GORMSourceReader) cachedPorts(ctx context.Context) (map[string]int, map[string]int, error)`
- `type jobSourceRow struct`
- `type portRow struct`
- `type exporterPortRow struct`
- `method (*GORMSourceReader) BuildSource(ctx context.Context, domainID string) (configgen.Source, error)`
- `method (*GORMSourceReader) loadProbeModules(ctx context.Context) ([]models.BlackboxModule, error)`
- `method (*GORMSourceReader) Fingerprint(ctx context.Context, domainID string) (time.Time, error)`
- `method (*GORMSourceReader) EdgeDomainIDs(ctx context.Context) ([]string, error)`
- `method (*GORMSourceReader) loadPorts(ctx context.Context) (map[string]int, map[string]int, error)`
- `method (*GORMSourceReader) loadPrimaryPlatforms(ctx context.Context, refs map[string]domain.ResourceRef) (map[string]string, e…`

### `platform/modules/m09/references/source_reader_test.go`

- `func newSourceTestDB(t *testing.T) *gorm.DB`
- `func TestSourceReaderBuildsJobsFromM01(t *testing.T)`
- `func TestSourceReaderFingerprintAndDomains(t *testing.T)`
- `func TestSourceReaderFingerprintAdvancesOnResourceSoftDelete(t *testing.T)`
- `func TestSourceReaderFingerprintAdvancesOnProbeModuleSoftDelete(t *testing.T)`
- `type countingLogger struct`
- `method (*countingLogger) LogMode(logger.LogLevel) logger.Interface`
- `method (*countingLogger) Info(context.Context, string, ...any)`
- `method (*countingLogger) Warn(context.Context, string, ...any)`
- `method (*countingLogger) Error(context.Context, string, ...any)`
- `method (*countingLogger) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error)`
- `method (*countingLogger) count(marker string) int`
- `func TestSourceReaderFansOutWithoutQueryAmplification(t *testing.T)`
- `func TestSourceReaderExcludesResourceMovedToAnotherDomain(t *testing.T)`

### `platform/modules/m09/references/sync_sink.go`

- `type SyncResultSink interface`

### `platform/modules/m09/repository/artifact_repository.go`

- `type ArtifactType = string`
- `type Artifact struct`
- `type ArtifactFilter struct`
- `type artifactRecord struct`
- `method (artifactRecord) TableName() string`
- `func toArtifact(rec *artifactRecord) Artifact`
- `method (*GORMRepository) ListArtifacts(ctx context.Context, filter ArtifactFilter) ([]Artifact, error)`
- `method (*GORMRepository) GetArtifact(ctx context.Context, id int64) (*Artifact, error)`
- `method (*GORMRepository) CurrentArtifact(ctx context.Context, typ ArtifactType, onlyPassed bool) (*Artifact, error)`

### `platform/modules/m09/repository/center_snapshot_repository.go`

- `type CenterConfigSnapshot struct`
- `type CenterSnapshotRepository interface`
- `type centerSnapshotRecord struct`
- `method (centerSnapshotRecord) TableName() string`
- `type GORMCenterSnapshotRepository struct`
- `func NewCenterSnapshotRepository(db *gorm.DB) *GORMCenterSnapshotRepository`
- `method (*GORMCenterSnapshotRepository) Insert(ctx context.Context, rec CenterConfigSnapshot) (int64, error)`
- `method (*GORMCenterSnapshotRepository) InsertAndActivate(ctx context.Context, rec CenterConfigSnapshot) (int64, error)`
- `method (*GORMCenterSnapshotRepository) CurrentPassed(ctx context.Context) (*CenterConfigSnapshot, error)`
- `func activateCenterSnapshot(tx *gorm.DB, id int64) error`
- `method (*GORMCenterSnapshotRepository) List(ctx context.Context, limit int) ([]CenterConfigSnapshot, error)`
- `method (*GORMCenterSnapshotRepository) Prune(ctx context.Context, keepDays int, loc *time.Location) ([]string, error)`
- `func centerSnapshotFromDomain(rec CenterConfigSnapshot) centerSnapshotRecord`
- `func centerSnapshotToDomain(row *centerSnapshotRecord) *CenterConfigSnapshot`

### `platform/modules/m09/repository/center_snapshot_repository_test.go`

- `func newCenterRepoTestDB(t *testing.T) *gorm.DB`
- `func insertCenterSnapshot(t *testing.T, repo *repository.GORMCenterSnapshotRepository, version string, created time.Time, st…`
- `func TestCenterSnapshotPruneKeepsOneSuccessPerDay(t *testing.T)`
- `func TestCenterSnapshotPruneKeepsCurrentOutsideWindow(t *testing.T)`

### `platform/modules/m09/repository/edge_repository.go`

- `type edgeAgentRecord struct`
- `method (edgeAgentRecord) TableName() string`
- `type heartbeatRecord struct`
- `method (heartbeatRecord) TableName() string`
- `type targetSnapshotRecord struct`
- `method (targetSnapshotRecord) TableName() string`
- `type AgentHeartbeatInput struct`
- `type AgentRuntime struct`
- `type HeartbeatRecord struct`
- `type EdgeAgentFilter struct`
- `type EdgeAgentView struct`
- `type EdgeRepository interface`
- `method (*GORMRepository) FindMonitoredDomainByTokenHash(ctx context.Context, hash string) (string, error)`
- `method (*GORMRepository) CurrentConfigMeta(ctx context.Context, domainID string) (string, string, error)`
- `method (*GORMRepository) UpsertAgentHeartbeat(ctx context.Context, in AgentHeartbeatInput) (AgentRuntime, error)`
- `method (*GORMRepository) InsertHeartbeat(ctx context.Context, rec HeartbeatRecord) error`
- `method (*GORMRepository) ReplaceTargetSnapshots(ctx context.Context, domainID string, agentID int64, targets []domain.TargetSn…`
- `method (*GORMRepository) TouchAccessHeartbeat(ctx context.Context, domainID string, at time.Time) error`
- `method (*GORMRepository) ListAgents(ctx context.Context, filter EdgeAgentFilter, allowed []string) ([]EdgeAgentView, int64, er…`
- `method (*GORMRepository) GetAgent(ctx context.Context, id int64, allowed []string) (*EdgeAgentView, error)`
- `method (*GORMRepository) IncrementRestartSeq(ctx context.Context, id int64, requestedBy string, at time.Time) error`
- `method (*GORMRepository) IncrementFlushSeq(ctx context.Context, id int64, requestedBy string, at time.Time) error`
- `method (*GORMRepository) MarkAgentsOffline(ctx context.Context, cutoff, now time.Time) (int64, error)`
- `method (*GORMRepository) DeleteHeartbeatsBefore(ctx context.Context, cutoff time.Time) (int64, error)`
- `func applyAgentAllowed(query *gorm.DB, allowed []string) *gorm.DB`
- `func toEdgeAgentView(row *edgeAgentRecord) EdgeAgentView`
- `func marshalComponents(components []domain.Component) (string, error)`
- `func decodeComponents(raw string) []domain.Component`
- `func collectorComponent(components []domain.Component) (status, version string)`
- `func parseRFC3339(raw string) *time.Time`

### `platform/modules/m09/repository/models.go`

- `type accessRecord struct`
- `method (accessRecord) TableName() string`
- `type domainOnboardingRow struct`

### `platform/modules/m09/repository/onboarding_repository.go`

- `type ListFilter struct`
- `type DomainOnboarding struct`
- `type OnboardingRepository interface`
- `type TenantReader interface`
- `type GORMRepository struct`
- `func NewGORMRepository(db *gorm.DB) *GORMRepository`
- `method (*GORMRepository) List(ctx context.Context, filter ListFilter) ([]DomainOnboarding, int64, error)`
- `method (*GORMRepository) Get(ctx context.Context, domainID string, allowed []string) (*DomainOnboarding, error)`
- `method (*GORMRepository) FindAccess(ctx context.Context, domainID string) (*domain.Access, error)`
- `method (*GORMRepository) UpsertAccess(ctx context.Context, item *domain.Access) error`
- `method (*GORMRepository) RetireDomainState(ctx context.Context, domainID string) error`
- `method (*GORMRepository) AgentImpact(ctx context.Context, domainID string) (int64, int64, error)`
- `method (*GORMRepository) AllowedDomainIDs(ctx context.Context, tenantID string) ([]string, error)`
- `method (*GORMRepository) base(ctx context.Context) *gorm.DB`
- `method (*GORMRepository) applyConditions(query *gorm.DB, filter ListFilter) *gorm.DB`
- `func applyAllowed(query *gorm.DB, allowed []string) *gorm.DB`
- `func toDomainOnboarding(row *domainOnboardingRow) DomainOnboarding`
- `func parseStringList(raw string) []string`
- `func toDomainAccess(row *accessRecord) *domain.Access`

### `platform/modules/m09/repository/query_repository.go`

- `type EdgeTargetRow struct`
- `type TargetFilter struct`
- `type QueryRepository interface`
- `type CoverageFilter struct`
- `type CoverageResourceRow struct`
- `type CoverageTargetRow struct`
- `method (*GORMRepository) ListCoverageResources(ctx context.Context, filter CoverageFilter) ([]CoverageResourceRow, error)`
- `method (*GORMRepository) ListCoverageTargets(ctx context.Context, filter CoverageFilter) ([]CoverageTargetRow, error)`
- `func applyCoverageDomain(q *gorm.DB, filter CoverageFilter, column string) *gorm.DB`
- `method (*GORMRepository) ListEdgeTargets(ctx context.Context, filter TargetFilter) ([]EdgeTargetRow, int64, error)`
- `method (*GORMRepository) TargetHealthCounts(ctx context.Context, allowed []string, freshAfter time.Time) (int64, int64, error)`
- `method (*GORMRepository) UnmonitoredResourceCount(ctx context.Context, allowed []string) (int64, error)`

### `platform/modules/m09/repository/snapshot_prune.go`

- `type snapshotPruneCandidate struct`
- `func planDailySnapshotPrune( rows []snapshotPruneCandidate, keepDays int, loc *time.Location, now time.Time, ) (removeIDs []…`

### `platform/modules/m09/repository/snapshot_repository.go`

- `type configSnapshotRecord struct`
- `method (configSnapshotRecord) TableName() string`
- `type ConfigSnapshot struct`
- `type SnapshotRepository interface`
- `method (*GORMRepository) InsertSnapshot(ctx context.Context, rec ConfigSnapshot) (int64, error)`
- `method (*GORMRepository) InsertAndActivate(ctx context.Context, rec ConfigSnapshot) (int64, error)`
- `method (*GORMRepository) SetLastConfigVersion(ctx context.Context, domainID, version string) error`
- `method (*GORMRepository) CurrentPassed(ctx context.Context, domainID string) (*ConfigSnapshot, error)`
- `method (*GORMRepository) GetSnapshot(ctx context.Context, domainID string, id int64) (*ConfigSnapshot, error)`
- `method (*GORMRepository) ListSnapshots(ctx context.Context, domainID string, limit int) ([]ConfigSnapshot, error)`
- `func isAlertmanagerSnapshot(version string) bool`
- `method (*GORMRepository) PruneSnapshots(ctx context.Context, domainID string, keepDays int, loc *time.Location) ([]string, err…`
- `func toSnapshotRecord(rec ConfigSnapshot, current bool) configSnapshotRecord`
- `func toConfigSnapshot(row *configSnapshotRecord) *ConfigSnapshot`

### `platform/modules/m09/repository/snapshot_repository_test.go`

- `func newRepoTestDB(t *testing.T) *gorm.DB`
- `func insertSnapshot(t *testing.T, repo *repository.GORMRepository, version string, created time.Time, current bool) int64`
- `func insertSnapshotWithStatus(t *testing.T, repo *repository.GORMRepository, version string, created time.Time, status strin…`
- `func listVersions(t *testing.T, repo *repository.GORMRepository) []string`
- `func TestPruneSnapshotsKeepsOneSuccessPerDay(t *testing.T)`
- `func TestPruneSnapshotsKeepsCurrentOutsideRetentionWindow(t *testing.T)`

### `platform/modules/m09/service/artifact_service.go`

- `type ArtifactView struct`
- `type ArtifactFile struct`
- `type ArtifactPreview struct`
- `type ArtifactExport struct`
- `type ArtifactService struct`
- `type ArtifactRepository interface`
- `func NewArtifactService(repo ArtifactRepository, store *storage.ContentStore) *ArtifactService`
- `method (*ArtifactService) List(ctx context.Context, filter repository.ArtifactFilter) ([]ArtifactView, error)`
- `method (*ArtifactService) Get(ctx context.Context, id int64) (*ArtifactView, error)`
- `method (*ArtifactService) Preview(ctx context.Context, id int64) (*ArtifactPreview, error)`
- `method (*ArtifactService) Export(ctx context.Context, id int64) (*ArtifactExport, error)`
- `method (*ArtifactService) ExportRaw(ctx context.Context, id int64) (*ArtifactExport, error)`
- `method (*ArtifactService) RecoveryBundle(ctx context.Context) (*ArtifactExport, error)`
- `method (*ArtifactService) files(row *repository.Artifact) ([]ArtifactFile, error)`
- `method (*ArtifactService) toView(row *repository.Artifact) ArtifactView`
- `type bundleManifest struct`
- `type bundleFile struct`

### `platform/modules/m09/service/artifact_service_test.go`

- `func newArtifactStack(t *testing.T) (*service.ArtifactService, *gorm.DB, *storage.ContentStore)`
- `func insertArtifactRow(t *testing.T, gormDB *gorm.DB, scope, scopeKey, version, checksum, content string, current bool)`
- `func TestArtifactServiceUnifiedHistoryPreviewAndExport(t *testing.T)`
- `func TestArtifactServiceReturnsNilForMissingAndRequiresCenterForBundle(t *testing.T)`

### `platform/modules/m09/service/center_rules_service.go`

- `type CenterRulesService struct`
- `func NewCenterRulesService( repo repository.CenterSnapshotRepository, source references.CenterRuleSource, sink references.Sy…`
- `method (*CenterRulesService) SetAlertmanagerAddr(addr string)`
- `method (*CenterRulesService) SetValidator(validator Validator)`
- `method (*CenterRulesService) SetRetention(days int, loc *time.Location)`
- `method (*CenterRulesService) Sync(ctx context.Context) (*repository.CenterConfigSnapshot, error)`
- `method (*CenterRulesService) prune(ctx context.Context)`
- `method (*CenterRulesService) RunWatcher(ctx context.Context, interval time.Duration)`
- `func centerSyncSettled(snapshot *repository.CenterConfigSnapshot) bool`
- `method (*CenterRulesService) publish(ctx context.Context, rulesYML string) error`
- `method (*CenterRulesService) reload(ctx context.Context) error`
- `method (*CenterRulesService) recordOutcomes(ctx context.Context, rules []references.CenterRule, record repository.CenterConfig…`

### `platform/modules/m09/service/center_rules_service_test.go`

- `type capturingValidator struct`
- `method (*capturingValidator) Validate(_ context.Context, _ *configgen.Artifacts, platformJobs []string) configgen.ValidationRe…`
- `type fakeCenterSource struct`
- `method (*fakeCenterSource) EffectiveJobNames(context.Context) ([]string, error)`
- `method (*fakeCenterSource) ListEnabledReady(context.Context) ([]references.CenterRule, error)`
- `method (*fakeCenterSource) Calls() int`
- `method (*fakeCenterSource) Fingerprint(context.Context) (time.Time, error)`
- `type recordingRuleSink struct`
- `method (*recordingRuleSink) RecordDomainSync(context.Context, string, string, time.Time, map[string]string) error`
- `method (*recordingRuleSink) RecordRuleSync(_ context.Context, version string, _ time.Time, outcomes map[string]string) error`
- `func TestCenterRulesSyncPublishesAndWritesBack(t *testing.T)`
- `func TestCenterRulesReloadFailureKeepsCurrent(t *testing.T)`
- `func TestCenterRulesSyncBackfillsCurrentPayloadWithPersistedVersion(t *testing.T)`
- `func TestCenterRulesSyncDoesNotPersistFailedAttempts(t *testing.T)`
- `func TestCenterRulesSyncPassAfterFailureCreatesOnlySuccessSnapshot(t *testing.T)`
- `func TestCenterRulesSyncCollapsesSameDayHistory(t *testing.T)`
- `func TestCenterRulesSyncPassesEffectiveJobNames(t *testing.T)`
- `func TestCenterRulesSyncConcurrentCallsShareOneSnapshot(t *testing.T)`
- `func TestCenterRulesWatcherRetriesPlatformFaultWithoutNewRows(t *testing.T)`
- `func TestCenterRulesWatcherDoesNotSpinOnZeroFingerprint(t *testing.T)`

### `platform/modules/m09/service/center_rules_watcher_test.go`

- `func TestCenterSyncSettled(t *testing.T)`

### `platform/modules/m09/service/config_sync_service.go`

- `type Validator interface`
- `type defaultValidator struct`
- `method (defaultValidator) Validate(_ context.Context, artifacts *configgen.Artifacts, platformJobs []string) configgen.Validat…`
- `type ConfigSyncService struct`
- `func NewConfigSyncService( repo repository.SnapshotRepository, sources references.SourceReader, store *storage.ContentStore,…`
- `method (*ConfigSyncService) SetSyncSink(sink references.SyncResultSink)`
- `method (*ConfigSyncService) SetRetention(days int, loc *time.Location)`
- `method (*ConfigSyncService) EdgeDomainIDs(ctx context.Context) ([]string, error)`
- `method (*ConfigSyncService) SyncDomain(ctx context.Context, domainID string) (*repository.ConfigSnapshot, error)`
- `method (*ConfigSyncService) prune(ctx context.Context, domainID string)`
- `method (*ConfigSyncService) recordSyncResult(ctx context.Context, source configgen.Source, record repository.ConfigSnapshot, g…`
- `method (*ConfigSyncService) CurrentContent(ctx context.Context, domainID string) (string, []byte, error)`
- `method (*ConfigSyncService) CurrentConfigZip(ctx context.Context, domainID string) (string, []byte, error)`
- `method (*ConfigSyncService) ListSnapshots(ctx context.Context, domainID string, limit int) ([]repository.ConfigSnapshot, error)`
- `method (*ConfigSyncService) GetSnapshot(ctx context.Context, domainID string, id int64) (*repository.ConfigSnapshot, error)`
- `method (*ConfigSyncService) SnapshotContent(ctx context.Context, domainID string, id int64) (*repository.ConfigSnapshot, []byt…`
- `method (*ConfigSyncService) RunWatcher(ctx context.Context, interval time.Duration)`
- `method (*ConfigSyncService) watchOnce(ctx context.Context, last map[string]time.Time)`
- `method (*ConfigSyncService) domainLock(domainID string) *sync.Mutex`
- `func newSnapshotVersion(now time.Time) string`
- `func mustJSON(value any) string`

### `platform/modules/m09/service/config_sync_service_test.go`

- `func itoa(v int64) string`
- `type fakeSource struct`
- `method (*fakeSource) BuildSource(_ context.Context, domainID string) (configgen.Source, error)`
- `method (*fakeSource) BuildCalls() int`
- `method (*fakeSource) Fingerprint(_ context.Context, _ string) (time.Time, error)`
- `method (*fakeSource) EdgeDomainIDs(_ context.Context) ([]string, error)`
- `type fakeValidator struct`
- `method (fakeValidator) Validate(_ context.Context, _ *configgen.Artifacts, _ []string) configgen.ValidationResult`
- `func passed() fakeValidator`
- `func failed(cause string) fakeValidator`
- `func TestSyncDomainPublishesPassedSnapshot(t *testing.T)`
- `func TestSyncDomainFailureKeepsCurrent(t *testing.T)`
- `func TestSyncDomainSkipsUnchangedChecksum(t *testing.T)`
- `func TestSyncDomainCollapsesSameDayHistory(t *testing.T)`
- `func TestSnapshotContentReadsStoredPayload(t *testing.T)`
- `func TestRunWatcherInitialPassPublishesSnapshot(t *testing.T)`
- `type recordingSink struct`
- `method (*recordingSink) RecordDomainSync(_ context.Context, domainID, version string, generatedAt time.Time, outcomes map[stri…`
- `method (*recordingSink) RecordRuleSync(_ context.Context, _ string, _ time.Time, _ map[string]string) error`
- `func TestSyncDomainWritesBackJobOutcomes(t *testing.T)`
- `func TestSyncDomainFailureWritesBackFailure(t *testing.T)`
- `func TestRunWatcherSyncsDomainsConcurrentlyWithBound(t *testing.T)`

### `platform/modules/m09/service/config_trigger_service.go`

- `type TriggerScope = string`
- `type TriggerRequest struct`
- `type DomainTriggerResult struct`
- `type CenterTriggerResult struct`
- `type TriggerResult struct`
- `type ConfigTriggerService struct`
- `func NewConfigTriggerService( domains *ConfigSyncService, center *CenterRulesService, onboarding *OnboardingService, ) *Conf…`
- `method (*ConfigTriggerService) Trigger(ctx context.Context, actor Actor, req TriggerRequest) (*TriggerResult, error)`
- `method (*ConfigTriggerService) NotifyDomains(_ context.Context, domainIDs []string)`
- `method (*ConfigTriggerService) NotifyAllDomains(ctx context.Context)`
- `method (*ConfigTriggerService) Run(ctx context.Context)`
- `method (*ConfigTriggerService) resolveScope( ctx context.Context, actor Actor, scope TriggerScope, rawIDs []string, ) ([]strin…`
- `method (*ConfigTriggerService) enqueue(domainIDs []string, center bool)`
- `method (*ConfigTriggerService) drain(ctx context.Context)`
- `method (*ConfigTriggerService) runNow( ctx context.Context, domainIDs []string, includeCenter bool, ) *TriggerResult`
- `func normalizeTriggerScope(raw TriggerScope) (TriggerScope, error)`
- `func normalizeDomainIDs(raw []string) []string`
- `func domainTriggerResult(id string, snapshot *repository.ConfigSnapshot, err error) DomainTriggerResult`
- `func centerTriggerResult(snapshot *repository.CenterConfigSnapshot, err error) *CenterTriggerResult`

### `platform/modules/m09/service/config_trigger_service_test.go`

- `func newTriggerStack(t *testing.T) (*service.ConfigTriggerService, *service.ConfigSyncService, *repository.GORMCenterSnapsho…`
- `func TestConfigTriggerDomainWaitSyncsOnlyRequestedDomain(t *testing.T)`
- `func TestConfigTriggerCenterWaitSyncsRules(t *testing.T)`
- `func TestConfigTriggerRejectsInvalidScopeAndEmptyDomains(t *testing.T)`
- `func TestConfigTriggerEnforcesDomainAuthorization(t *testing.T)`
- `func TestConfigTriggerAsyncCoalescesRapidRequests(t *testing.T)`
- `func TestConfigTriggerNotifyDomainsEnqueues(t *testing.T)`
- `func TestConfigTriggerNotifyAllDomainsEnqueues(t *testing.T)`

### `platform/modules/m09/service/edge_service.go`

- `type EdgeService struct`
- `func NewEdgeService(repo repository.EdgeRepository, tenants repository.TenantReader) *EdgeService`
- `method (*EdgeService) HandleHeartbeat(ctx context.Context, domainID string, req domain.HeartbeatRequest) (*domain.HeartbeatRes…`
- `method (*EdgeService) ListAgents(ctx context.Context, actor Actor, filter repository.EdgeAgentFilter) ([]repository.EdgeAgentV…`
- `method (*EdgeService) GetAgent(ctx context.Context, actor Actor, id int64) (*repository.EdgeAgentView, error)`
- `method (*EdgeService) RestartAgent(ctx context.Context, actor Actor, id int64, requestedBy string) (*repository.EdgeAgentView,…`
- `method (*EdgeService) FlushBacklogAgent(ctx context.Context, actor Actor, id int64, requestedBy string) (*repository.EdgeAgent…`
- `method (*EdgeService) DetectOffline(ctx context.Context) (int64, error)`
- `method (*EdgeService) CleanupHeartbeats(ctx context.Context) (int64, error)`
- `method (*EdgeService) RunMaintenance(ctx context.Context, interval time.Duration)`
- `method (*EdgeService) requireCommandable(ctx context.Context, actor Actor, id int64) (*repository.EdgeAgentView, error)`
- `method (*EdgeService) allowed(ctx context.Context, actor Actor) ([]string, error)`

### `platform/modules/m09/service/edge_service_test.go`

- `func TestHeartbeatAutoRegistersAndUpdates(t *testing.T)`
- `func TestHeartbeatTargetsReplaceAndKeep(t *testing.T)`
- `func TestHeartbeatValidation(t *testing.T)`
- `func TestTokenValidator(t *testing.T)`
- `func TestAgentCommandsOfflineAndCleanup(t *testing.T)`
- `func TestHeartbeatReportsConfigChanged(t *testing.T)`
- `func TestAgentScopeNonAdmin(t *testing.T)`

### `platform/modules/m09/service/onboarding_service.go`

- `type Actor struct`
- `type Endpoint struct`
- `type InstallGuide struct`
- `type MonitorResult struct`
- `type ResetTokenResult struct`
- `type OnboardingService struct`
- `func NewOnboardingService(repo repository.OnboardingRepository, tenants repository.TenantReader) *OnboardingService`
- `method (*OnboardingService) List(ctx context.Context, actor Actor, filter repository.ListFilter) ([]repository.DomainOnboardin…`
- `method (*OnboardingService) Get(ctx context.Context, actor Actor, domainID string) (*repository.DomainOnboarding, error)`
- `method (*OnboardingService) Monitor(ctx context.Context, actor Actor, domainID string, ep Endpoint) (*MonitorResult, error)`
- `method (*OnboardingService) ResetToken(ctx context.Context, actor Actor, domainID string) (*ResetTokenResult, error)`
- `method (*OnboardingService) Unmonitor(ctx context.Context, actor Actor, domainID string) error`
- `method (*OnboardingService) Available() bool`
- `method (*OnboardingService) Impact(ctx context.Context, domainID string) (references.MonitoringImpact, error)`
- `method (*OnboardingService) RetireDomain(ctx context.Context, domainID string) error`
- `method (*OnboardingService) AllowedDomainIDs(ctx context.Context, actor Actor) ([]string, error)`
- `method (*OnboardingService) resolveAllowed(ctx context.Context, actor Actor) ([]string, error)`
- `func defaultInstallGuide() InstallGuide`

### `platform/modules/m09/service/onboarding_service_test.go`

- `func kindOf(err error) apierror.Kind`
- `func newTestStack(t *testing.T) (*gorm.DB, *service.OnboardingService, *repository.GORMRepository)`
- `func createDomain(t *testing.T, gormDB *gorm.DB, id string, status models.DomainStatus)`
- `func admin() service.Actor`
- `func TestMonitorIssuesTokenOnce(t *testing.T)`
- `func TestMonitorRejectsDuplicateAndDisabled(t *testing.T)`
- `func TestResetTokenRevokesOld(t *testing.T)`
- `func TestUnmonitorIsIdempotent(t *testing.T)`
- `func TestListScopesNonAdminAndAggregatesAgents(t *testing.T)`
- `func TestListAdminViewIncludesDisabledWithAdminFields(t *testing.T)`
- `func TestMonitoringRetirerCascades(t *testing.T)`

### `platform/modules/m09/service/package_service.go`

- `type PackageComponent struct`
- `type EdgePackage struct`
- `type PackageService struct`
- `func NewPackageService(dir string) *PackageService`
- `method (*PackageService) List(_ context.Context) ([]EdgePackage, error)`
- `method (*PackageService) Latest(_ context.Context) (*EdgePackage, error)`
- `method (*PackageService) Open(_ context.Context, file string) (*EdgePackage, *os.File, error)`
- `method (*PackageService) toPackage(artifact packageArtifact) EdgePackage`

### `platform/modules/m09/service/packages_local.go`

- `type packageComponent struct`
- `type packageArtifact struct`
- `func loadPackageManifest(dir string) (packageArtifact, error)`
- `func listPackages(dir string) ([]packageArtifact, error)`
- `func latestPackage(dir string) (packageArtifact, error)`
- `func openPackageFile(dir string, art packageArtifact) (*os.File, error)`

### `platform/modules/m09/service/promql.go`

- `func DomainMatcher(domains []string) string`
- `func InjectDomain(expr, matcher string) string`
- `func InjectMatcher(matchers []string, matcher string) []string`
- `func isIdentStart(ch byte) bool`
- `func isIdentPart(ch byte) bool`

### `platform/modules/m09/service/promql_test.go`

- `func TestInjectDomain(t *testing.T)`
- `func TestInjectDomainDoesNotTouchLabelNames(t *testing.T)`
- `func TestInjectMatcher(t *testing.T)`
- `func TestDomainMatcher(t *testing.T)`

### `platform/modules/m09/service/query_guard.go`

- `type GuardError struct`
- `method (*GuardError) Error() string`
- `func newGuardError(format string, args ...any) *GuardError`
- `func GuardQuery(path string, params url.Values) error`
- `func ValidateQueryLength(expr string) error`
- `func ValidateRangeWindow(startRaw, endRaw string) error`
- `func ValidateRangeParams(startRaw, endRaw, stepRaw string) error`
- `func parseQueryTime(raw string) (time.Time, bool)`
- `func parseQueryStep(raw string) (time.Duration, bool)`
- `func parsePrometheusDuration(raw string) (time.Duration, bool)`
- `func suggestQueryStep(span time.Duration) time.Duration`
- `func formatGuardDuration(d time.Duration) string`

### `platform/modules/m09/service/query_guard_test.go`

- `func TestValidateQueryLength(t *testing.T)`
- `func TestValidateRangeParams(t *testing.T)`
- `func TestValidateRangeWindow(t *testing.T)`
- `func TestGuardQuery(t *testing.T)`
- `func TestParseQueryStep(t *testing.T)`
- `func TestSuggestQueryStep(t *testing.T)`
- `func TestFormatGuardDuration(t *testing.T)`

### `platform/modules/m09/service/query_service.go`

- `type QueryMeta struct`
- `type CoverageCounts struct`
- `type CoverageItem struct`
- `type CoverageSummary struct`
- `type CoverageReport struct`
- `type UpstreamError struct`
- `method (*UpstreamError) Error() string`
- `method (*UpstreamError) Unwrap() error`
- `type QueryService struct`
- `func NewQueryService(promURL *url.URL, tenants repository.TenantReader, repo repository.QueryRepository) *QueryService`
- `method (*QueryService) AllowedDomains(ctx context.Context, actor Actor) ([]string, error)`
- `method (*QueryService) Targets(ctx context.Context, actor Actor, filter repository.TargetFilter) ([]repository.EdgeTargetRow, …`
- `method (*QueryService) Coverage(ctx context.Context, actor Actor) (CoverageCounts, error)`
- `method (*QueryService) CoverageReport(ctx context.Context, actor Actor, filter repository.CoverageFilter, state string, page, …`
- `func buildCoverageItem(resource repository.CoverageResourceRow, targets []repository.CoverageTargetRow, freshAfter time.Time…`
- `func healthPtr(value string) *string`
- `func summarizeCoverage(items []CoverageItem) CoverageSummary`
- `method (*QueryService) Proxy(ctx context.Context, actor Actor, path string, params url.Values) (int, []byte, QueryMeta, error)`
- `func filterAlerts(body []byte, allowed []string) []byte`
- `func cloneValues(values url.Values) url.Values`

### `platform/modules/m09/service/query_service_test.go`

- `func TestQueryTargetsAndCoverage(t *testing.T)`
- `func TestQueryProxyInjectsDomainMatcher(t *testing.T)`
- `func TestQueryProxyFiltersAlerts(t *testing.T)`
- `func TestQueryProxyGuardRejectsBeforeUpstream(t *testing.T)`
- `func TestQueryProxyCoversAllAuthorizedDomains(t *testing.T)`
- `func TestQueryProxyTimeoutMarksUpstreamError(t *testing.T)`
- `func TestQueryProxyUnreachableIsUpstreamError(t *testing.T)`

### `platform/modules/m09/service/snapshot_retention.go`

- `func snapshotRetentionDays() int`
- `func snapshotDayLocation() *time.Location`
- `func normalizeSnapshotRetention(days int) int`

### `platform/modules/m09/service/token_validator.go`

- `type TokenValidator struct`
- `func NewTokenValidator(repo repository.EdgeRepository) *TokenValidator`
- `method (*TokenValidator) Validate(ctx context.Context, token string) (string, bool)`

### `platform/modules/m09/storage/content_store.go`

- `type ContentStore struct`
- `func NewContentStore(root string) *ContentStore`
- `type Payload struct`
- `method (*ContentStore) WriteArtifacts(domainID, version string, artifacts *configgen.Artifacts) (string, error)`
- `method (*ContentStore) Read(domainID, version string) ([]byte, error)`
- `method (*ContentStore) ReadPayload(domainID, version string) (*Payload, error)`
- `method (*ContentStore) Exists(domainID, version string) bool`
- `method (*ContentStore) WriteRaw(domainID, version string, payload []byte) (string, error)`
- `method (*ContentStore) BuildZip(domainID, version string) ([]byte, error)`
- `method (*ContentStore) Delete(domainID, version string) error`
- `method (*ContentStore) path(domainID, version string) (string, error)`
- `func safeSegment(value string) (string, error)`

### `platform/testutil/testdb/testdb.go`

- `type testDB struct`
- `func MigrateDriver() string`
- `func DSN(t *testing.T) string`
- `func Open(t *testing.T) *gorm.DB`
- `func stateFor(t *testing.T) *testDB`
- `func requireBaseDSN(t *testing.T) string`
- `func newPostgresSchema(t *testing.T) (dsn, schema string)`
- `func currentUser() string`
- `func setupPostgres(t *testing.T, baseDSN string) (dsn, schema string)`
- `func withSearchPath(dsn, schema string) string`
- `func quoteIdent(s string) string`
- `func randomSuffix() string`

### `platform/testutil/testdb/testdb_test.go`

- `type widget struct`
- `func exerciseCRUD(t *testing.T, db *gorm.DB)`
- `func TestOpenAppliesMigrationsAndIsStable(t *testing.T)`
- `func TestOpenIsolatesSchemasAndCleansUp(t *testing.T)`
- `func schemaFromDSN(t *testing.T, dsn string) string`

## ui-custom/web/src/（React 前端）

### `ui-custom/web/src/App.tsx`

- `function RequireAuth`

### `ui-custom/web/src/SkinProvider.tsx`

- `function SkinProvider`

### `ui-custom/web/src/api/admin.ts`

- `interface UsersListParams`
- `interface LoginLogsListParams`
- `interface TenantsListParams`
- `const userApi`
- `const loginLogApi`
- `const tenantAdminApi`

### `ui-custom/web/src/api/alertmanager.ts`

- `function flattenWireRouteTree`
- `function nestEditRouteTree`
- `function readValidateErrors`
- `interface AlertmanagerListParams`
- `interface EffectiveAlertmanagerYaml`
- `const alertmanagerConfigApi`
- `const alertmanagerSilenceApi`
- `interface AlertStatusQuery`
- `const ALERT_HISTORY_STEP_SECONDS`
- `interface AlertHistoryQuery`
- `interface AlertEventQuery`
- `const alertStatusApi`
- `const notifyChannelsApi`
- `const notifyTemplatesApi`
- `const alertmanagerRoutesApi`

### `ui-custom/web/src/api/attributes.ts`

- `const ciModelApi`
- `const attributeDefinitionApi`
- `const resourceAttributeApi`

### `ui-custom/web/src/api/auth.ts`

- `const LOGOUT_ENDPOINT`
- `function logout`

### `ui-custom/web/src/api/blackboxModules.ts`

- `interface BlackboxModule`
- `interface BlackboxModuleInput`
- `const blackboxModuleApi`

### `ui-custom/web/src/api/client.ts`

- `function getToken`
- `function setToken`
- `function clearToken`
- `function setStoredUser`
- `function getStoredUser`
- `function setUnauthorizedNavigate`
- `class ApiError`
- `function isApiError`
- `function rawRequest`
- `function request`
- `const apiClient`

### `ui-custom/web/src/api/collectionTemplates.ts`

- `interface CollectionTemplateListParams`
- `const collectionTemplateApi`
- `const candidateFieldApi`

### `ui-custom/web/src/api/configCenter.ts`

- `interface ConfigListParams`
- `const networkDomainMonitorApi`
- `const configSnapshotApi`
- `interface ConfigArtifactListParams`
- `const CONFIG_SYNC_TRIGGER_PATH`
- `const configSyncTriggerApi`
- `const configArtifactApi`

### `ui-custom/web/src/api/coverage.ts`

- `interface CoverageListParams`
- `const coverageApi`

### `ui-custom/web/src/api/dashboard.ts`

- `interface SubtypeSummary`
- `interface CategorySummary`
- `interface AppSummary`
- `interface ProbeTargetItem`
- `interface CloudSummary`
- `interface CollectionHealth`
- `interface PlatformAppCell`
- `interface PlatformAppSummary`
- `interface DashboardSummary`
- `const dashboardApi`

### `ui-custom/web/src/api/dashboardPanels.ts`

- `interface DashboardPanel`
- `interface DashboardPanelList`
- `interface DashboardPanelCreateInput`
- `interface DashboardPanelListParams`
- `const dashboardPanelApi`

### `ui-custom/web/src/api/domain.ts`

- `interface ListParams`
- `interface NetworkDomainCreateInput`
- `interface NetworkDomainUpdateInput`
- `const networkDomainApi`
- `function resolveNetworkDomainImpact`
- `const tenantApi`

### `ui-custom/web/src/api/edgeAgents.ts`

- `interface EdgeAgentsListParams`
- `const edgeAgentsApi`

### `ui-custom/web/src/api/edgePackages.ts`

- `const edgePackageApi`

### `ui-custom/web/src/api/exporterTemplates.ts`

- `interface ExporterTemplateListParams`
- `interface ExporterTemplateInput`
- `interface ExporterTemplateUpdateInput`
- `const exporterTemplateApi`

### `ui-custom/web/src/api/inhibitions.ts`

- `const inhibitionsApi`

### `ui-custom/web/src/api/jobGroups.ts`

- `interface CandidateFilterPayload`
- `interface CandidateQueryPayload`
- `interface CandidateIdsPayload`
- `type JobGroupSaveInput`
- `const jobGroupApi`

### `ui-custom/web/src/api/labelTemplates.ts`

- `interface LabelTemplateListParams`
- `const labelTemplateApi`

### `ui-custom/web/src/api/metricLibrary.ts`

- `interface MetricLibraryListParams`
- `interface MetricLibraryInput`
- `interface MetricLibraryUpdateInput`
- `const metricLibraryApi`

### `ui-custom/web/src/api/monitoringRules.ts`

- `interface MonitoringRuleListParams`
- `interface MonitoringRuleInput`
- `type PromQLCheckStatus`
- `interface PromQLCheckResult`
- `interface JobRefIssue`
- `interface YamlValidationResult`
- `interface RuleLabelInfo`
- `interface RuleInspectResult`
- `const monitoringRuleApi`

### `ui-custom/web/src/api/query.ts`

- `interface QueryRequestOptions`
- `interface PromQueryParams`
- `interface PromQueryRangeParams`
- `interface PromLabelValuesParams`
- `const queryApi`

### `ui-custom/web/src/api/resources.ts`

- `interface ResourceListParams`
- `interface V3ResourceResponse`
- `interface ResourceLabelsResponse`
- `interface ResourceReferenceJob`
- `interface ResourceReferenceResponse`
- `interface ResourceLabelCreateInput`
- `interface ResourceLabelUpdateInput`
- `interface BusinessDomainsResponse`
- `interface ImportListParams`
- `function v3ResourceToListItem`
- `function buildV3Attributes`
- `interface V3ResourceWritePayload`
- `function toV3ResourcePayload`
- `const resourceApi`
- `interface BusinessDomainCreateInput`
- `interface BusinessDomainUpdateInput`
- `const businessDomainApi`
- `interface DictionaryMergeInput`
- `interface DictionaryMergeResult`
- `interface DictionaryAuditLogsResponse`
- `const dictionaryAuditApi`
- `interface ApplicationDictsResponse`
- `interface ApplicationDictCreateInput`
- `interface ApplicationDictUpdateInput`
- `const applicationDictApi`
- `interface PlatformDictsResponse`
- `interface PlatformDictCreateInput`
- `interface PlatformDictUpdateInput`
- `const platformDictApi`
- `interface AppPlatformRelListParams`
- `interface AppPlatformRelsResponse`
- `interface AppPlatformRelCreateInput`
- `interface AppPlatformRelUpdateInput`
- `const appPlatformRelApi`
- `interface CloudDictsResponse`
- `interface CloudDictCreateInput`
- `const cloudDictApi`
- `const osOptionApi`
- `const importApi`

### `ui-custom/web/src/api/scrapeJobs.ts`

- `interface ScrapeJobListParams`
- `interface ScrapeJobMappingOverrideInput`
- `interface ScrapeJobInput`
- `interface InstanceCandidateListParams`
- `interface ScrapeJobInstancesResponse`
- `interface ConfirmInstanceInput`
- `interface PreviewTargetsResult`
- `const scrapeJobApi`

### `ui-custom/web/src/api/storage.ts`

- `const storageLogApi`

### `ui-custom/web/src/api/strategyV3.ts`

- `type ListParams`
- `interface ExporterTemplateInputV3`
- `const exporterTemplateApiV3`
- `interface JobInputV3`
- `interface ScrapeJobListParamsV3`
- `interface CandidateParamsV3`
- `interface InstallationInputV3`
- `const scrapeJobApiV3`
- `interface RuleInputV3`
- `interface RuleValidationRequestV3`
- `const ruleApiV3`
- `interface MetricInputV3`
- `const metricApiV3`
- `interface BusinessMetricInputV3`
- `const businessMetricApiV3`
- `interface ProbeModuleInputV3`
- `const probeModuleApiV3`

### `ui-custom/web/src/api/targets.ts`

- `interface TargetsListParams`
- `const targetsApi`

### `ui-custom/web/src/components/Callout.tsx`

- `function Callout`

### `ui-custom/web/src/components/EllipsisText.tsx`

- `function EllipsisText`

### `ui-custom/web/src/components/FilterBar.tsx`

- `function FilterBar`
- `function FilterItem`

### `ui-custom/web/src/components/FormSection.tsx`

- `function FormSection`

### `ui-custom/web/src/components/LoadingPlaceholder.tsx`

- `function LoadingPlaceholder`

### `ui-custom/web/src/components/MonitorStatusBadge.tsx`

- `function MonitorStatusBadge`

### `ui-custom/web/src/components/PageIntro.tsx`

- `const PAGE_INTRO_GUIDE_TITLE`
- `const PAGE_INTRO_GUIDE_HINT`
- `interface PageIntroProps`
- `function PageIntro`

### `ui-custom/web/src/components/ResizableHeaderCell.tsx`

- `interface ResizableHeaderCellProps`
- `function ResizableHeaderCell`

### `ui-custom/web/src/components/RuleGuideLink.tsx`

- `const RULES_PATH`
- `const RULE_GUIDE_TEXT`
- `const RULE_GUIDE_PREFIX`
- `function RuleGuideLink`
- `function RuleGuideEmpty`

### `ui-custom/web/src/components/tablePresets.ts`

- `const TABLE_SCROLL_X`
- `const MIN_COLUMN_WIDTH`
- `const MAX_COLUMN_WIDTH`
- `const DEFAULT_COLUMN_WIDTH`
- `const ROW_SELECTION_COLUMN_WIDTH`
- `const TABLE_PAGINATION`

### `ui-custom/web/src/layouts/MainLayout.tsx`

- `function MainLayout`

### `ui-custom/web/src/layouts/siderPreference.ts`

- `const SIDER_COLLAPSED_KEY`
- `const SIDER_WIDTH`
- `const SIDER_COLLAPSED_WIDTH`
- `function readSiderCollapsed`
- `function writeSiderCollapsed`

### `ui-custom/web/src/pages/admin/appearance/AppearanceSettingsPage.tsx`

- `function AppearanceSettingsPage`

### `ui-custom/web/src/pages/admin/clouddict/CloudDictPage.tsx`

- `function CloudDictPage`

### `ui-custom/web/src/pages/admin/dashboard-panels/DashboardPanelFormModal.tsx`

- `function DashboardPanelFormModal`

### `ui-custom/web/src/pages/admin/dashboard-panels/DashboardPanelsPage.tsx`

- `function DashboardPanelsPage`

### `ui-custom/web/src/pages/admin/domains/DeleteDomainModal.tsx`

- `function DeleteDomainModal`

### `ui-custom/web/src/pages/admin/domains/DisableDomainModal.tsx`

- `function DisableDomainModal`

### `ui-custom/web/src/pages/admin/domains/DomainForm.tsx`

- `function DomainDrawer`

### `ui-custom/web/src/pages/admin/domains/DomainsPage.tsx`

- `function DomainsPage`

### `ui-custom/web/src/pages/admin/domains/useDomains.ts`

- `type DomainFilters`
- `interface UseDomainsResult`
- `function useDomains`

### `ui-custom/web/src/pages/admin/login-logs/LoginLogsPage.tsx`

- `function LoginLogsPage`

### `ui-custom/web/src/pages/admin/login-logs/useLoginLogs.ts`

- `interface LoginLogFilters`
- `interface UseLoginLogsResult`
- `function useLoginLogs`

### `ui-custom/web/src/pages/admin/storagelog/StorageLogPage.tsx`

- `function StorageLogPage`

### `ui-custom/web/src/pages/admin/tenants/TenantDetailDrawer.tsx`

- `function TenantDetailDrawer`

### `ui-custom/web/src/pages/admin/tenants/TenantEditModal.tsx`

- `function TenantEditModal`

### `ui-custom/web/src/pages/admin/tenants/TenantsPage.tsx`

- `function TenantsPage`

### `ui-custom/web/src/pages/admin/tenants/useTenants.ts`

- `interface TenantFilters`
- `interface UseTenantsResult`
- `function useTenants`

### `ui-custom/web/src/pages/admin/users/ResetPasswordModal.tsx`

- `function ResetPasswordModal`

### `ui-custom/web/src/pages/admin/users/UserFormModal.tsx`

- `function UserFormModal`

### `ui-custom/web/src/pages/admin/users/UsersPage.tsx`

- `function UsersPage`

### `ui-custom/web/src/pages/admin/users/useUsers.ts`

- `interface UseUsersResult`
- `function useUsers`

### `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`

- `function AlertConfigPage`

### `ui-custom/web/src/pages/alerts/AlertStatusPage.tsx`

- `function AlertStatusPage`

### `ui-custom/web/src/pages/alerts/CreateSilenceDrawer.tsx`

- `interface CreateSilenceDrawerProps`
- `function CreateSilenceDrawer`

### `ui-custom/web/src/pages/alerts/HistoryAlertsPage.tsx`

- `function HistoryAlertsPage`

### `ui-custom/web/src/pages/alerts/InhibitionEditorDrawer.tsx`

- `function InhibitionEditorDrawer`

### `ui-custom/web/src/pages/alerts/InhibitionsPage.tsx`

- `function InhibitionsPage`

### `ui-custom/web/src/pages/alerts/NotifyChannelDrawer.tsx`

- `interface NotifyChannelDrawerProps`
- `function NotifyChannelDrawer`

### `ui-custom/web/src/pages/alerts/NotifyChannelsPage.tsx`

- `function NotifyChannelsPage`

### `ui-custom/web/src/pages/alerts/NotifyTemplateDrawer.tsx`

- `interface NotifyTemplateInitial`
- `interface NotifyTemplateDrawerProps`
- `function NotifyTemplateDrawer`

### `ui-custom/web/src/pages/alerts/NotifyTemplatesPage.tsx`

- `function NotifyTemplatesPage`

### `ui-custom/web/src/pages/alerts/RouteEditorDrawer.tsx`

- `interface RouteEditorParentOption`
- `interface RouteEditorDrawerProps`
- `function RouteEditorDrawer`

### `ui-custom/web/src/pages/alerts/RoutesPage.tsx`

- `function RoutesPage`

### `ui-custom/web/src/pages/alerts/SilencesPage.tsx`

- `function SilencesPage`

### `ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`

- `const CURRENT_USER`
- `const ROUTES_PATH`
- `const DEFAULT_RECEIVER_LABEL`
- `const silenceStatusLabel`
- `const silenceStatusColor`
- `type ValidateSection`
- `const validateSectionLabel`
- `const validateSectionColor`
- `function partitionValidateErrors`
- `function formatMatchers`
- `const notifyStatusLabel`
- `const notifyStatusColor`
- `const notifyStatusTip`
- `const promAlertStateLabel`
- `const promAlertStateColor`
- `function severityLabel`
- `function severityColor`
- `type SeverityTone`
- `function severityBg`
- `function severityText`
- `function severityTone`
- `const alertHistoryStateLabel`
- `function alertMatchKey`
- `const alertHistoryStateColor`
- `const alertEventStatusLabel`
- `const alertEventStatusColor`
- `const ALERT_CONFIG_PATH`
- `const NOTIFY_CHANNELS_PATH`
- `const NOTIFY_TEMPLATES_PATH`
- `const notifyChannelTypeLabel`
- `const notifyChannelTypeColor`
- `const NOTIFY_CHANNEL_TYPE_OPTIONS`
- `const TEMPLATE_CHANNEL_TYPE_OPTIONS`
- `const NOTIFY_TEMPLATE_BUILTIN_TIP`

### `ui-custom/web/src/pages/alerts/historyAlertExport.ts`

- `function alertEventsToCSV`
- `function downloadAlertEvents`

### `ui-custom/web/src/pages/alerts/routeLabels.ts`

- `const ROUTE_LABEL_OPTION_LIMIT`
- `interface RouteLabelOption`
- `function flattenRouteLabelOptions`
- `function filterRouteLabelOptions`
- `function isRouteLabelClipped`
- `function toRouteLabelSelectOptions`
- `function useRouteLabelOptions`

### `ui-custom/web/src/pages/alerts/routeTree.ts`

- `const ROUTE_ROOT_ID`
- `const DEFAULT_RECEIVER_NAME`
- `const ROUTE_NAME_COMMENT_PREFIX`
- `type RouteIssueLevel`
- `const ROUTE_ISSUE_CODES`
- `const ROUTE_NODE_ISSUE_CODES`
- `interface RouteIssue`
- `function parseRouteDuration`
- `interface RouteNodeValidationContext`
- `function validateRouteNode`
- `function validateRouteTree`
- `function validateRouteNodeFields`
- `function validateRouteReceivers`
- `function hasBlockingIssue`
- `function fromRouteNodes`
- `function emptyRouteTree`
- `function blankRouteNode`
- `function nextRouteId`
- `function flattenRouteTree`
- `function countDescendants`
- `function collectSubtreeIds`
- `function removeSubtree`
- `function reorderSibling`
- `function moveSibling`
- `function upsertNode`
- `function canBeParent`
- `function matcherShorthand`
- `function generateRouteSection`
- `function mergeRouteSection`

### `ui-custom/web/src/pages/alerts/useAlertConfig.ts`

- `interface LastReload`
- `interface UseAlertConfigResult`
- `function useAlertConfig`

### `ui-custom/web/src/pages/alerts/useAlertStatus.ts`

- `interface AlertViewState`
- `interface DomainOption`
- `type OpenAlertStatus`
- `type CurrentAlertStatusFilter`
- `interface CurrentAlertsQuery`
- `interface CurrentAlertsResult`
- `const CURRENT_ALERTS_PAGE_SIZE`
- `function currentAlertParams`
- `function useCurrentAlerts`
- `interface OpenAlertStats`
- `interface OpenAlertStatsState`
- `function useOpenAlertStats`
- `function usePromAlerts`
- `function useNetworkDomains`

### `ui-custom/web/src/pages/alerts/useHistoryAlerts.ts`

- `interface HistoryAlertsQuery`
- `interface HistoryAlertsResult`
- `interface DomainOption`
- `function useHistoryAlerts`
- `function useNetworkDomains`
- `function defaultTimeRange`
- `function historyAlertParams`

### `ui-custom/web/src/pages/alerts/useNotifyChannels.ts`

- `interface UseNotifyChannelsResult`
- `function useNotifyChannels`

### `ui-custom/web/src/pages/alerts/useNotifyTemplates.ts`

- `interface UseNotifyTemplatesResult`
- `function useNotifyTemplates`

### `ui-custom/web/src/pages/alerts/useRoutes.ts`

- `interface RouteRow`
- `function buildTreeRows`
- `interface UseRoutesResult`
- `function buildRouteRows`
- `function buildEditRows`
- `function useRoutes`
- `type RouteImportState`
- `interface UseRouteEditorOptions`
- `interface UseRouteEditorResult`
- `function useRouteEditor`

### `ui-custom/web/src/pages/alerts/useSilences.ts`

- `interface UseSilencesResult`
- `interface SilenceQuery`
- `function useSilences`

### `ui-custom/web/src/pages/config-center/configCenterConstants.ts`

- `const CURRENT_USER`
- `const TOKEN_MASK`
- `const TOKEN_USER_GUIDE`
- `const TOKEN_CREDENTIAL_TIP`
- `const channelLabel`
- `const channelTip`
- `const channelColor`
- `const agentTypeLabel`
- `const DOMAIN_FIELD_TIP`
- `function deriveRegistrationStatus`
- `const registrationStatusLabel`
- `const registrationStatusColor`
- `const monitoredStatusLabel`
- `const monitoredStatusColor`
- `const draftStatusLabel`
- `const draftStatusColor`
- `const validationLabel`
- `const validationColor`
- `const riskLabel`
- `const riskColor`
- `const changeTypeLabel`
- `const changeTypeColor`
- `const changeTargetLabel`
- `const affectedFileLabel`
- `const affectedFileColor`
- `const deploymentStatusLabel`
- `const deploymentStatusColor`
- `function highestRisk`
- `function formatRelativeTime`
- `function formatLocalTime`
- `function formatLocalDate`

### `ui-custom/web/src/pages/config-center/domains/EdgePackageDownloadPanel.tsx`

- `function EdgePackageDownloadPanel`

### `ui-custom/web/src/pages/config-center/domains/NetworkDomainDetailDrawer.tsx`

- `function NetworkDomainDetailDrawer`

### `ui-custom/web/src/pages/config-center/domains/NetworkDomainsPage.tsx`

- `function NetworkDomainsPage`

### `ui-custom/web/src/pages/config-center/domains/OnboardDomainDrawer.tsx`

- `function OnboardDomainDrawer`

### `ui-custom/web/src/pages/config-center/domains/PlainTokenModal.tsx`

- `function PlainTokenModal`

### `ui-custom/web/src/pages/config-center/domains/useNetworkDomains.ts`

- `interface UseNetworkDomainsResult`
- `function useNetworkDomains`

### `ui-custom/web/src/pages/config-center/nodes/EdgeAgentDrawer.tsx`

- `function EdgeAgentDrawer`

### `ui-custom/web/src/pages/config-center/nodes/EdgeAgentsPage.tsx`

- `function EdgeAgentsPage`

### `ui-custom/web/src/pages/config-center/nodes/edgeConstants.ts`

- `const agentStatusLabel`
- `const agentStatusBadgeStatus`
- `const agentOverallLabel`
- `const configSyncStatusLabel`
- `type ConfigSyncBadgeStatus`
- `const configSyncStatusBadgeStatus`
- `function isConfigSyncInProgress`
- `function isConfigSyncApplyFailed`
- `function configSyncDisplayLabel`
- `function configSyncDisplayBadgeStatus`
- `const outOfSyncCauseHint`
- `const outOfSyncCauseAction`
- `const componentTypeLabel`
- `const componentStatusLabel`
- `const componentStatusColor`
- `const HIGH_RISK_COMPONENT_STATUS`
- `function formatBacklogBytes`
- `const BACKLOG_AGE_TOOLTIP`
- `function formatBacklogAge`
- `function formatBacklogGrowth`
- `function channelStatusLabel`
- `function channelStatusBadge`
- `const CHANNEL_STATUS_TOOLTIP`
- `function compareVersions`
- `function latestPackageVersion`

### `ui-custom/web/src/pages/config-center/nodes/useEdgeAgents.ts`

- `interface EdgeFilters`
- `interface UseEdgeAgentsResult`
- `function useEdgeAgents`

### `ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx`

- `function ConfigPreviewPage`

### `ui-custom/web/src/pages/config-center/preview/SnapshotDetailDrawer.tsx`

- `function SnapshotDetailDrawer`

### `ui-custom/web/src/pages/config-center/preview/snapshotHelpers.ts`

- `const ARTIFACT_TYPE_LABEL`
- `const ARTIFACT_TYPE_COLOR`
- `const SNAPSHOT_STATUS_LABEL`
- `const SNAPSHOT_STATUS_COLOR`
- `const SNAPSHOT_CAUSE_LABEL`
- `const SNAPSHOT_GENERATOR_LABEL`
- `const SNAPSHOT_RETENTION_TIP`
- `function validationDetailsText`
- `function sortSnapshotsNewestFirst`

### `ui-custom/web/src/pages/config-center/preview/triggerConfigDraft.ts`

- `const CONFIG_PREVIEW_PATH`
- `interface TriggerDraftOptions`
- `function triggerConfigDrafts`
- `function triggerConfigDraftsForAllDomains`

### `ui-custom/web/src/pages/config-center/preview/useConfigArtifacts.ts`

- `interface ArtifactLoadFailure`
- `interface UseConfigArtifactsOptions`
- `interface UseConfigArtifactsResult`
- `function useConfigArtifacts`

### `ui-custom/web/src/pages/config-center/preview/useConfigSnapshots.ts`

- `interface SnapshotDomainFailure`
- `interface UseConfigSnapshotsOptions`
- `interface UseConfigSnapshotsResult`
- `function fetchMonitoredDomains`
- `function useConfigSnapshots`

### `ui-custom/web/src/pages/dashboard/DashboardFrame.tsx`

- `function DashboardFrame`

### `ui-custom/web/src/pages/dashboard/DashboardPanelPage.tsx`

- `function DashboardPanelPage`

### `ui-custom/web/src/pages/dashboard/kioskEvents.ts`

- `function attachKioskEventGuards`

### `ui-custom/web/src/pages/dashboard/kioskUrl.ts`

- `function buildKioskURL`

### `ui-custom/web/src/pages/home/AlertStatusCard.tsx`

- `interface AlertCounts`
- `const LATEST_ALERT_TITLE`
- `function AlertStatStrip`
- `function AlertRow`
- `function AlertStatusCard`

### `ui-custom/web/src/pages/home/CloudDistributionPanel.tsx`

- `function CloudDistributionPanel`

### `ui-custom/web/src/pages/home/CollectionHealthPanel.tsx`

- `function CollectionHealthPanel`

### `ui-custom/web/src/pages/home/CoverageDonut.tsx`

- `function CoverageDonut`

### `ui-custom/web/src/pages/home/HomePage.tsx`

- `function HomePage`

### `ui-custom/web/src/pages/home/OnboardingSteps.tsx`

- `function OnboardingSteps`

### `ui-custom/web/src/pages/home/PlatformAppMatrixPanel.tsx`

- `function PlatformAppMatrixPanel`

### `ui-custom/web/src/pages/home/ProbeHealthDonut.tsx`

- `function ProbeHealthDonut`

### `ui-custom/web/src/pages/home/ProbePanel.tsx`

- `function ProbePanel`

### `ui-custom/web/src/pages/home/ResourceTypeGrid.tsx`

- `function ResourceTypeGrid`

### `ui-custom/web/src/pages/home/SurfaceCard.tsx`

- `function SurfaceCard`

### `ui-custom/web/src/pages/home/TableHeaderText.tsx`

- `function TableHeaderText`

### `ui-custom/web/src/pages/home/homeDonut.ts`

- `const DONUT_GEOMETRY`
- `const DONUT_CIRCUMFERENCE`

### `ui-custom/web/src/pages/home/homePanelVisibility.ts`

- `const RESOURCE_PANELS_COLLAPSED_KEY`
- `function readResourcePanelsCollapsed`
- `function writeResourcePanelsCollapsed`

### `ui-custom/web/src/pages/home/homeResponsive.ts`

- `const NARROW_LAYOUT_QUERY`
- `function useNarrowLayout`

### `ui-custom/web/src/pages/home/homeTypography.ts`

- `const HOME_FONT`
- `const HOME_WEIGHT`

### `ui-custom/web/src/pages/home/resourceTypeMeta.ts`

- `type ResourceCategoryKey`
- `const L1_CATEGORY_ORDER`
- `const L1_CATEGORY_META`
- `const SUBTYPE_COVERAGE_WARN_THRESHOLD`
- `function coveragePercent`
- `function coverageText`
- `function uncoveredCount`

### `ui-custom/web/src/pages/label-templates/LabelTemplatesPage.tsx`

- `function LabelTemplatesPage`

### `ui-custom/web/src/pages/label-templates/MappingDrawer.tsx`

- `function MappingDrawer`

### `ui-custom/web/src/pages/label-templates/TemplateDetailTabs.tsx`

- `function TemplateDetailTabs`

### `ui-custom/web/src/pages/label-templates/TemplateList.tsx`

- `type TemplateFilter`
- `function TemplateList`

### `ui-custom/web/src/pages/label-templates/labelTemplateConstants.ts`

- `const RESOURCE_TYPE_MAP`
- `const SOURCE_TYPE_LABEL`
- `const SOURCE_TYPE_COLOR`
- `const MAPPING_SOURCE_TYPE_OPTIONS`
- `const TRANSFORM_OPTIONS`
- `const TRANSFORM_LABELS`
- `const PROTECTED_PROMETHEUS_LABELS`
- `const RESOURCE_FIELD_OPTIONS`
- `const COMPOSITE_OPTIONS`
- `const CMDB_FIELD_OPTIONS`
- `const PROMETHEUS_BUILTIN_OPTIONS`

### `ui-custom/web/src/pages/login/LoginPage.tsx`

- `function LoginPage`

### `ui-custom/web/src/pages/query/QueryPage.tsx`

- `function QueryPage`

### `ui-custom/web/src/pages/query/TargetStatusPage.tsx`

- `function TargetStatusPage`

### `ui-custom/web/src/pages/query/TimeSeriesChart.tsx`

- `interface TimeSeriesChartProps`
- `function TimeSeriesChart`

### `ui-custom/web/src/pages/query/chartOption.ts`

- `const SERIES_COLORS`
- `function formatChartValue`
- `function buildChartOption`

### `ui-custom/web/src/pages/query/queryRange.ts`

- `const QUICK_RANGES`
- `type QuickRangeValue`
- `const DEFAULT_QUERY`
- `const DEFAULT_RANGE_SECONDS`
- `const MIN_STEP_SECONDS`
- `const MAX_QUERY_POINTS`
- `const MAX_QUERY_LENGTH`
- `const TARGET_QUERY_POINTS`
- `const QUERY_PRESETS`
- `type QueryPresetValue`
- `interface ChartSeries`
- `interface SeriesStats`
- `interface QueryState`
- `function niceStep`
- `function computeStep`
- `function resolveQuickRange`
- `function matchQuickRange`
- `function toGrid`
- `function summarizeSeries`
- `function formatLabels`
- `function promqlString`
- `function parseBareMetric`
- `function buildSelector`
- `function parseQueryState`
- `function buildQuerySearch`
- `function isAbortError`
- `function queryLengthBytes`

### `ui-custom/web/src/pages/resources/ApplicationDictPage.tsx`

- `function ApplicationDictPage`
- `function ApplicationDictDrawer`

### `ui-custom/web/src/pages/resources/BulkReassignModal.tsx`

- `interface BulkReassignModalProps`
- `function BulkReassignModal`

### `ui-custom/web/src/pages/resources/BusinessDomainDrawer.tsx`

- `interface BusinessDomainDrawerProps`
- `function BusinessDomainDrawer`

### `ui-custom/web/src/pages/resources/BusinessDomainPage.tsx`

- `function BusinessDomainPage`

### `ui-custom/web/src/pages/resources/CIModelPage.tsx`

- `function CIModelPage`

### `ui-custom/web/src/pages/resources/DeleteResourceConfirm.tsx`

- `function DeleteResourceConfirm`

### `ui-custom/web/src/pages/resources/DictLifecycleNotice.tsx`

- `const DICT_LIFECYCLE_NOTICE`
- `interface DictLifecycleNoticeProps`
- `function DictLifecycleNotice`

### `ui-custom/web/src/pages/resources/DictionaryLifecycleActions.tsx`

- `function DictionaryStatusBadge`
- `function DictionaryRevokeButton`
- `interface DictionaryMergeOption`
- `function DictionaryMergeButton`
- `function DictionaryAuditDrawer`

### `ui-custom/web/src/pages/resources/ImportModal.tsx`

- `function ImportModal`

### `ui-custom/web/src/pages/resources/ImportRecordsPanel.tsx`

- `function ImportRecordsPanel`

### `ui-custom/web/src/pages/resources/PlatformManagementPage.tsx`

- `function PlatformManagementPage`
- `function PlatformAppsDrawer`
- `function PlatformDictDrawer`

### `ui-custom/web/src/pages/resources/ResourceAttributesDrawer.tsx`

- `function ResourceAttributesDrawer`

### `ui-custom/web/src/pages/resources/ResourceCategoryTabs.tsx`

- `interface ResourceCategoryTabsProps`
- `function ResourceCategoryTabs`

### `ui-custom/web/src/pages/resources/ResourceDetailDrawer.tsx`

- `function ResourceDetailDrawer`

### `ui-custom/web/src/pages/resources/ResourceFilterBar.tsx`

- `interface ResourceFilterBarProps`
- `function ResourceFilterBar`

### `ui-custom/web/src/pages/resources/ResourceFormDrawer.tsx`

- `function ResourceFormDrawer`

### `ui-custom/web/src/pages/resources/ResourceLabelsTab.tsx`

- `interface ResourceLabelsTabProps`
- `function ResourceLabelsTab`

### `ui-custom/web/src/pages/resources/ResourceListAlerts.tsx`

- `interface ResourceListAlertsProps`
- `function ResourceListAlerts`

### `ui-custom/web/src/pages/resources/ResourceTable.tsx`

- `interface ResourceColumnFilters`
- `interface ResourceTableProps`
- `function ResourceTable`

### `ui-custom/web/src/pages/resources/ResourcesPage.tsx`

- `function ResourcesPage`

### `ui-custom/web/src/pages/resources/TemplateDownloadModal.tsx`

- `function TemplateDownloadModal`

### `ui-custom/web/src/pages/resources/dictionaryLifecycle.ts`

- `const DICTIONARY_STATUS_LABEL`
- `const DICTIONARY_ACTIVE_STATUSES`
- `const DICTIONARY_STATUS_BADGE`
- `function dictionaryStatusOf`
- `function isDictionaryTerminal`
- `const DICT_LIFECYCLE_RULES`
- `function dictionaryNameSuffix`

### `ui-custom/web/src/pages/resources/dictionaryRules.ts`

- `const BIZ_CODE_PATTERN`

### `ui-custom/web/src/pages/resources/resourceColumnPrefs.ts`

- `type ResourceColumnGroup`
- `const COLUMN_GROUP_ORDER`
- `interface ResourceColumnMeta`
- `const RESOURCE_COLUMN_META`
- `const FIXED_COLUMN_KEYS`
- `const DEFAULT_VISIBLE_COLUMN_KEYS`
- `const COLUMN_DEFAULT_WIDTHS`
- `function defaultColumnWidth`
- `function columnPrefStorageKey`
- `function orderColumnKeys`
- `function loadVisibleColumnKeys`
- `function saveVisibleColumnKeys`
- `type ResourceColumnWidths`
- `function resetVisibleColumnKeys`
- `function isDefaultVisibleColumnKeys`

### `ui-custom/web/src/pages/resources/resourceColumns.tsx`

- `interface ResourceColumnContext`
- `function buildResourceColumns`

### `ui-custom/web/src/pages/resources/resourceExport.ts`

- `function resourcesToCSV`
- `function downloadResources`

### `ui-custom/web/src/pages/resources/resourceFieldSchema.ts`

- `const FIELD_GROUP_ORDER`
- `const FIELD_GROUP_LABEL`
- `interface BuiltinFieldMeta`
- `const BUILTIN_FIELD_SCHEMA`
- `function builtinFieldKeys`
- `function groupBuiltinFields`

### `ui-custom/web/src/pages/resources/resourceFilterOptions.ts`

- `const STATUS_FILTER_OPTIONS`
- `const MONITOR_STATE_FILTER_OPTIONS`

### `ui-custom/web/src/pages/resources/resourceFormFields.tsx`

- `const optionalPortRules`
- `interface ResourceFormFieldsContext`
- `function renderResourceSharedFields`
- `function renderResourceTypeFields`
- `function renderResourceExtensionAttributes`

### `ui-custom/web/src/pages/resources/resourceFormMappers.ts`

- `const ENV_VALUES`
- `function buildCreateInput`
- `function buildUpdateInput`
- `function buildTypeFields`
- `function recordToFormValues`

### `ui-custom/web/src/pages/resources/resourceMeta.ts`

- `const RESOURCE_TYPES`
- `const RESOURCE_TYPE_MAP`
- `const SUBTYPE_FIELD`
- `const STATUS_MAP`
- `function statusColor`
- `const SOURCE_TYPE_MAP`
- `function resourceDisplayName`

### `ui-custom/web/src/pages/resources/useResourceColumnPrefs.ts`

- `interface UseResourceColumnPrefsResult`
- `function useResourceColumnPrefs`

### `ui-custom/web/src/pages/resources/useResourceCoverage.ts`

- `interface UseResourceCoverageResult`
- `function useResourceCoverage`

### `ui-custom/web/src/pages/resources/useResourceDelete.tsx`

- `function useResourceDelete`

### `ui-custom/web/src/pages/resources/useResourceDictionaries.ts`

- `interface UseResourceDictionariesResult`
- `function useResourceDictionaries`

### `ui-custom/web/src/pages/resources/useResourceLabels.ts`

- `interface UseResourceLabelsResult`
- `function useResourceLabels`

### `ui-custom/web/src/pages/resources/useResources.ts`

- `interface ResourceFilters`
- `interface UseResourcesResult`
- `function useResources`

### `ui-custom/web/src/pages/strategy/CollectionTemplateDrawer.tsx`

- `interface CollectionTemplateDrawerProps`
- `function CollectionTemplateDrawer`

### `ui-custom/web/src/pages/strategy/CollectorListPage.tsx`

- `function CollectorListPage`

### `ui-custom/web/src/pages/strategy/CollectorTemplatesTab.tsx`

- `function CollectorTemplatesTab`

### `ui-custom/web/src/pages/strategy/ExporterInstallationPanel.tsx`

- `function ExporterInstallationPanel`

### `ui-custom/web/src/pages/strategy/ExporterTemplateDrawer.tsx`

- `function ExporterTemplateDrawer`

### `ui-custom/web/src/pages/strategy/InstanceSelector.tsx`

- `function InstanceSelector`

### `ui-custom/web/src/pages/strategy/JobGroupDetailDrawer.tsx`

- `interface JobGroupDetailDrawerProps`
- `function JobGroupDetailDrawer`

### `ui-custom/web/src/pages/strategy/JobGroupWizardDrawer.tsx`

- `interface JobGroupWizardDrawerProps`
- `function JobGroupWizardDrawer`

### `ui-custom/web/src/pages/strategy/JobParamsFields.tsx`

- `interface ScrapeParamFieldsProps`
- `function ScrapeParamFields`
- `function AuthTlsFields`
- `function JobParamsFields`

### `ui-custom/web/src/pages/strategy/LabelTemplatePreview.tsx`

- `function LabelTemplatePreview`

### `ui-custom/web/src/pages/strategy/MetricLibraryDrawer.tsx`

- `interface MetricLibraryDrawerProps`
- `function MetricLibraryDrawer`

### `ui-custom/web/src/pages/strategy/MetricLibraryPage.tsx`

- `function MetricLibraryPage`

### `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx`

- `function RuleMountDrawer`

### `ui-custom/web/src/pages/strategy/RulesPage.tsx`

- `function RulesPage`

### `ui-custom/web/src/pages/strategy/ScrapeJobDetailDrawer.tsx`

- `interface ScrapeJobDetailDrawerProps`
- `function ScrapeJobDetailDrawer`

### `ui-custom/web/src/pages/strategy/ScrapeJobFormDrawer.tsx`

- `function ScrapeJobFormDrawer`

### `ui-custom/web/src/pages/strategy/ScrapeJobListPage.tsx`

- `function ScrapeJobListPage`

### `ui-custom/web/src/pages/strategy/SelectorEditor.tsx`

- `interface SelectorEditorProps`
- `function SelectorEditor`

### `ui-custom/web/src/pages/strategy/SyncStatusTag.tsx`

- `function SyncStatusTag`

### `ui-custom/web/src/pages/strategy/rulesYaml.ts`

- `function validateYamlClient`

### `ui-custom/web/src/pages/strategy/selectorUtils.ts`

- `function operatorsForField`
- `function fixedValuesForField`
- `function summarizeSelector`

### `ui-custom/web/src/pages/strategy/strategyConstants.ts`

- `const MONITOR_TYPE_MAP`
- `const CATEGORY_MAP`
- `const MONITOR_TYPE_CASCADE`
- `const BLACKBOX_CATEGORIES`
- `const BLACKBOX_TARGET_FIELD_LABEL`
- `const SCRAPE_PARAM_FIELDS`
- `const JOB_TYPE_MAP`
- `const CHANGE_STATUS_MAP`
- `const DRAFT_STATUS_MAP`
- `const CONTENT_MODE_MAP`
- `const SCOPE_MAP`
- `const METRIC_TYPE_MAP`
- `const AUTH_TYPE_MAP`
- `const SCRAPE_STATUS_META`
- `const DOWN_TOOLTIP`
- `const STALE_TOOLTIP`
- `const COLLECTION_STATUS_TOOLTIP`

### `ui-custom/web/src/pages/strategy/syncStatus.ts`

- `interface SyncStatusView`
- `function syncStatusView`
- `function aggregateJobSyncStatus`

### `ui-custom/web/src/pages/strategy/upStatus.ts`

- `interface ProbeTarget`
- `function hostOf`
- `function upQueryForJob`
- `function lastUpQueryForJob`
- `function statusFromUp`
- `function probeQueryForJob`
- `function probeStatusOfTarget`

### `ui-custom/web/src/pages/strategy/useCollectionTemplateCatalog.ts`

- `interface CollectionTemplateCatalog`
- `function useCollectionTemplateCatalog`
- `interface CandidateFieldCatalog`
- `function useCandidateFields`
- `function resetCollectionCatalogCache`

### `ui-custom/web/src/pages/strategy/useJobScrapeStatus.ts`

- `type JobScrapeAggState`
- `interface JobScrapeStatusView`
- `function useJobScrapeStatus`

### `ui-custom/web/src/pages/strategy/useScrapeJobStatus.ts`

- `type JobInstanceScrapeStatus`
- `interface JobScrapeStatusSummary`
- `function queryVector`
- `function useScrapeJobStatus`

### `ui-custom/web/src/pages/strategy/useScrapeJobs.ts`

- `interface ScrapeJobFilters`
- `interface UseScrapeJobsResult`
- `function useScrapeJobs`

### `ui-custom/web/src/pages/strategy/useSyncPolling.ts`

- `interface SyncPollingOptions`
- `function useSyncPolling`

### `ui-custom/web/src/productNamePreference.ts`

- `const PRODUCT_NAME_STORAGE_KEY`
- `const DEFAULT_PRODUCT_NAME`
- `const PRODUCT_NAME_MAX_LENGTH`
- `function normalizeProductName`
- `function readProductName`
- `function writeProductName`
- `function clearProductName`

### `ui-custom/web/src/skinContext.ts`

- `interface AppearanceConfig`
- `const AppearanceContext`
- `function useSkin`
- `function useProductName`

### `ui-custom/web/src/skinPreference.ts`

- `const SKIN_STORAGE_KEY`
- `function readSkin`
- `function writeSkin`

### `ui-custom/web/src/skins.ts`

- `type SkinKey`
- `interface SkinTokens`
- `interface SkinDefinition`
- `const SKINS`
- `const DEFAULT_SKIN`
- `const SKIN_ORDER`
- `function isSkinKey`
- `function skinDefinition`
- `function skinTokens`
- `const CSS_VAR_BY_TOKEN`
- `function buildSkinTheme`

### `ui-custom/web/src/test/antdTestUtils.tsx`

- `function setupAntdTest`
- `interface MockedModal`
- `function mockAntdModal`
- `interface MockedMessage`
- `function mockAntdMessage`
- `function selectAntdOption`

### `ui-custom/web/src/types/admin.ts`

- `type UserStatus`
- `interface UserItem`
- `interface LoginLogItem`
- `interface UserCreateInput`
- `interface UserUpdateInput`
- `interface ResetPasswordInput`
- `interface TenantEditInput`

### `ui-custom/web/src/types/alertmanager.ts`

- `interface PaginatedItems`
- `type SilenceStatus`
- `interface AlertmanagerConfigVersion`
- `interface AlertmanagerConfigVersionListItem`
- `interface ValidateErrorItem`
- `interface ValidateErrorData`
- `interface SilenceMatcher`
- `interface Silence`
- `interface CreateSilencePayload`
- `interface SilenceLabelOption`
- `interface SilenceLabelOptionGroup`
- `interface SilenceLabelOptionsData`
- `interface AlertInstanceFields`
- `type PromAlertState`
- `interface PromAlertItem`
- `interface PromAlertsData`
- `type NotifyStatus`
- `interface AmAlertStatus`
- `interface AmAlertItem`
- `interface AmAlertsData`
- `type AlertHistoryState`
- `interface AlertHistoryItem`
- `interface AlertHistoryData`
- `type AlertEventStatus`
- `interface AlertEventItem`
- `interface AlertEventData`
- `interface AlertEventCurrentData`
- `interface AlertEventStats`
- `type NotifyChannelType`
- `interface NotifyChannel`
- `interface NotifyTemplate`
- `interface NotifyTemplateDetail`
- `interface CreateNotifyChannelPayload`
- `interface UpdateNotifyChannelPayload`
- `interface SubmitNotifyTemplatePayload`
- `interface NotifyChannelsData`
- `interface NotifyTemplatesData`
- `interface RouteMatcher`
- `interface RouteNode`
- `interface RouteEditMatcher`
- `interface RouteEditNode`
- `interface RouteTreeData`
- `interface SaveRoutesPayload`
- `interface SaveRoutesResult`
- `interface InhibitionRule`
- `interface InhibitionListData`
- `interface SaveInhibitionsPayload`

### `ui-custom/web/src/types/api.ts`

- `type ApiStatus`
- `interface ApiMeta`
- `interface ApiResponse`
- `interface ApiErrorResponse`
- `type ApiError`
- `interface Paginated`

### `ui-custom/web/src/types/attribute.ts`

- `type AttributeValueType`
- `type AttributeStatus`
- `type AttributeGroup`
- `type BuiltinFieldValueType`
- `interface AttributeDefinition`
- `interface AttributeDefinitionInput`
- `interface BuiltinField`
- `interface AttributeGroupOption`
- `interface CIModel`
- `interface RemoveDefinitionResult`
- `interface ResourceAttributeValue`
- `const ATTRIBUTE_TYPE_LABEL`
- `const ATTRIBUTE_STATUS_LABEL`

### `ui-custom/web/src/types/auth.ts`

- `interface AuthUser`
- `interface LoginResult`

### `ui-custom/web/src/types/collectionTemplate.ts`

- `type SelectorOperator`
- `type SelectorLogic`
- `type CandidateFieldKind`
- `interface SelectorFilter`
- `interface Selector`
- `interface CandidateField`
- `interface CollectionTemplate`
- `interface CollectionTemplateInput`
- `interface CollectionTemplateImpact`
- `const OPERATOR_LABEL`
- `const OPERATOR_OPTIONS`
- `const EMPTY_SELECTOR`
- `function normalizeSelector`

### `ui-custom/web/src/types/config-center.ts`

- `interface PaginatedItems`
- `type Channel`
- `type AgentType`
- `type DomainType`
- `type MonitoredStatus`
- `type DomainEnabledStatus`
- `interface NetworkDomain`
- `type RegistrationStatus`
- `interface OnboardingDomain`
- `interface InstallGuide`
- `interface MonitorDomainResult`
- `interface UnmonitorDomainResult`
- `interface MonitorDomainInput`
- `interface ResetTokenResult`
- `type DraftStatus`
- `type DraftValidationStatus`
- `type Risk`
- `type ChangeTarget`
- `type ChangeType`
- `type AffectedFile`
- `type DeploymentStatus`
- `type SnapshotValidationStatus`
- `type SnapshotValidationCause`
- `interface ConfigSnapshot`
- `interface ConfigSnapshotListResponse`
- `type ConfigArtifactType`
- `interface ConfigArtifact`
- `interface ConfigArtifactListResponse`
- `interface ConfigArtifactFile`
- `interface ConfigArtifactPreview`
- `interface ConfigSnapshotHistoryRow`
- `type ConfigSyncTriggerScope`
- `interface ConfigSyncTriggerRequest`
- `interface ConfigSyncTriggerDomainResult`
- `interface ConfigSyncTriggerCenterResult`
- `interface ConfigSyncTriggerResponse`
- `interface EdgePackageComponent`
- `interface EdgePackage`

### `ui-custom/web/src/types/domain.ts`

- `type DomainType`
- `type DomainStatus`
- `type ChannelType`
- `type AgentType`
- `type RegistrationStatus`
- `interface OnboardingNetworkDomain`
- `interface NetworkDomain`
- `interface NetworkDomainImpact`
- `type CascadeImpact`
- `interface NetworkDomainDeleteResult`
- `interface NetworkDomainStatusResult`
- `type TenantStatus`
- `interface Tenant`

### `ui-custom/web/src/types/edge.ts`

- `type AgentStatus`
- `type AgentOverall`
- `type ConfigSyncStatus`
- `type OutOfSyncCause`
- `type EdgeComponentType`
- `type EdgeComponentStatus`
- `interface EdgeComponent`
- `interface AgentView`
- `interface EdgeAgentsSummary`
- `interface EdgeAgentsResponse`

### `ui-custom/web/src/types/jobGroup.ts`

- `interface CandidateFilterField`
- `interface FilterCondition`
- `interface DomainHit`
- `interface CandidateQueryResult`
- `interface CandidateIdsResult`
- `interface JobGroupChild`
- `interface JobGroupSync`
- `interface JobGroup`
- `interface JobGroupInput`

### `ui-custom/web/src/types/label.ts`

- `type LabelSourceType`
- `interface Mapping`
- `interface LabelTemplate`
- `type LabelSource`
- `interface ResourceLabel`
- `interface MappingInput`
- `interface LabelTemplateCreateInput`
- `interface LabelTemplateUpdateInput`
- `type LabelTemplateListItem`

### `ui-custom/web/src/types/query.ts`

- `type TargetHealth`
- `interface TargetItem`
- `interface TargetsResponse`
- `type CoverageState`
- `interface CoverageItem`
- `interface CoverageSummary`
- `interface CoverageListResponse`
- `type PromQueryResultType`
- `type PromSamplePair`
- `interface PromVectorItem`
- `interface PromMatrixItem`
- `type PromQueryData`

### `ui-custom/web/src/types/resource.ts`

- `type ResourceCategory`
- `type ResourceType`
- `interface ResourceBaseShape`
- `interface Host`
- `interface Database`
- `interface Middleware`
- `interface Application`
- `interface GenericTarget`
- `interface InterfaceService`
- `type Resource`
- `interface ResourceListItem`
- `type ResourceStatus`
- `interface ResourceCreateBaseShape`
- `interface HostResourceFields`
- `interface DatabaseResourceFields`
- `interface MiddlewareResourceFields`
- `interface ApplicationResourceFields`
- `interface GenericTargetResourceFields`
- `interface InterfaceServiceResourceFields`
- `type ResourceCreateInput`
- `interface ResourceUpdateBaseShape`
- `type ResourceUpdateInput`
- `type BulkReassignField`
- `interface BulkReassignInput`
- `interface BulkReassignResult`
- `interface BulkReassignFailure`
- `type DictionaryStatus`
- `interface BusinessDomain`
- `interface ApplicationDict`
- `interface AppPlatformRel`
- `interface PlatformDict`
- `interface DictionaryAuditLog`
- `interface CloudDict`
- `interface OSOption`
- `type ResourceLabelSource`
- `interface ResourceLabelItem`
- `interface ImportError`
- `interface ImportResult`
- `type ImportMode`
- `interface ImportRecord`

### `ui-custom/web/src/types/storage.ts`

- `interface RetentionValues`
- `interface RetentionState`
- `interface DiskInfo`
- `interface LogRotationInfo`
- `interface StorageLogOverview`
- `interface RetentionInput`

### `ui-custom/web/src/types/strategy.ts`

- `type JobType`
- `type AuthType`
- `type ChangeStatus`
- `type InstanceSelectionMode`
- `interface ScrapeJob`
- `type CITypeExporterMapping`
- `type ExporterSource`
- `interface ExporterTemplate`
- `type RuleContentMode`
- `type ScopeType`
- `interface MonitoringRule`
- `type BlackboxTargetProtocol`
- `interface BlackboxTarget`
- `type MonitorType`
- `type BlackboxModule`
- `type MetricType`
- `interface ExporterMetricAnchor`
- `interface ExporterMetricLibraryItem`
- `interface InstanceCandidate`
- `type InstallationStatus`
- `interface ExporterInstallationRecord`
- `interface ScrapeJobInstanceItem`
- `interface ScrapeJobMappingOverride`

### `ui-custom/web/src/types/strategyV3.ts`

- `type SyncStatus`
- `interface SyncState`
- `type JobType`
- `type JobDraftStatus`
- `type JobAuthType`
- `type ResourceCategory`
- `interface MappingOverride`
- `interface ExporterTemplateV3`
- `interface ScrapeJobV3`
- `interface InstanceCandidateV3`
- `interface InstallationV3`
- `interface JobInstanceV3`
- `interface PreviewTargetsV3`
- `type RuleContentMode`
- `interface MonitoringRuleV3`
- `interface JobRefIssueV3`
- `interface RuleValidationV3`
- `interface MetricAnchorV3`
- `interface MetricV3`
- `interface BusinessMetricV3`
- `interface ProbeModuleV3`

### `ui-custom/web/src/utils/shortChecksum.ts`

- `function shortChecksum`

### `ui-custom/web/src/utils/triggerBlobDownload.ts`

- `function triggerBlobDownload`

