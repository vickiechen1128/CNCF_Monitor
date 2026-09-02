# MetricCenter Repo Map（业务代码符号地图）

> 由 `make repo-map`（`scripts/repo-map`）自动生成，**请勿手改**。
> 生成时间: 2026-09-02 15:34 · commit: `325a5bec`
> 覆盖范围: `platform/`（Go）与 `ui-custom/web/src/`（TS/TSX）；`upstream/` 上游子模块刻意不索引（只读且体量巨大），其架构结论见本目录其他文档。
> 用法: 先用本文件按「符号名 → 文件路径」定位，再 `Read` 目标文件；查不到再降级为 Grep 全文搜索。

## platform/（Go 后端）

### `platform/admin/networkdomain/authorized_test.go`

- `func TestAuthorizedTenantsDefaultBackfill(t *testing.T)`
- `func TestAuthorizedTenantsEditAddsAndRemoves(t *testing.T)`
- `func TestAuthorizedTenantsClearToEmpty(t *testing.T)`

### `platform/admin/networkdomain/create.go`

- `type CreateNetworkDomainRequest struct`
- `func validDomainType(dt models.DomainType) bool`
- `func randomDomainCode() (string, error)`
- `func isUniqueConstraintError(err error) bool`
- `func CreateNetworkDomain(db *gorm.DB) gin.HandlerFunc`

### `platform/admin/networkdomain/create_test.go`

- `func postCreate(t *testing.T, db *gorm.DB, body string) (int, models.NetworkDomain, string)`
- `func TestCreateNetworkDomainOK(t *testing.T)`
- `func TestCreateNetworkDomainBackfillsAuthorizedDefault(t *testing.T)`
- `func TestCreateNetworkDomainIgnoresClientTenant(t *testing.T)`
- `func TestCreateNetworkDomainMissingName(t *testing.T)`
- `func TestCreateNetworkDomainMissingDomainType(t *testing.T)`
- `func TestCreateNetworkDomainInvalidDomainType(t *testing.T)`
- `func TestCreateNetworkDomainRejectsManagementDomain(t *testing.T)`
- `func TestCreateNetworkDomainReservedDefault(t *testing.T)`
- `func TestCreateNetworkDomainDuplicateConflict(t *testing.T)`
- `func TestCreateNetworkDomainInvalidDomainCode(t *testing.T)`
- `func TestCreateNetworkDomainAfterSoftDeleteConflict(t *testing.T)`

### `platform/admin/networkdomain/delete.go`

- `func DeleteNetworkDomain(db *gorm.DB) gin.HandlerFunc`

### `platform/admin/networkdomain/delete_test.go`

- `func delDomain(t *testing.T, db *gorm.DB, id string) (int, map[string]interface{})`
- `func TestDeleteEmptyDomainSoftDeletes(t *testing.T)`
- `func TestDeleteNonEmptyRejected(t *testing.T)`
- `func TestDeleteManagedAgentRejected(t *testing.T)`
- `func TestDeleteManagementRejected(t *testing.T)`
- `func TestDeleteOfflineAgentDoesNotBlock(t *testing.T)`

### `platform/admin/networkdomain/detail.go`

- `func GetNetworkDomain(db *gorm.DB) gin.HandlerFunc`

### `platform/admin/networkdomain/detail_test.go`

- `func TestGetNetworkDomainOK(t *testing.T)`
- `func TestGetNetworkDomainNotFound(t *testing.T)`
- `func TestGetNetworkDomainIgnoresSoftDeleted(t *testing.T)`

### `platform/admin/networkdomain/idgen.go`

- `func ReadDeployCode() string`
- `func GenerateDomainID(deployCode, domainCode string) (string, error)`

### `platform/admin/networkdomain/idgen_test.go`

- `func TestReadDeployCodeDefault(t *testing.T)`
- `func TestReadDeployCodeFromEnv(t *testing.T)`
- `func TestGenerateDomainIDDefaultPrefix(t *testing.T)`
- `func TestGenerateDomainIDEscapesPrefix(t *testing.T)`
- `func TestGenerateDomainIDDefaultSpecialCase(t *testing.T)`
- `func TestGenerateDomainIDInvalidDomainCode(t *testing.T)`
- `func TestGenerateDomainIDInvalidDeployCode(t *testing.T)`

### `platform/admin/networkdomain/impact.go`

- `type DomainImpact struct`
- `func countResources(db *gorm.DB, domainID string) (int64, error)`
- `func countManagedEdgeAgents(db *gorm.DB, domainID string) (int64, error)`
- `func ComputeImpact(db *gorm.DB, domainID string) (*DomainImpact, error)`

### `platform/admin/networkdomain/list.go`

- `func ListNetworkDomains(db *gorm.DB) gin.HandlerFunc`
- `func parseIntDefault(raw string, def, min int) int`

### `platform/admin/networkdomain/list_test.go`

- `func TestListNetworkDomains(t *testing.T)`

### `platform/admin/networkdomain/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`

### `platform/admin/networkdomain/status.go`

- `type UpdateStatusRequest struct`
- `func validDomainStatus(s models.DomainStatus) bool`
- `func UpdateDomainStatus(db *gorm.DB) gin.HandlerFunc`

### `platform/admin/networkdomain/status_test.go`

- `func patchStatus(t *testing.T, db *gorm.DB, id, body string) (int, map[string]interface{})`
- `func seedEdgeDomain(t *testing.T, db *gorm.DB)`
- `func TestDisableReturnsFlatImpact(t *testing.T)`
- `func TestReEnable(t *testing.T)`
- `func TestManagementCannotDisable(t *testing.T)`
- `func TestInvalidStatusValue(t *testing.T)`
- `func TestStatusNotFound(t *testing.T)`

### `platform/admin/networkdomain/tenant_auth.go`

- `func containsStr(list []string, s string) bool`
- `func syncAuthorizedTenants(db *gorm.DB, domainID string, tenantIDs []string) error`

### `platform/admin/networkdomain/testutil_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func newGin() *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path string, body string) *httptest.ResponseRecorder`
- `func seedZoneTypes(t *testing.T, db *gorm.DB)`
- `func seedTenants(t *testing.T, db *gorm.DB)`
- `func insertDomain(t *testing.T, db *gorm.DB, d *models.NetworkDomain)`

### `platform/admin/networkdomain/update.go`

- `type UpdateNetworkDomainRequest struct`
- `func UpdateNetworkDomain(db *gorm.DB) gin.HandlerFunc`

### `platform/admin/networkdomain/update_test.go`

- `func putUpdate(t *testing.T, db *gorm.DB, id, body string) (int, models.NetworkDomain)`
- `func TestUpdateNetworkDomainEditableFields(t *testing.T)`
- `func TestUpdateNetworkDomainTenantIgnored(t *testing.T)`
- `func TestUpdateNetworkDomainNotFound(t *testing.T)`
- `func TestUpdateNetworkDomainDefaultAllowedForName(t *testing.T)`

### `platform/admin/networkdomain/zone_type.go`

- `type ZoneTypeView struct`
- `func ListZoneTypes(db *gorm.DB) gin.HandlerFunc`

### `platform/admin/networkdomain/zone_type_test.go`

- `func TestListZoneTypesReturnsEnabledOnly(t *testing.T)`
- `func TestListZoneTypesEmpty(t *testing.T)`

### `platform/admin/tenant/handler.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`
- `type Handler struct`
- `func NewHandler(svc *Service) *Handler`
- `type tenantDTO struct`
- `func toTenantDTO(tn *models.Tenant) tenantDTO`
- `type updateTenantRequest struct`
- `method (*Handler) ListTenants(c *gin.Context)`
- `method (*Handler) GetTenant(c *gin.Context)`
- `method (*Handler) UpdateTenant(c *gin.Context)`
- `method (*Handler) CreateTenantNotAllowed(c *gin.Context)`
- `method (*Handler) UpdateTenantStatusNotAllowed(c *gin.Context)`
- `func writeError(c *gin.Context, err error)`
- `func errInvalidPayload(err error) error`
- `func parsePage(c *gin.Context) (int, int)`
- `func parseIntDefault(raw string, def int) int`

### `platform/admin/tenant/handler_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func seedTenant(t *testing.T, db *gorm.DB, id, name string, multiSite bool) models.Tenant`
- `func newTestRouter(db *gorm.DB) *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder`
- `type envelope struct`
- `func decodeEnvelope(t *testing.T, w *httptest.ResponseRecorder) envelope`
- `func TestListTenants_Success(t *testing.T)`
- `func TestListTenants_Pagination(t *testing.T)`
- `func TestListTenants_StatusFilter(t *testing.T)`
- `func TestGetTenant_Success(t *testing.T)`
- `func TestGetTenant_NotFound(t *testing.T)`
- `func TestUpdateTenant_Success(t *testing.T)`
- `func TestUpdateTenant_Validation(t *testing.T)`
- `func TestUpdateTenant_NotFound(t *testing.T)`
- `func TestCreateTenant_Forbidden(t *testing.T)`
- `func TestUpdateTenantStatus_Forbidden(t *testing.T)`
- `func TestTenantFieldsConformToContract(t *testing.T)`

### `platform/admin/tenant/repository.go`

- `type Repository struct`
- `func NewRepository(db *gorm.DB) *Repository`
- `method (*Repository) FindByID(id string) (*models.Tenant, error)`
- `method (*Repository) ListTenants(page, pageSize int, status string) ([]models.Tenant, int64, error)`
- `method (*Repository) Save(tn *models.Tenant) error`

### `platform/admin/tenant/service.go`

- `type ValidationError struct`
- `method (*ValidationError) Error() string`
- `func newValidationError(format string, args ...interface{}) *ValidationError`
- `type Service struct`
- `func NewService(repo *Repository) *Service`
- `method (*Service) ListTenants(page, pageSize int, status string) ([]models.Tenant, int64, error)`
- `method (*Service) GetTenant(id string) (*models.Tenant, error)`
- `method (*Service) UpdateTenant(id string, name *string, multiSiteEnabled *bool) (*models.Tenant, error)`

### `platform/admin/user/handler.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`
- `type Handler struct`
- `func NewHandler(svc *Service) *Handler`
- `type userDTO struct`
- `func toUserDTO(u *models.User) userDTO`
- `type loginLogDTO struct`
- `func toLoginLogDTO(l *models.LoginLog) loginLogDTO`
- `type createUserRequest struct`
- `type updateUserRequest struct`
- `type updateStatusRequest struct`
- `type resetPasswordRequest struct`
- `method (*Handler) CreateUser(c *gin.Context)`
- `method (*Handler) ListUsers(c *gin.Context)`
- `method (*Handler) UpdateUser(c *gin.Context)`
- `method (*Handler) UpdateUserStatus(c *gin.Context)`
- `method (*Handler) DeleteUser(c *gin.Context)`
- `method (*Handler) ResetPassword(c *gin.Context)`
- `method (*Handler) ListLoginLogs(c *gin.Context)`
- `func writeError(c *gin.Context, err error)`
- `func errInvalidPayload(err error) error`
- `func parsePage(c *gin.Context) (int, int)`
- `func parseIntDefault(raw string, def int) int`

### `platform/admin/user/handler_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func newTestRouter(db *gorm.DB) *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder`
- `type envelope struct`
- `func decodeEnvelope(t *testing.T, w *httptest.ResponseRecorder) envelope`
- `func seedSession(t *testing.T, db *gorm.DB, userID, token string)`
- `func countSessions(t *testing.T, db *gorm.DB, userID string) int64`
- `func createUserViaAPI(t *testing.T, r *gin.Engine, username, displayName, password string) map[string]interface{}`
- `func TestCreateUser_Success(t *testing.T)`
- `func TestCreateUser_ResponseNeverLeaksPasswordHash(t *testing.T)`
- `func TestCreateUser_DuplicateUsername(t *testing.T)`
- `func TestCreateUser_Validation(t *testing.T)`
- `func TestDeleteUser_RemoveOrdinaryUser(t *testing.T)`
- `func TestDeleteUser_AdminForbidden(t *testing.T)`
- `func TestDeleteUser_NotFound(t *testing.T)`
- `func TestListUsers_PaginationAndFields(t *testing.T)`
- `func TestUpdateUser_DisplayName(t *testing.T)`
- `func TestUpdateUser_UsernameImmutable(t *testing.T)`
- `func TestUpdateUser_NotFound(t *testing.T)`
- `func TestUpdateUserStatus_DisableInvalidatesSessions(t *testing.T)`
- `func TestUpdateUserStatus_InvalidValue(t *testing.T)`
- `func TestUpdateUserStatus_NotFound(t *testing.T)`
- `func TestResetPassword_UpdatesHashAndInvalidatesSessions(t *testing.T)`
- `func TestResetPassword_ValidationAndNotFound(t *testing.T)`
- `func TestListLoginLogs_FilterOrderPagination(t *testing.T)`

### `platform/admin/user/repository.go`

- `type Repository struct`
- `func NewRepository(db *gorm.DB) *Repository`
- `method (*Repository) ExistsByUsername(username string) (bool, error)`
- `method (*Repository) Create(u *models.User) error`
- `method (*Repository) FindByID(id string) (*models.User, error)`
- `method (*Repository) ListUsers(page, pageSize int) ([]models.User, int64, error)`
- `method (*Repository) Save(u *models.User) error`
- `method (*Repository) Delete(id string) error`
- `method (*Repository) DeleteSessionsByUserID(userID string) error`
- `method (*Repository) ListLoginLogs(username string, success *bool, page, pageSize int) ([]models.LoginLog, int64, error)`
- `func isUniqueConstraintError(err error) bool`

### `platform/admin/user/service.go`

- `type ValidationError struct`
- `method (*ValidationError) Error() string`
- `func newValidationError(format string, args ...interface{}) *ValidationError`
- `type Service struct`
- `func NewService(repo *Repository) *Service`
- `type CreateUserInput struct`
- `func normalizeRole(role string) (string, error)`
- `method (*Service) CreateUser(in CreateUserInput) (*models.User, error)`
- `method (*Service) ListUsers(page, pageSize int) ([]models.User, int64, error)`
- `method (*Service) UpdateDisplayName(id, displayName string) (*models.User, error)`
- `method (*Service) UpdateRole(id, role string) (*models.User, error)`
- `method (*Service) UpdateStatus(id string, status models.UserStatus) (*models.User, error)`
- `method (*Service) ResetPassword(id, newPassword string) error`
- `method (*Service) DeleteUser(id string) error`
- `method (*Service) ListLoginLogs(username string, success *bool, page, pageSize int) ([]models.LoginLog, int64, error)`
- `func validatePassword(password string) error`
- `func newUserID() (string, error)`

### `platform/alertmanager/config/config_test.go`

- `func newMemConfigDB(t *testing.T) *gorm.DB`
- `func stubAmtoolAvailable(t *testing.T)`
- `func stubAmtoolFails(t *testing.T)`
- `func stubAmtoolUnavailable(t *testing.T)`
- `func stubChangeTrigger(t *testing.T) *int32`
- `func TestSubmitPersistsOnValid(t *testing.T)`
- `func TestSubmitRejectsInvalidNoPersist(t *testing.T)`
- `func TestSubmitRejectsEmptyContent(t *testing.T)`
- `func TestSubmitAmtoolUnavailableValidationFails(t *testing.T)`
- `func TestSubmitIdempotentOnSameChecksum(t *testing.T)`
- `func TestLatestAppliedAndGetVersionByID(t *testing.T)`
- `func TestErrValidationError(t *testing.T)`

### `platform/alertmanager/config/handler.go`

- `func queryPage(c *gin.Context) (page, pageSize int)`
- `func parseID(c *gin.Context) (uint, error)`
- `func SubmitHandler(db *gorm.DB) gin.HandlerFunc`
- `func CurrentHandler(db *gorm.DB) gin.HandlerFunc`
- `func ListVersionsHandler(db *gorm.DB) gin.HandlerFunc`
- `func GetVersionHandler(db *gorm.DB) gin.HandlerFunc`
- `func RemountHandler(db *gorm.DB) gin.HandlerFunc`
- `func respondSubmitError(c *gin.Context, err error)`

### `platform/alertmanager/config/service.go`

- `type ErrValidation struct`
- `method (*ErrValidation) Error() string`
- `func Submit(db *gorm.DB, content, uploadedBy string) (*models.AlertmanagerConfigVersion, error)`
- `func Remount(db *gorm.DB, content, uploadedBy string) (*models.AlertmanagerConfigVersion, error)`
- `func submitValidated(db *gorm.DB, content, checksum, uploadedBy string) (*models.AlertmanagerConfigVersion, error)`
- `func findVersionByChecksum(db *gorm.DB, checksum string) (*models.AlertmanagerConfigVersion, error)`
- `func LatestApplied(db *gorm.DB) (*models.AlertmanagerConfigVersion, error)`
- `func GetVersionByID(db *gorm.DB, id uint) (*models.AlertmanagerConfigVersion, error)`

### `platform/alertmanager/config/validate.go`

- `func validateAlertmanagerConfig(content string) error`
- `func runCheckConfig(content string) ([]models.ValidateErrorItem, error)`
- `func isSuccess(output string) bool`
- `func parseCheckErrors(output string) []models.ValidateErrorItem`
- `func extractLine(line string) int`

### `platform/alertmanager/config/version.go`

- `type VersionListItem struct`
- `func toListItem(v *models.AlertmanagerConfigVersion) VersionListItem`
- `func formatTimeOrNil(t *time.Time) *string`
- `func ListVersions(db *gorm.DB, page, pageSize int) ([]VersionListItem, int64, error)`
- `func GetVersion(db *gorm.DB, id uint) (*models.AlertmanagerConfigVersion, error)`

### `platform/alertmanager/config/version_test.go`

- `func newConfigRouter(db *gorm.DB) *gin.Engine`
- `func do(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder`
- `func decodeResponse(t *testing.T, w *httptest.ResponseRecorder) map[string]interface{}`
- `func TestSubmitEndpointCreatesVersion(t *testing.T)`
- `func TestSubmitEndpointValidationFails(t *testing.T)`
- `func TestCurrentEndpointEmptyThenAfterSubmit(t *testing.T)`
- `func TestListVersionsEndpointPagination(t *testing.T)`
- `func TestGetVersionEndpointDetail(t *testing.T)`
- `func TestRemountEndpointCreatesNewVersion(t *testing.T)`
- `func TestRemountEndpointNotFound(t *testing.T)`
- `func TestRemountEndpointValidationFailsNoPersist(t *testing.T)`

### `platform/alertmanager/silence/authorize.go`

- `func AuthorizeMatchers(scope *models.AuthorizedMatcherScope, matchers []models.SilenceMatcher) error`
- `func buildScopeForUser() *models.AuthorizedMatcherScope`

### `platform/alertmanager/silence/handler.go`

- `func queryPage(c *gin.Context) (page, pageSize int)`
- `func ListHandler(svc *Service) gin.HandlerFunc`
- `func CreateHandler(svc *Service) gin.HandlerFunc`
- `func DeleteHandler(svc *Service) gin.HandlerFunc`
- `func paginate(list []Silence, page, pageSize int) (int, []Silence)`

### `platform/alertmanager/silence/proxy.go`

- `type amMatcher struct`
- `type amSilence struct`
- `type amCreateSilenceRequest struct`
- `type amCreateSilenceResponse struct`
- `type amListResponse struct`
- `type Proxy struct`
- `func NewProxy(baseURL string) (*Proxy, error)`
- `method (*Proxy) ListSilences(ctx context.Context) ([]amSilence, error)`
- `method (*Proxy) CreateSilence(ctx context.Context, body []byte) (string, error)`
- `method (*Proxy) GetSilence(ctx context.Context, id string) (*amSilence, error)`
- `method (*Proxy) DeleteSilence(ctx context.Context, id string) error`
- `func decodeList(resp *http.Response) ([]amSilence, error)`
- `func sanitize(b []byte) string`

### `platform/alertmanager/silence/service.go`

- `type Silence struct`
- `type Service struct`
- `func NewService(proxy *Proxy) *Service`
- `type CreateInput struct`
- `method (*CreateInput) Validate() error`
- `method (*Service) List(ctx context.Context, activeOnly bool) ([]Silence, error)`
- `method (*Service) Create(ctx context.Context, scope *models.AuthorizedMatcherScope, in CreateInput) (*Silence, error)`
- `method (*Service) Delete(ctx context.Context, id string) (string, error)`
- `func toSilence(am amSilence) Silence`
- `func silenceStatusAt(starts, ends time.Time) models.SilenceStatus`
- `func buildCreateBody(in CreateInput) ([]byte, error)`

### `platform/alertmanager/silence/silence_test.go`

- `type fakeAM struct`
- `method (*fakeAM) setList(s []amSilence)`
- `method (*fakeAM) createdBodies() []amCreateSilenceRequest`
- `method (*fakeAM) markNotFound(ids ...string)`
- `method (*fakeAM) handler() http.Handler`
- `func startFakeAM(t *testing.T, f *fakeAM) string`
- `func boolp(b bool) *bool`
- `func newTestService(t *testing.T) (*Service, *fakeAM)`
- `func TestServiceListMapsActiveSilences(t *testing.T)`
- `func TestServiceListEmpty(t *testing.T)`
- `func TestServiceCreateValid(t *testing.T)`
- `func TestServiceCreateValidatesMissingFields(t *testing.T)`
- `func TestServiceCreateRejectsOutOfScopeMatcher(t *testing.T)`
- `func TestServiceDeleteOK(t *testing.T)`
- `func TestServiceDeleteNotFound(t *testing.T)`
- `func TestNewProxyRejectsBadScheme(t *testing.T)`
- `func TestPaginate(t *testing.T)`
- `func newSilenceRouter(svc *Service) *gin.Engine`
- `func silenceRequest(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder`
- `func TestListEndpoint(t *testing.T)`
- `func TestCreateEndpointInvalidBody(t *testing.T)`
- `func TestDeleteEndpointNotFound(t *testing.T)`
- `func decodeAt(w *httptest.ResponseRecorder, path []string) string`

### `platform/api/response/response.go`

- `type Response struct`
- `func Success(data interface{}) Response`
- `func Fail(errorType string, err error) Response`
- `func Error(err error) Response`
- `func OK(c *gin.Context, data interface{})`
- `func BadRequest(c *gin.Context, err error)`
- `func Unauthorized(c *gin.Context, message string)`
- `func Forbidden(c *gin.Context, message string)`
- `func NotFound(c *gin.Context, message string)`
- `func TooManyRequests(c *gin.Context, message string)`
- `func InternalServerError(c *gin.Context, err error)`
- `func strError(message string) error`
- `type strErr = string`
- `method (strErr) Error() string`
- `func Conflict(c *gin.Context, err error)`

### `platform/api/response/response_test.go`

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

### `platform/cmd/metric-center/main.go`

- `func main()`
- `func setupRouter(promURL *url.URL, staticDir string) (*gin.Engine, error)`
- `func registerHealthRoutes(g *gin.RouterGroup)`
- `func registerPrometheusProxyRoutes(g *gin.RouterGroup, promURL *url.URL)`
- `func registerPlatformConfigRoutes(g *gin.RouterGroup)`
- `func registerSPA(r *gin.Engine, dir string) error`
- `func healthHandler(c *gin.Context)`
- `func healthDBHandler(c *gin.Context)`
- `func statusHandler(c *gin.Context)`
- `func prometheusProxyHandler(proxy *httputil.ReverseProxy) gin.HandlerFunc`
- `func newPrometheusProxy(target *url.URL) *httputil.ReverseProxy`
- `func parseURL(raw string) (*url.URL, error)`
- `func buildReloadFunc(reloadURL string) func() error`
- `type safeResponseWriter struct`
- `method (*safeResponseWriter) CloseNotify() <-chan bool`

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

### `platform/cmd/metric-center/main_test.go`

- `func buildIntegrationEngine(t *testing.T) (*gin.Engine, *gorm.DB)`
- `type apiClient struct`
- `method (*apiClient) json(method, path, body string) (int, map[string]interface{})`
- `method (*apiClient) multipart(path string, fields map[string]string, fileField, fileName string, fileBytes []byte) (int, map[s…`
- `func mustJSON(t *testing.T, v interface{}) string`
- `func buildXLSX(t *testing.T, category models.ResourceCategory, rows [][]string) []byte`
- `func resourcePayload(category string, overrides map[string]interface{}) map[string]interface{}`
- `func TestEndToEndDomainRegistry(t *testing.T)`
- `func listItems(out map[string]interface{}) []interface{}`
- `func TestEndToEndResourceCRUD(t *testing.T)`
- `func TestEndToEndSmoke(t *testing.T)`
- `func TestEndToEndExcelImport(t *testing.T)`
- `func TestEndToEndResourceLabels(t *testing.T)`
- `func TestEndToEndLabelTemplates(t *testing.T)`
- `func TestEndToEndBusinessDomainsReadOnly(t *testing.T)`
- `func TestEndToEndConfigCenterSmoke(t *testing.T)`
- `func TestBuildReloadFunc(t *testing.T)`

### `platform/cmd/metric-center/route_probe_test.go`

- `func TestRouteProbeParamNameConflict(t *testing.T)`

### `platform/cmd/metric-center/strategy_integration_test.go`

- `func TestEndToEndStrategyScrapeJob(t *testing.T)`
- `func TestEndToEndStrategyRuleAndMetricLibrary(t *testing.T)`

### `platform/config/label/generator.go`

- `type SystemLabel struct`
- `func ComputeSystemLabels(template *models.LabelTemplate, res models.Resource) []SystemLabel`
- `func GetApplicableTemplate(db *gorm.DB, category models.ResourceCategory) (*models.LabelTemplate, error)`

### `platform/config/label/generator_test.go`

- `func hostDefaultTemplate() *models.LabelTemplate`
- `func sampleHost() *models.Host`
- `func labelsByKey(t *testing.T, labels []SystemLabel) map[string]SystemLabel`
- `func TestComputeSystemLabelsHostDefaultTemplate(t *testing.T)`
- `func TestComputeSystemLabelsSourceMap(t *testing.T)`
- `func TestComputeSystemLabelsApplicationTemplate(t *testing.T)`
- `func TestComputeSystemLabelsSeedDefaultMappings(t *testing.T)`
- `func TestComputeSystemLabelsSkipsEmptyValues(t *testing.T)`
- `func TestComputeSystemLabelsSkipsUnknownAndNonProcessedSources(t *testing.T)`
- `func TestComputeSystemLabelsNilInputs(t *testing.T)`
- `func TestGetApplicableTemplateReturnsDefault(t *testing.T)`
- `func TestGetApplicableTemplateNone(t *testing.T)`

### `platform/config/label/instances.go`

- `type templateInstanceItem struct`
- `func ListTemplateResources(db *gorm.DB) gin.HandlerFunc`
- `func listCategoryInstances(db *gorm.DB, cat models.ResourceCategory, page, pageSize int, keyword, status string) ([]template…`
- `func queryInstances[T any](db *gorm.DB, rows *[]T, page, pageSize int, keyword, status, keywordCol string, name func(*T) str…`

### `platform/config/label/instances_test.go`

- `func mountTemplateResources(t *testing.T, db *gorm.DB) *gin.Engine`
- `type templateResourcesResponse struct`
- `func doTemplateResources(t *testing.T, r *gin.Engine, templateID uint, query string) (int, templateResourcesResponse)`
- `func templateFor(name string, cat models.ResourceCategory, isDefault bool) *models.LabelTemplate`
- `func seedHostInstance(t *testing.T, db *gorm.DB, resourceID, instanceName, status string)`
- `func seedDatabaseInstance(t *testing.T, db *gorm.DB, resourceID, instanceIP, status string)`
- `func seedMiddlewareInstance(t *testing.T, db *gorm.DB, resourceID, instanceIP, status string)`
- `func seedApplicationInstance(t *testing.T, db *gorm.DB, resourceID, serviceName, status string)`
- `func seedGenericInstance(t *testing.T, db *gorm.DB, resourceID, targetName, status string)`
- `func TestListTemplateResourcesDisplayNameByCategory(t *testing.T)`
- `func TestListTemplateResourcesHostExcludesSoftDeleted(t *testing.T)`
- `func TestListTemplateResourcesPaginationAndDefaults(t *testing.T)`
- `func TestListTemplateResourcesKeywordStatusFilter(t *testing.T)`
- `func TestListTemplateResourcesEmptyCategory(t *testing.T)`
- `func TestListTemplateResourcesTemplateNotFoundAndSoftDeleted(t *testing.T)`

### `platform/config/label/list.go`

- `type templateListItem struct`
- `func ListLabelTemplates(db *gorm.DB) gin.HandlerFunc`
- `func categoryResourceCounts(db *gorm.DB, templates []models.LabelTemplate) (map[models.ResourceCategory]int64, error)`
- `func countCategoryResources(db *gorm.DB, cat models.ResourceCategory) (int64, error)`
- `func parseIntDefault(raw string, def, min int) int`

### `platform/config/label/list_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func newGin() *gin.Engine`
- `func mountList(t *testing.T, db *gorm.DB) *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, path string) *httptest.ResponseRecorder`
- `type listResponse struct`
- `func doList(t *testing.T, r *gin.Engine, query string) (int, listResponse)`
- `func seedTemplates(t *testing.T, db *gorm.DB, templates ...*models.LabelTemplate)`
- `func seedHost(t *testing.T, db *gorm.DB, resourceID string)`
- `func seedDatabase(t *testing.T, db *gorm.DB, resourceID string)`
- `func hostTemplate(name string, isDefault bool) *models.LabelTemplate`
- `func TestListLabelTemplatesDefaultsAndMappings(t *testing.T)`
- `func TestListLabelTemplatesResourceCategoryFilter(t *testing.T)`
- `func TestListLabelTemplatesIsDefaultFilter(t *testing.T)`
- `func TestListLabelTemplatesKeywordFilter(t *testing.T)`
- `func TestListLabelTemplatesPaginationAndPageSizeClamp(t *testing.T)`
- `func TestListLabelTemplatesInstanceCount(t *testing.T)`
- `func TestListLabelTemplatesSoftDeleteExcluded(t *testing.T)`
- `func TestListLabelTemplatesMappingsSerialization(t *testing.T)`

### `platform/config/label/mappings.go`

- `type CreateMappingRequest struct`
- `type UpdateMappingRequest struct`
- `func validSourceType(st models.LabelSourceType) bool`
- `func validateTransformRule(rule string) error`
- `func validateTargetLabel(st models.LabelSourceType, targetLabel string) error`
- `func resolveCreateTargetLabel(st models.LabelSourceType, sourceField, targetLabel string) (string, error)`
- `func parseMappingID(c *gin.Context) (int, bool)`
- `func loadTemplate(c *gin.Context, db *gorm.DB, id uint) (*models.LabelTemplate, bool)`
- `func rejectDefaultTemplate(c *gin.Context, tmpl *models.LabelTemplate) bool`
- `func CreateLabelMapping(db *gorm.DB) gin.HandlerFunc`
- `func UpdateLabelMapping(db *gorm.DB) gin.HandlerFunc`
- `func DeleteLabelMapping(db *gorm.DB) gin.HandlerFunc`

### `platform/config/label/mappings_test.go`

- `func mountMappings(t *testing.T, db *gorm.DB) *gin.Engine`
- `func decodeMappings(t *testing.T, w *httptest.ResponseRecorder) (int, []models.LabelMapping)`
- `func decodeMappingID(t *testing.T, w *httptest.ResponseRecorder) (int, uint)`
- `func seedMappingTemplate(t *testing.T, db *gorm.DB) models.LabelTemplate`
- `func seedDefaultMappingTemplate(t *testing.T, db *gorm.DB) models.LabelTemplate`
- `func assertMappingsTargets(t *testing.T, mappings []models.LabelMapping, want ...string)`
- `func TestCreateLabelMappingResourceFieldDefaultPrefill(t *testing.T)`
- `func TestCreateLabelMappingExplicitTarget(t *testing.T)`
- `func TestCreateLabelMappingProtectedLabelRejected(t *testing.T)`
- `func TestCreateLabelMappingCompositeLocksInstance(t *testing.T)`
- `func TestCreateLabelMappingDuplicateTargetLabelRejected(t *testing.T)`
- `func TestCreateLabelMappingTransformValidation(t *testing.T)`
- `func TestCreateLabelMappingInvalidSourceType(t *testing.T)`
- `func TestCreateLabelMappingTemplateNotFound(t *testing.T)`
- `func TestCreateLabelMappingDefaultTemplateForbidden(t *testing.T)`
- `func TestUpdateLabelMappingSuccess(t *testing.T)`
- `func TestUpdateLabelMappingExcludeSelfUniqueness(t *testing.T)`
- `func TestUpdateLabelMappingDuplicateRejected(t *testing.T)`
- `func TestUpdateLabelMappingCompositeLocked(t *testing.T)`
- `func TestUpdateLabelMappingNotFound(t *testing.T)`
- `func TestUpdateLabelMappingDefaultTemplateForbidden(t *testing.T)`
- `func TestDeleteLabelMappingSuccess(t *testing.T)`
- `func TestDeleteLabelMappingNotFound(t *testing.T)`
- `func TestDeleteLabelMappingDefaultTemplateForbidden(t *testing.T)`
- `func TestValidateMappingsEnhanced(t *testing.T)`

### `platform/config/label/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`

### `platform/config/label/template_clone.go`

- `type CloneLabelTemplateRequest struct`
- `func CloneLabelTemplate(db *gorm.DB) gin.HandlerFunc`

### `platform/config/label/template_crud.go`

- `type CreateLabelTemplateRequest struct`
- `type UpdateLabelTemplateRequest struct`
- `func validResourceCategory(cat models.ResourceCategory) bool`
- `func validateMappings(mappings []models.LabelMapping) error`
- `func templateExistsByNameCategory(db *gorm.DB, name string, cat models.ResourceCategory) (bool, error)`
- `func CreateLabelTemplate(db *gorm.DB) gin.HandlerFunc`
- `func UpdateLabelTemplate(db *gorm.DB) gin.HandlerFunc`
- `func DeleteLabelTemplate(db *gorm.DB) gin.HandlerFunc`
- `func parseTemplateID(c *gin.Context) (uint, bool)`
- `func appendTemplateSnapshot(db *gorm.DB, templateID uint, changes []models.MappingChange) error`
- `func newMappingChanges(mappings []models.LabelMapping) []models.MappingChange`
- `func removedMappingChanges(mappings []models.LabelMapping) []models.MappingChange`

### `platform/config/label/template_crud_test.go`

- `func openCRUDTestDB(t *testing.T) *gorm.DB`
- `func mountCRUD(t *testing.T, db *gorm.DB) *gin.Engine`
- `func doJSON(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder`
- `func decodeTemplate(t *testing.T, w *httptest.ResponseRecorder) (int, models.LabelTemplate)`
- `func decodeTemplateID(t *testing.T, w *httptest.ResponseRecorder) (int, uint)`
- `func decodeErr(t *testing.T, w *httptest.ResponseRecorder) (int, response.Response)`
- `func countSnapshots(t *testing.T, db *gorm.DB, templateID uint) int64`
- `func lastSnapshot(t *testing.T, db *gorm.DB, templateID uint) models.LabelTemplateSnapshot`
- `func TestCreateLabelTemplateSuccess(t *testing.T)`
- `func TestCreateLabelTemplateDuplicateConflict(t *testing.T)`
- `func TestCreateLabelTemplateValidation(t *testing.T)`
- `func TestUpdateLabelTemplateSuccess(t *testing.T)`
- `func TestUpdateLabelTemplateResourceCategoryImmutable(t *testing.T)`
- `func TestUpdateLabelTemplateNotFound(t *testing.T)`
- `func TestDeleteLabelTemplateSuccess(t *testing.T)`
- `func TestDeleteLabelTemplateDefaultForbidden(t *testing.T)`
- `func TestDeleteLabelTemplateNotFound(t *testing.T)`
- `func TestCloneLabelTemplate(t *testing.T)`
- `func TestCloneLabelTemplateNameOverride(t *testing.T)`
- `func TestCloneLabelTemplateNotFound(t *testing.T)`
- `func openRollbackTestDB(t *testing.T) *gorm.DB`
- `func TestCreateLabelTemplateRollbackOnSnapshotFailure(t *testing.T)`

### `platform/config/resource/business.go`

- `type BusinessDomain struct`
- `type BusinessDomainStore struct`
- `func NewBusinessDomainStore(path string) *BusinessDomainStore`
- `method (*BusinessDomainStore) List() ([]BusinessDomain, error)`
- `method (*BusinessDomainStore) Lookup(code string) (BusinessDomain, bool, error)`
- `method (*BusinessDomainStore) EnabledList() ([]BusinessDomain, error)`
- `method (*BusinessDomainStore) GetEnabledMap() (map[string]BusinessDomain, error)`
- `method (*BusinessDomainStore) ensureLoadedLocked() error`
- `method (*BusinessDomainStore) reloadLocked(info os.FileInfo) error`
- `func ListBusinessDomains(store *BusinessDomainStore) gin.HandlerFunc`

### `platform/config/resource/business_test.go`

- `func writeDomains(t *testing.T, content string) string`
- `func TestNewBusinessDomainStoreLoadsEntries(t *testing.T)`
- `func TestInfraFallbackPresent(t *testing.T)`
- `func TestDisabledEntryExcludedFromEnabledList(t *testing.T)`
- `func TestHotReloadOnMtimeChange(t *testing.T)`
- `func TestMissingFileReturnsErrorWithoutPanic(t *testing.T)`
- `func TestLoadFailureKeepsLastSnapshot(t *testing.T)`
- `func TestListBusinessDomainsHandler(t *testing.T)`

### `platform/config/resource/create.go`

- `func networkDomainExistsFunc(db *gorm.DB) func(string) bool`
- `func newResourceID() (string, error)`
- `func newTypedModel(category models.ResourceCategory, resourceID string) (any, error)`
- `func buildResourceModel(category models.ResourceCategory, in *ResourceInput) (any, error)`
- `func applyInputToModel(category models.ResourceCategory, model any, in *ResourceInput)`
- `func strPtr(s string) *string`
- `func applyHostInput(h *models.Host, in *ResourceInput)`
- `func applyDatabaseInput(d *models.Database, in *ResourceInput)`
- `func applyMiddlewareInput(m *models.Middleware, in *ResourceInput)`
- `func applyApplicationInput(a *models.Application, in *ResourceInput)`
- `func applyGenericTargetInput(g *models.GenericTarget, in *ResourceInput)`
- `func CreateResource(db *gorm.DB, bizStore *BusinessDomainStore) gin.HandlerFunc`

### `platform/config/resource/create_update_test.go`

- `func openCreateUpdateTestDB(t *testing.T) *gorm.DB`
- `func mountCreateUpdate(t *testing.T, db *gorm.DB) *gin.Engine`
- `func seedDomain(t *testing.T, db *gorm.DB, id, name string) *models.NetworkDomain`
- `type cuResponse struct`
- `func doCreate(t *testing.T, r *gin.Engine, body map[string]interface{}) (*httptest.ResponseRecorder, cuResponse)`
- `func doUpdate(t *testing.T, r *gin.Engine, resourceID string, body map[string]interface{}) (*httptest.ResponseRecorder, cuRe…`
- `func loadHostByResourceID(t *testing.T, db *gorm.DB, resourceID string) *models.Host`
- `func hostBody() map[string]interface{}`
- `func TestCreateResource_Host_Success(t *testing.T)`
- `func TestCreateResource_EachCategory_Success(t *testing.T)`
- `func TestCreateResource_GeneratesUniqueUUID(t *testing.T)`
- `func TestCreateResource_DomainMissing(t *testing.T)`
- `func TestCreateResource_RegisteredDomainAccepted(t *testing.T)`
- `func TestCreateResource_BizDisabledRejected(t *testing.T)`
- `func TestCreateResource_FieldValidationError(t *testing.T)`
- `func TestUpdateResource_Success(t *testing.T)`
- `func TestUpdateResource_NotFound(t *testing.T)`
- `func TestUpdateResource_ResourceIDImmutable(t *testing.T)`
- `func TestUpdateResource_CategoryChangeRejected(t *testing.T)`
- `func TestUpdateResource_SourceTypeChangeRejected(t *testing.T)`
- `func TestUpdateResource_DomainValidationSameAsPost(t *testing.T)`

### `platform/config/resource/delete.go`

- `func DeleteResource(db *gorm.DB) gin.HandlerFunc`

### `platform/config/resource/delete_test.go`

- `func openDeleteTestDB(t *testing.T) *gorm.DB`
- `func mountDelete(t *testing.T, db *gorm.DB) *gin.Engine`
- `type delResponse struct`
- `func doDelete(t *testing.T, r *gin.Engine, resourceID string) (*httptest.ResponseRecorder, delResponse)`
- `func deleteCreate(t *testing.T, r *gin.Engine, body map[string]interface{}) string`
- `func assertSoftDeleted(t *testing.T, db *gorm.DB, category, resourceID string)`
- `func TestDeleteResource_Success(t *testing.T)`
- `func TestDeleteResource_NotFound(t *testing.T)`
- `func TestDeleteResource_DoubleDelete(t *testing.T)`
- `func TestDeleteResource_CleansResourceLabels(t *testing.T)`

### `platform/config/resource/excel.go`

- `type ImportRow struct`
- `type ImportRowError struct`
- `method (*ImportRowError) Error() string`
- `func ParseExcel(fileBytes []byte, category models.ResourceCategory) ([]ImportRow, error)`
- `func validateHeader(header, expected []string) error`
- `func applyCells(row *ImportRow, header, cells []string)`
- `func parsePort(raw string) (int, string)`
- `func allEmpty(cells []string) bool`
- `func ValidateImportRow(row *ImportRow, bizStore *BusinessDomainStore, networkDomainExists func(string) bool, extraRules []Ru…`
- `func fieldErr(row *ImportRow, field, value, reason string) error`
- `func parseCustomLabels(raw string) (map[string]string, error)`
- `func fieldFromResourceInputError(msg string) string`
- `func valueFromField(in *ResourceInput, field, portRaw string) string`
- `func ValidateRows(rows []ImportRow, bizStore *BusinessDomainStore, networkDomainExists func(string) bool, extraRules []Rule)…`

### `platform/config/resource/excel_test.go`

- `func buildXLSXWithHeader(t *testing.T, header []string, dataRows [][]string) []byte`
- `func buildXLSX(t *testing.T, category models.ResourceCategory, dataRows [][]string) []byte`
- `func makeRow(category models.ResourceCategory, vals map[string]string) []string`
- `func baseValues(category models.ResourceCategory) map[string]string`
- `func existsDomains(ids ...string) func(string) bool`
- `func mustParse(t *testing.T, category models.ResourceCategory, dataRows [][]string) []ImportRow`
- `func assertRowError(t *testing.T, err error, row int, field, value string) *ImportRowError`
- `func TestParseExcel_ValidRows(t *testing.T)`
- `func TestParseExcel_DatabasePortParsed(t *testing.T)`
- `func TestParseExcel_SkipsBlankRowsAndReturnsEmptyData(t *testing.T)`
- `func TestParseExcel_HeaderErrors(t *testing.T)`
- `func TestParseExcel_InvalidInput(t *testing.T)`
- `func TestValidateImportRow_Host(t *testing.T)`
- `func TestValidateImportRow_Database(t *testing.T)`
- `func TestValidateImportRow_Application(t *testing.T)`
- `func TestValidateImportRow_GenericTarget(t *testing.T)`
- `func TestValidateImportRow_ChineseStatusMapping(t *testing.T)`
- `func TestValidateImportRow_StatusMappingFailureCountsAsFailed(t *testing.T)`
- `func TestValidateRows_CollectsErrorsWithRowNumbers(t *testing.T)`
- `func TestValidateRows_UnregisteredDomainCollected(t *testing.T)`
- `func TestValidateImportRow_GeneratesDedupKeyForAllCategories(t *testing.T)`

### `platform/config/resource/import.go`

- `func ImportResources(db *gorm.DB, bizStore *BusinessDomainStore) gin.HandlerFunc`
- `func findExistingByDedupKey(db *gorm.DB, category models.ResourceCategory, row *ImportRow) (model any, found bool, err error)`
- `func setSourceType(model any, st models.SourceType)`
- `func newImportNo() string`

### `platform/config/resource/import_records.go`

- `func ListImports(db *gorm.DB) gin.HandlerFunc`
- `func GetImportRecord(db *gorm.DB) gin.HandlerFunc`
- `func isValidImportStatus(s string) bool`

### `platform/config/resource/import_test.go`

- `func openImportTestDB(t *testing.T) *gorm.DB`
- `func mountImport(t *testing.T, db *gorm.DB) *gin.Engine`
- `func seedHostImport(t *testing.T, db *gorm.DB, id, ip, instanceName, status string) *models.Host`
- `func seedImportRecord(t *testing.T, db *gorm.DB, importNo string, category models.ResourceCategory, status models.ImportStat…`
- `type importResponse struct`
- `func doImportUpload(t *testing.T, r *gin.Engine, typeName string, fileBytes []byte, form map[string]string) (*httptest.Respo…`
- `func doListImports(t *testing.T, r *gin.Engine, query string) (*httptest.ResponseRecorder, importListResponse)`
- `type importListResponse struct`
- `func doGetImport(t *testing.T, r *gin.Engine, importID string) (*httptest.ResponseRecorder, importDetailResponse)`
- `type importDetailResponse struct`
- `func loadLatestImport(t *testing.T, db *gorm.DB) *models.ImportRecord`
- `func countHosts(t *testing.T, db *gorm.DB) int64`
- `func hostRow(ip, status string) []string`
- `func TestImportResource_CreateOnly_Success(t *testing.T)`
- `func TestImportResource_CreateOnly_DuplicateFails(t *testing.T)`
- `func TestImportResource_Upsert_UpdatesExisting(t *testing.T)`
- `func TestImportResource_Upsert_Mixed(t *testing.T)`
- `func TestImportResource_InvalidMode(t *testing.T)`
- `func TestImportResource_UnknownCategory(t *testing.T)`
- `func TestImportResource_TypeFromPathFallback(t *testing.T)`
- `func TestImportResource_InvalidFileFormat(t *testing.T)`
- `func TestImportResource_MissingFile(t *testing.T)`
- `func TestImportResource_OversizedFileRejected(t *testing.T)`
- `func TestImportResource_InvalidRowsFailWithoutWrite(t *testing.T)`
- `func TestImportResource_EmptyFileData(t *testing.T)`
- `func TestListImports_FilterAndPagination(t *testing.T)`
- `func TestGetImportRecord_Detail(t *testing.T)`
- `func TestGetImportRecord_NotFound(t *testing.T)`

### `platform/config/resource/label_read.go`

- `type labelItem struct`
- `func GetResourceLabels(db *gorm.DB) gin.HandlerFunc`
- `func computeSystemLabels(db *gorm.DB, category models.ResourceCategory, res models.Resource) []labelItem`
- `func readStoredLabels(db *gorm.DB, resourceID string) ([]labelItem, error)`
- `func mergeLabels(system, stored []labelItem) []labelItem`

### `platform/config/resource/label_read_test.go`

- `func openLabelReadTestDB(t *testing.T) *gorm.DB`
- `func mountGetResourceLabels(t *testing.T, db *gorm.DB) *gin.Engine`
- `type labelReadItem struct`
- `type labelReadResponse struct`
- `func doGetResourceLabels(t *testing.T, r *gin.Engine, resourceID string) (*httptest.ResponseRecorder, labelReadResponse)`
- `func seedLabelReadHost(t *testing.T, db *gorm.DB, id string) *models.Host`
- `func seedLabelReadApplication(t *testing.T, db *gorm.DB, id string) *models.Application`
- `func hostLabelReadDefaultTemplate() *models.LabelTemplate`
- `func seedLabelReadTemplate(t *testing.T, db *gorm.DB, tmpl *models.LabelTemplate)`
- `func seedLabelReadUserLabel(t *testing.T, db *gorm.DB, resourceID, key, value string) *models.ResourceLabel`
- `func seedLabelReadCMDBLabel(t *testing.T, db *gorm.DB, resourceID, key, value string) *models.ResourceLabel`
- `func itemIndex(items []labelReadItem, key string) int`
- `func TestGetResourceLabelsSystemComputed(t *testing.T)`
- `func TestGetResourceLabelsUserStored(t *testing.T)`
- `func TestGetResourceLabelsMergeOrder(t *testing.T)`
- `func TestGetResourceLabelsSameKeyUserWins(t *testing.T)`
- `func TestGetResourceLabelsNotFound(t *testing.T)`
- `func TestGetResourceLabelsNoDefaultTemplate(t *testing.T)`

### `platform/config/resource/label_write.go`

- `type labelWriteRequest struct`
- `type labelValueRequest struct`
- `func CreateResourceLabel(db *gorm.DB) gin.HandlerFunc`
- `func UpdateResourceLabel(db *gorm.DB) gin.HandlerFunc`
- `func DeleteResourceLabel(db *gorm.DB) gin.HandlerFunc`
- `func parseLabelID(raw string) (uint, error)`
- `func findLabelByID(db *gorm.DB, resourceID string, labelID uint) (*models.ResourceLabel, error)`
- `func labelKeyIsSystem(db *gorm.DB, category models.ResourceCategory, model any, key string) bool`

### `platform/config/resource/label_write_test.go`

- `func openLabelWriteTestDB(t *testing.T) *gorm.DB`
- `func mountLabelWriteHandlers(t *testing.T, db *gorm.DB) *gin.Engine`
- `type labelWriteResponse struct`
- `func doCreateLabel(t *testing.T, r *gin.Engine, resourceID, body string) (*httptest.ResponseRecorder, labelWriteResponse)`
- `func doUpdateLabel(t *testing.T, r *gin.Engine, resourceID, labelID, body string) (*httptest.ResponseRecorder, labelWriteRes…`
- `func doDeleteLabel(t *testing.T, r *gin.Engine, resourceID, labelID string) (*httptest.ResponseRecorder, labelWriteResponse)`
- `func seedLabelWriteApplication(t *testing.T, db *gorm.DB, id string) *models.Application`
- `func seedLabelWriteHost(t *testing.T, db *gorm.DB, id string) *models.Host`
- `func seedLabelWriteDatabase(t *testing.T, db *gorm.DB, id string) *models.Database`
- `func seedLabelWriteMiddleware(t *testing.T, db *gorm.DB, id string) *models.Middleware`
- `func seedLabelWriteGenericTarget(t *testing.T, db *gorm.DB, id string) *models.GenericTarget`
- `func seedLabelWriteUserLabel(t *testing.T, db *gorm.DB, resourceID, key, value string) *models.ResourceLabel`
- `func seedLabelWriteCMDBLabel(t *testing.T, db *gorm.DB, resourceID, key, value string) *models.ResourceLabel`
- `func seedLabelWriteTemplate(t *testing.T, db *gorm.DB, tmpl *models.LabelTemplate)`
- `func applicationLabelDefaultTemplate() *models.LabelTemplate`
- `func countStoredLabels(t *testing.T, db *gorm.DB, resourceID string) int64`
- `func TestCreateResourceLabel_ApplicationSuccess(t *testing.T)`
- `func TestCreateResourceLabel_StaticResourceForbidden(t *testing.T)`
- `func TestCreateResourceLabel_ResourceNotFound(t *testing.T)`
- `func TestCreateResourceLabel_KeyInvalid(t *testing.T)`
- `func TestCreateResourceLabel_ProtectedKeyRejected(t *testing.T)`
- `func TestCreateResourceLabel_SystemKeyRejected(t *testing.T)`
- `func TestCreateResourceLabel_DuplicateKeyConflict(t *testing.T)`
- `func TestUpdateResourceLabel_Success(t *testing.T)`
- `func TestUpdateResourceLabel_NonUserForbidden(t *testing.T)`
- `func TestUpdateResourceLabel_StaticResourceForbidden(t *testing.T)`
- `func TestUpdateResourceLabel_NotFound(t *testing.T)`
- `func TestUpdateResourceLabel_ResourceNotFound(t *testing.T)`
- `func TestDeleteResourceLabel_Success(t *testing.T)`
- `func TestDeleteResourceLabel_NonUserForbidden(t *testing.T)`
- `func TestDeleteResourceLabel_StaticResourceForbidden(t *testing.T)`
- `func TestDeleteResourceLabel_NotFound(t *testing.T)`
- `func TestDeleteResourceLabel_ResourceNotFound(t *testing.T)`
- `func TestResourceLabelUniqueIndex(t *testing.T)`

### `platform/config/resource/list.go`

- `func ListResources(db *gorm.DB) gin.HandlerFunc`
- `func listCategory(db *gorm.DB, category models.ResourceCategory, f ListFilter) ([]map[string]interface{}, int64, error)`
- `func listTyped[T any](db *gorm.DB, category models.ResourceCategory, f ListFilter) ([]map[string]interface{}, int64, error)`
- `func buildListItem(res any, category models.ResourceCategory) map[string]interface{}`

### `platform/config/resource/list_test.go`

- `func openListTestDB(t *testing.T) *gorm.DB`
- `func mountListResources(t *testing.T, db *gorm.DB) *gin.Engine`
- `type resourceListResponse struct`
- `func doResourceList(t *testing.T, r *gin.Engine, query string) (*httptest.ResponseRecorder, resourceListResponse)`
- `func seedHostList(t *testing.T, db *gorm.DB, id, domain, name, ip, status string) *models.Host`
- `func seedDatabaseList(t *testing.T, db *gorm.DB, id, domain, ip string, port int, status string) *models.Database`
- `func seedMiddlewareList(t *testing.T, db *gorm.DB, id, domain, ip string, port int, status string) *models.Middleware`
- `func seedApplicationList(t *testing.T, db *gorm.DB, id, domain, service, endpoint, status string) *models.Application`
- `func seedGenericTargetList(t *testing.T, db *gorm.DB, id, domain, name, ip string, port int, status string) *models.GenericT…`
- `func TestListResourcesCategoryRequiredAndInvalid(t *testing.T)`
- `func TestListResourcesEachCategory(t *testing.T)`
- `func TestListResourcesResourceIDStableMergeKey(t *testing.T)`
- `func TestListResourcesItemFields(t *testing.T)`
- `func TestListResourcesGenericItemCustomLabels(t *testing.T)`
- `func TestListResourcesNetworkDomainFilter(t *testing.T)`
- `func TestListResourcesKeywordFilter(t *testing.T)`
- `func TestListResourcesFilterCombination(t *testing.T)`
- `func TestListResourcesPagination(t *testing.T)`
- `func TestListResourcesEmptyResult(t *testing.T)`
- `func TestListResourcesSoftDeleteExcluded(t *testing.T)`
- `func TestListResourcesBizCodeStatusFilter(t *testing.T)`
- `func TestListResourcesIsMonitoredPassthrough(t *testing.T)`
- `func TestParseIsMonitored(t *testing.T)`

### `platform/config/resource/monitored.go`

- `func ParseIsMonitored(raw string) (valid, monitored bool)`

### `platform/config/resource/os_options.go`

- `func ListOSOptions() gin.HandlerFunc`

### `platform/config/resource/os_options_test.go`

- `func TestListOSOptions(t *testing.T)`

### `platform/config/resource/query.go`

- `type PageParams struct`
- `func ParsePageParams(values url.Values) PageParams`
- `type ListFilter struct`
- `func ParseListFilter(values url.Values) ListFilter`
- `func BuildListQuery(db *gorm.DB, category models.ResourceCategory, f ListFilter) *gorm.DB`
- `func parseIntDefault(raw string, def, min int) int`

### `platform/config/resource/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB, bizStore *BusinessDomainStore)`
- `func withTypeParam(h gin.HandlerFunc) gin.HandlerFunc`
- `func listDomainOptions(db *gorm.DB) func() ([]DomainOption, error)`

### `platform/config/resource/status_mapping.go`

- `type Rule struct`
- `func MapStatus(source string, category models.ResourceCategory, extraRules []Rule) (models.ResourceStatus, error)`
- `func ruleMatches(r *Rule, source string) bool`
- `func ruleAppliesToCategory(r *Rule, category models.ResourceCategory) bool`
- `func betterRule(new, old *Rule) bool`
- `func defaultRules() []Rule`
- `func validStatus(s models.ResourceStatus) bool`

### `platform/config/resource/status_mapping_test.go`

- `func TestMapStatusDefaultChineseMappings(t *testing.T)`
- `func TestMapStatusEnglishValuesAndCaseInsensitive(t *testing.T)`
- `func TestMapStatusCategoryExactWinsOverGeneric(t *testing.T)`
- `func TestMapStatusPriorityDescending(t *testing.T)`
- `func TestMapStatusExtraRulesOverrideDefault(t *testing.T)`
- `func TestMapStatusDisabledRuleSkipped(t *testing.T)`
- `func TestMapStatusDefaultTargetFallback(t *testing.T)`
- `func TestMapStatusInvalidTargetReturnsError(t *testing.T)`

### `platform/config/resource/template.go`

- `type DomainOption struct`
- `func DownloadTemplate(bizStore *BusinessDomainStore, listDomains func() ([]DomainOption, error)) gin.HandlerFunc`
- `func buildValueSheet(bizStore *BusinessDomainStore, listDomains func() ([]DomainOption, error)) ([][]string, error)`
- `func statusValueDescription() string`
- `func buildTemplateXLSX(columns []string, valueRows [][]string) ([]byte, error)`

### `platform/config/resource/template_test.go`

- `func fakeDomains() ([]DomainOption, error)`
- `func setupTemplateRouter(t *testing.T) *gin.Engine`
- `func allCategories() []models.ResourceCategory`
- `func TestTemplateColumnsMatchPRD(t *testing.T)`
- `func TestDownloadTemplateHeaders(t *testing.T)`
- `func TestDownloadTemplateSheet1Columns(t *testing.T)`
- `func TestDownloadTemplateValueSheet(t *testing.T)`
- `func TestDownloadTemplateUnknownTypeNotFound(t *testing.T)`

### `platform/config/resource/update.go`

- `func findResourceByID(db *gorm.DB, resourceID string) (category models.ResourceCategory, model any, found bool, err error)`
- `func sourceTypeOf(model any) models.SourceType`
- `func updatableColumns(category models.ResourceCategory) []string`
- `func UpdateResource(db *gorm.DB, bizStore *BusinessDomainStore) gin.HandlerFunc`

### `platform/config/resource/validate.go`

- `type ResourceInput struct`
- `func ValidateResourceInput(category models.ResourceCategory, in *ResourceInput, bizStore *BusinessDomainStore, networkDomain…`
- `func validateCommon(in *ResourceInput, bizStore *BusinessDomainStore, networkDomainExists func(string) bool) error`
- `func validateBizCodeEnabled(code string, bizStore *BusinessDomainStore) error`
- `func validateHost(in *ResourceInput) error`
- `func validateDatabase(in *ResourceInput) error`
- `func validateMiddleware(in *ResourceInput) error`
- `func validateIPPortResource(in *ResourceInput) error`
- `func validateApplication(in *ResourceInput) error`
- `func validateGenericTarget(in *ResourceInput) error`
- `func IsValidIPv4(s string) bool`
- `func IsValidInstanceIP(s string) bool`
- `func ValidateHealthCheckURL(raw string) error`
- `func DedupKey(category models.ResourceCategory, in *ResourceInput) string`
- `func LegacyFieldMap(c models.ResourceCategory) map[string]string`
- `func GetResourceField(res any, field string) (string, bool)`
- `func isValidCategory(c models.ResourceCategory) bool`
- `func isValidStatus(s string) bool`
- `func containsString(list []string, v string) bool`

### `platform/config/resource/validate_test.go`

- `func newBizStore(t *testing.T) *BusinessDomainStore`
- `func alwaysExists(string) bool`
- `func validHostInput() *ResourceInput`
- `func TestValidateResourceInput_Host(t *testing.T)`
- `func TestValidateResourceInput_Database(t *testing.T)`
- `func TestValidateResourceInput_Middleware(t *testing.T)`
- `func TestValidateResourceInput_Application(t *testing.T)`
- `func TestValidateResourceInput_GenericTarget(t *testing.T)`
- `func TestValidateResourceInput_Common(t *testing.T)`
- `func TestDedupKey(t *testing.T)`
- `func TestLegacyFieldMap_Host(t *testing.T)`
- `func TestGetResourceField(t *testing.T)`
- `func TestParsePageParams(t *testing.T)`
- `func TestParseListFilter(t *testing.T)`
- `func selectModel(cat models.ResourceCategory) any`
- `func TestBuildListQuery(t *testing.T)`

### `platform/configcenter/change/watcher.go`

- `func Start(ctx context.Context, db *gorm.DB, minInterval, maxInterval time.Duration)`
- `func runDetectionPass(db *gorm.DB, minInterval, maxInterval time.Duration) error`
- `func ProcessDomain(db *gorm.DB, domainID string) error`
- `func ProcessDomainWithIntervals(db *gorm.DB, domainID string, minInterval, maxInterval time.Duration) error`
- `func loadBaseline(db *gorm.DB, domainID string) (*models.ConfigChangeBaseline, error)`
- `func upsertBaseline( db *gorm.DB, domainID, sourceVersion string, status models.ChangeDetectStatus, lastErr string, checkedA…`
- `func recordDetectFailed(db *gorm.DB, domainID, stage string, cause error, minInterval, maxInterval time.Duration) error`

### `platform/configcenter/change/watcher_test.go`

- `func newMemDB(t *testing.T) *gorm.DB`
- `func seedDomain(t *testing.T, db *gorm.DB, id string, monitored bool)`
- `func seedHost(t *testing.T, db *gorm.DB, domainID, resourceID string)`
- `func setHostUpdatedAt(t *testing.T, db *gorm.DB, resourceID string, ts time.Time)`
- `func seedJob(t *testing.T, db *gorm.DB, domainID, name string) *models.ScrapeJob`
- `func countDrafts(t *testing.T, db *gorm.DB, domainID string) int64`
- `func loadBaselineForTest(t *testing.T, db *gorm.DB, domainID string) *models.ConfigChangeBaseline`
- `func forceCheckNow(t *testing.T, db *gorm.DB, domainID string)`
- `func TestProcessDomain_FirstRunInitializesWithoutGenerating(t *testing.T)`
- `func TestProcessDomain_ChangeGeneratesPending(t *testing.T)`
- `func TestProcessDomain_ChangeWithLivePendingSkips(t *testing.T)`
- `func TestProcessDomain_LivePendingSupersededOnChecksumChange(t *testing.T)`
- `func TestProcessDomain_NoChangesSuppressed(t *testing.T)`
- `func TestProcessDomain_GenerateFailDoesNotAdvanceVersion(t *testing.T)`
- `func TestProcessDomain_AdaptiveBackoff(t *testing.T)`
- `func versionAtInit(t *testing.T, db *gorm.DB, domainID string) string`

### `platform/configcenter/deployment/callback.go`

- `func writebackChangeStatus(db *gorm.DB, domainID string) error`
- `func writebackRuleChangeStatus(db *gorm.DB) error`
- `func writebackChangeStatuses(db *gorm.DB, domainID string) error`

### `platform/configcenter/deployment/deployment_test.go`

- `func newMemDB(t *testing.T) *gorm.DB`
- `func seedLocalDomain(t *testing.T, db *gorm.DB, id string)`
- `func seedAgentPullDomain(t *testing.T, db *gorm.DB, id string)`
- `func seedVersion(t *testing.T, db *gorm.DB, domainID, changeNo string) *models.ConfigVersion`
- `func seedDeployment(t *testing.T, db *gorm.DB, domainID string, v *models.ConfigVersion, status models.DeploymentStatus, err…`
- `func idStr(id uint) string`
- `func seedJob(t *testing.T, db *gorm.DB, domainID string, changeStatus models.ChangeStatus) *models.ScrapeJob`
- `func seedJobWithDraft(t *testing.T, db *gorm.DB, domainID string, changeStatus models.ChangeStatus, draftStatus string) *mod…`
- `func seedRule(t *testing.T, db *gorm.DB, name string, changeStatus models.ChangeStatus, draftStatus string) *models.Monitori…`
- `func newMemDBNoJobTable(t *testing.T) *gorm.DB`
- `type applyRecorder struct`
- `method (*applyRecorder) Apply(*generator.ConfigArtifacts) error`
- `func TestDispatchLocalSuccessWritesBackChangeStatus(t *testing.T)`
- `func TestDispatchLocalFailureRecordsFailed(t *testing.T)`
- `func TestDispatchAgentPullPlaceholder(t *testing.T)`
- `func TestRetryLocalFailed(t *testing.T)`
- `func TestRetryRejectsNonLocal(t *testing.T)`
- `func TestRetryRejectsNotFailed(t *testing.T)`
- `func TestRollbackCreatesSuccessDeployment(t *testing.T)`
- `func TestRollbackVersionNotFound(t *testing.T)`
- `func TestDispatchWritebackFailureDegrades(t *testing.T)`
- `func TestWritebackChangeStatusFiltersDraftReady(t *testing.T)`
- `func TestWritebackRuleChangeStatus(t *testing.T)`
- `func TestDiskApplierWritesTargetsAndReloadsOnlyOnStructuralChange(t *testing.T)`
- `func TestListAndGetVersion(t *testing.T)`
- `func TestListDeploymentsFilter(t *testing.T)`
- `func TestDeploymentHandlerRoutes(t *testing.T)`
- `func mustJSON(t *testing.T, s string) *strings.Reader`

### `platform/configcenter/deployment/handler.go`

- `func queryPage(c *gin.Context) (page, pageSize int)`
- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`
- `func ListVersionsHandler(db *gorm.DB) gin.HandlerFunc`
- `func GetVersionHandler(db *gorm.DB) gin.HandlerFunc`
- `func ListDeploymentsHandler(db *gorm.DB) gin.HandlerFunc`
- `func RetryDeploymentHandler(db *gorm.DB) gin.HandlerFunc`
- `func RollbackDeploymentHandler(db *gorm.DB) gin.HandlerFunc`
- `func respondDeploymentError(c *gin.Context, err error)`

### `platform/configcenter/deployment/history.go`

- `func ListVersions(db *gorm.DB, domainID, changeNo string, page, pageSize int) ([]models.ConfigVersion, int64, error)`
- `func GetVersion(db *gorm.DB, ref string) (*models.ConfigVersion, error)`
- `func isNumeric(s string) bool`
- `func loadVersionByChangeNo(db *gorm.DB, changeNo string) (*models.ConfigVersion, error)`
- `func ListDeployments(db *gorm.DB, domainID, status, changeNo string, page, pageSize int) ([]models.ConfigDeployment, int64, …`
- `func pagedVersions(db *gorm.DB, q *gorm.DB, page, pageSize int) ([]models.ConfigVersion, int64, error)`
- `func pagedDeployments(db *gorm.DB, q *gorm.DB, page, pageSize int) ([]models.ConfigDeployment, int64, error)`

### `platform/configcenter/deployment/service.go`

- `type Applier interface`
- `type noopApplier struct`
- `method (noopApplier) Apply(*generator.ConfigArtifacts) error`
- `func Dispatch(db *gorm.DB, version *models.ConfigVersion, triggeredBy string, app Applier) (*models.ConfigDeployment, error)`
- `func DeployConfirmedVersion(db *gorm.DB, version *models.ConfigVersion, triggeredBy string) (*models.ConfigDeployment, error)`
- `func Retry(db *gorm.DB, deploymentID, triggeredBy string, app Applier) (*models.ConfigDeployment, error)`
- `func Rollback(db *gorm.DB, versionID, triggeredBy string, app Applier) (*models.ConfigDeployment, error)`
- `func dispatchVersion(db *gorm.DB, version *models.ConfigVersion, dom *models.NetworkDomain, triggeredBy string, app Applier)…`
- `func applySafe(app Applier, ca *generator.ConfigArtifacts) error`
- `func localReloadURL(dom *models.NetworkDomain) string`
- `func loadDomain(db *gorm.DB, id string) (*models.NetworkDomain, error)`
- `func loadVersion(db *gorm.DB, id string) (*models.ConfigVersion, error)`
- `func artifactsFromVersion(v *models.ConfigVersion) (*generator.ConfigArtifacts, error)`
- `type DiskApplier struct`
- `method (*DiskApplier) Apply(ca *generator.ConfigArtifacts) error`
- `method (*DiskApplier) writeStructural(ca *generator.ConfigArtifacts) error`
- `method (*DiskApplier) writeTargets(files map[string]string) error`
- `func structuralChanged(ca *generator.ConfigArtifacts, dir string) (bool, error)`
- `func writeFile(path, content string) error`

### `platform/configcenter/domain/onboard.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`
- `func MonitorDomainHandler(db *gorm.DB) gin.HandlerFunc`
- `func UpdateDomainMonitoringHandler(db *gorm.DB) gin.HandlerFunc`
- `func ResetTokenHandler(db *gorm.DB) gin.HandlerFunc`
- `func respondDomainError(c *gin.Context, err error)`

### `platform/configcenter/domain/onboard_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func seedDomain(t *testing.T, db *gorm.DB, id string, domainType models.DomainType, monitored bool) *models.NetworkDomain`
- `func newGin() *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path string, body string) *httptest.ResponseRecorder`
- `func TestMonitorDomainDefaultForcesLocal(t *testing.T)`
- `func TestMonitorDomainEdgeAgentPullSignsToken(t *testing.T)`
- `func TestMonitorDomainRejectsAlreadyMonitored(t *testing.T)`
- `func TestMonitorDomainRejectsInvalidAgentType(t *testing.T)`
- `func TestMonitorDomainNotFound(t *testing.T)`
- `func TestResetDomainTokenEdgePush(t *testing.T)`
- `func TestResetDomainTokenRejectsLocal(t *testing.T)`
- `func TestResetDomainTokenRejectsNotMonitored(t *testing.T)`
- `func TestUpdateDomainMonitoring(t *testing.T)`
- `func TestUpdateDomainMonitoringUnmonitor(t *testing.T)`
- `func TestUpdateDomainMonitoringRequiresMonitored(t *testing.T)`
- `func TestMonitorHandlerRoutes(t *testing.T)`
- `func TestResetTokenHandler(t *testing.T)`

### `platform/configcenter/domain/service.go`

- `type MonitorParams struct`
- `type MonitorOutcome struct`
- `type UpdateParams struct`
- `type TokenResult struct`
- `func MonitorDomain(db *gorm.DB, id string, p MonitorParams) (MonitorOutcome, error)`
- `func UpdateDomainMonitoring(db *gorm.DB, id string, p UpdateParams) (*models.NetworkDomain, error)`
- `func ResetDomainToken(db *gorm.DB, id string) (TokenResult, error)`
- `func newToken() (string, error)`

### `platform/configcenter/draft/change_items.go`

- `func buildChangeItems(jobs []models.ScrapeJob, rules []models.MonitoringRule, artifacts *generator.ConfigArtifacts, base *mo…`
- `func buildInitialChangeItems(jobs []models.ScrapeJob, rules []models.MonitoringRule) []models.ConfigChangeItem`
- `func diffJobItems(jobs []models.ScrapeJob, artifacts *generator.ConfigArtifacts, base *models.ConfigVersion) []models.Config…`
- `func diffRuleItems(newRulesYML, baseRulesYML string) []models.ConfigChangeItem`
- `func jobAffectedFiles(isBlackbox bool) []string`
- `func snapshotScrapeConfigs(promYML string) map[string]string`
- `func snapshotRuleGroups(rulesYML string) (map[string]string, error)`
- `func normalizeYAML(v interface{}) string`
- `func sortedKeys(m map[string]string) []string`

### `platform/configcenter/draft/draft_test.go`

- `func newMemDB(t *testing.T) *gorm.DB`
- `func seedMonitoredDomain(t *testing.T, db *gorm.DB, id string, monitored bool)`
- `func seedDraftWithStatus(t *testing.T, db *gorm.DB, changeNo, domainID, status string, valStatus string) *models.ConfigDraft`
- `func newGin() *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path string, body string) *httptest.ResponseRecorder`
- `func unmarshalData(t *testing.T, w *httptest.ResponseRecorder) map[string]interface{}`
- `func TestGenerateDraftCreatesPending(t *testing.T)`
- `func TestGenerateDraftReturnsExistingLivePending(t *testing.T)`
- `func TestGenerateDraftRejectsNotMonitored(t *testing.T)`
- `func TestGenerateDraftRejectsFrozenDomain(t *testing.T)`
- `func TestGenerateDraftChangeNoSequence(t *testing.T)`
- `func TestGenerateDraftBuildsChangeItemsWithJobsAndRules(t *testing.T)`
- `func TestGenerateDraftPropagatesLoadFailure(t *testing.T)`
- `func TestGenerateDraftDiffRemoveOnDisableJob(t *testing.T)`
- `func TestGenerateDraftNoDiffReturnsErrNoChanges(t *testing.T)`
- `func TestGenerateDraftBackfillsSourceVersion(t *testing.T)`
- `func TestConfirmDraftKeepsSourceVersion(t *testing.T)`
- `func TestConfirmDraftRejectsUnpassedValidation(t *testing.T)`
- `func TestConfirmDraftCreatesVersion(t *testing.T)`
- `func TestConfirmDraftRejectsNonPending(t *testing.T)`
- `func TestDiscardDraft(t *testing.T)`
- `func TestDiscardDraftRejectsNonPending(t *testing.T)`
- `func TestGetDraftNotFound(t *testing.T)`
- `func TestListDraftsFilterAndPagination(t *testing.T)`
- `func TestListDraftsEmptyDomainReturnsAll(t *testing.T)`
- `func TestRevalidateDraftPersistsAndExposesMessage(t *testing.T)`
- `func TestDraftHandlerRoutes(t *testing.T)`
- `func TestDraftHandlerDiscardValidationFailed(t *testing.T)`
- `func TestDiscardDraftImpactAndRollback(t *testing.T)`
- `func TestDiscardDraftRevertsNewJobOnFirstDeploy(t *testing.T)`
- `func TestDiscardImpactHandler(t *testing.T)`
- `func todaySuffix() string`

### `platform/configcenter/draft/handler.go`

- `func queryPage(c *gin.Context) (page, pageSize int)`
- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`
- `func GenerateDraftHandler(db *gorm.DB) gin.HandlerFunc`
- `func ListDraftsHandler(db *gorm.DB) gin.HandlerFunc`
- `func GetDraftHandler(db *gorm.DB) gin.HandlerFunc`
- `func ConfirmDraftHandler(db *gorm.DB) gin.HandlerFunc`
- `func RevalidateDraftHandler(db *gorm.DB) gin.HandlerFunc`
- `func DiscardDraftHandler(db *gorm.DB) gin.HandlerFunc`
- `func DiscardImpactHandler(db *gorm.DB) gin.HandlerFunc`
- `func respondDraftError(c *gin.Context, err error)`

### `platform/configcenter/draft/service.go`

- `func GenerateDraft(db *gorm.DB, domainID string) (*models.ConfigDraft, error)`
- `func buildArtifacts(db *gorm.DB, dom *models.NetworkDomain) (*generator.ConfigArtifacts, []models.ScrapeJob, []models.Monito…`
- `func LatestLivePending(db *gorm.DB, domainID string) (*models.ConfigDraft, error)`
- `func ShouldSupersedePending(db *gorm.DB, dom *models.NetworkDomain, pending *models.ConfigDraft) (bool, error)`
- `func latestLivePending(db *gorm.DB, domainID string) (*models.ConfigDraft, error)`
- `func reconcileWithExistingPending( db *gorm.DB, existing *models.ConfigDraft, artifacts *generator.ConfigArtifacts, jobs []m…`
- `func lastConfirmedVersion(db *gorm.DB, domainID string) (*models.ConfigVersion, error)`
- `func jobNameOr(name, fallback string) string`
- `func highRisk(items []models.ConfigChangeItem) bool`
- `func computeRisk(items []models.ConfigChangeItem) string`
- `func affectedFiles(items []models.ConfigChangeItem) []string`
- `func buildSummary(items []models.ConfigChangeItem) string`
- `func summaryTarget(target string) (label, unit string)`
- `func join(parts []string, sep string) string`
- `func nextChangeNo(db *gorm.DB) (string, error)`
- `func ListDrafts(db *gorm.DB, domainID, status string, page, pageSize int) ([]models.ConfigDraft, int64, error)`
- `func GetDraftDetail(db *gorm.DB, changeNo string) (*models.ConfigDraft, error)`
- `func ConfirmDraft(db *gorm.DB, changeNo, confirmedBy string) (*models.ConfigVersion, error)`
- `type DiscardImpact struct`
- `func DiscardDraft(db *gorm.DB, changeNo string) (*models.ConfigDraft, *DiscardImpact, error)`
- `func GetDiscardImpact(db *gorm.DB, changeNo string) (*DiscardImpact, error)`
- `func computeDiscardImpact(db *gorm.DB, d *models.ConfigDraft) (*DiscardImpact, error)`
- `func jobNamesFromLiveVersion(db *gorm.DB, d *models.ConfigDraft) (map[string]bool, error)`
- `func scrapeJobNamesFromPrometheusYml(yml string) (map[string]bool, error)`
- `func RevalidateDraft(db *gorm.DB, changeNo string) (*models.ConfigDraft, error)`
- `func artifactsFromDraft(d *models.ConfigDraft) (*generator.ConfigArtifacts, error)`

### `platform/configcenter/draft/service_test.go`

- `func newTestDB(t *testing.T) *gorm.DB`
- `func seedDomain(t *testing.T, db *gorm.DB, id string) *models.NetworkDomain`
- `func seedHost(t *testing.T, db *gorm.DB, domainID, resourceID string)`
- `func seedJob(t *testing.T, db *gorm.DB, domainID, name string) *models.ScrapeJob`
- `func touchJob(t *testing.T, db *gorm.DB, id uint)`
- `func draftCount(t *testing.T, db *gorm.DB, domainID string) int64`
- `func loadDraftMeta(t *testing.T, db *gorm.DB, changeNo string) models.ConfigDraftMetadata`
- `func TestGenerateDraft_IdempotentWhenNoChange(t *testing.T)`
- `func TestGenerateDraft_SupersedeWhenSourceChanged(t *testing.T)`
- `func TestGenerateDraft_DomainNotMonitored(t *testing.T)`
- `func TestGenerateDraft_NoChangesSuppressed(t *testing.T)`
- `func TestShouldSupersedePending_ChecksumCompare(t *testing.T)`
- `func TestShouldSupersedePending_BrokenMetadata(t *testing.T)`

### `platform/configcenter/generator/change_detect.go`

- `func SourceDataVersion(db *gorm.DB, domainID string) (string, error)`
- `func NeedsRegeneration(prevSourceVersion, newSourceVersion string) bool`

### `platform/configcenter/generator/data_source.go`

- `type Inputs struct`
- `type resourceTarget struct`
- `func LoadDomain(db *gorm.DB, domainID string) (*models.NetworkDomain, error)`
- `func LoadJobs(db *gorm.DB, domainID string) ([]models.ScrapeJob, error)`
- `func LoadRules(db *gorm.DB) ([]models.MonitoringRule, error)`
- `func LoadDefaultTemplate(db *gorm.DB, category models.ResourceCategory) (*models.LabelTemplate, error)`
- `func LoadTemplateForJob(db *gorm.DB, job models.ScrapeJob) (*models.LabelTemplate, error)`
- `func LoadExporterPort(db *gorm.DB, job models.ScrapeJob) (int, error)`
- `type ErrNotFound struct`
- `method (ErrNotFound) Error() string`

### `platform/configcenter/generator/generator.go`

- `type ConfigArtifacts struct`
- `type TargetGroup struct`
- `func buildExternalLabels(domainID, zoneType, replica string) map[string]string`
- `method (*ConfigArtifacts) Checksum() string`
- `method (*ConfigArtifacts) ArtifactsChanged(activeChecksum string) bool`
- `func NormalizeJobFilename(jobName string) string`
- `func normalizeJobFilename(jobName string) string`

### `platform/configcenter/generator/generator_test.go`

- `func newMemDB(t *testing.T) *gorm.DB`
- `func TestAssemblePrometheusExternalLabels(t *testing.T)`
- `func TestAssembleFileSDNotInline(t *testing.T)`
- `func TestAssembleAuthTLSPassthrough(t *testing.T)`
- `func TestAssembleRulesYAMLPassthrough(t *testing.T)`
- `func TestAssembleRuleFilesOmittedWhenNoRules(t *testing.T)`
- `func TestAssembleRendersScrapeIntervalTimeout(t *testing.T)`
- `func TestAssembleBlackbox(t *testing.T)`
- `func TestNormalizeJobFilename(t *testing.T)`
- `func TestChecksumConsistency(t *testing.T)`
- `func TestResolveTargetsOfflineExclusion(t *testing.T)`
- `func TestResolveTargetsUnconfirmedIncluded(t *testing.T)`
- `func TestResolveTargetsExporterPort(t *testing.T)`
- `func TestLoadExporterPortPriority(t *testing.T)`
- `func TestMergeLabelsPriority(t *testing.T)`
- `func TestValidateTargetGroups(t *testing.T)`
- `func TestValidateArtifactsPendingWhenToolMissing(t *testing.T)`
- `func TestValidateArtifactsPassed(t *testing.T)`
- `func TestValidateArtifactsFailedSchema(t *testing.T)`
- `func TestSourceDataVersionAndNeedsRegeneration(t *testing.T)`
- `func TestExpandLabelTemplateComposite(t *testing.T)`
- `func TestMarshalTargetGroupsJSON(t *testing.T)`

### `platform/configcenter/generator/labels.go`

- `func mergeLabels(system, user, cmdb map[string]string) map[string]string`
- `func expandLabelTemplate(tmpl *models.LabelTemplate, fields map[string]string, address string) map[string]string`
- `func mergeIntoLabels(templateLabels map[string]string) map[string]string`

### `platform/configcenter/generator/render.go`

- `type cfgGlobal struct`
- `type cfgFile struct`
- `type scrapeConf struct`
- `type basicAuthConf struct`
- `type authorizationConf struct`
- `type tlsConf struct`
- `type fileSDConf struct`
- `type relabelConf struct`
- `type JobBuild struct`
- `func Assemble(domainID, zoneType, replica string, jobs []JobBuild, rules []models.MonitoringRule) (*ConfigArtifacts, error)`
- `func jobScrapeConfig(job models.ScrapeJob) (scrapeConf, error)`
- `func orDefault(v, d string) string`
- `type ruleGroupsFile struct`
- `func renderRules(rules []models.MonitoringRule) string`
- `func renderBlackbox(modules map[string]struct{}) string`
- `func renderBlackboxModule(module string) string`

### `platform/configcenter/generator/targets.go`

- `func exporterPortOr(exporterPort, fallback int) int`
- `func resolveResource(db *gorm.DB, resourceID string, exporterPort int) (*resourceTarget, error)`
- `func instanceAddress(ip string, port int) string`
- `func ResolveJobTargets(db *gorm.DB, job models.ScrapeJob, tmpl *models.LabelTemplate, exporterPort int) ([]TargetGroup, erro…`
- `func MarshalTargetGroups(groups []TargetGroup) (string, error)`

### `platform/configcenter/generator/validate.go`

- `func ValidateTargetGroups(groups []TargetGroup) error`
- `func validateTargetAddress(addr string) error`
- `func validTargetHost(host string) bool`
- `func validateLabelName(name string) error`
- `func ValidateArtifacts(ca *ConfigArtifacts, includeBlackbox bool) (models.ValidationStatus, models.ValidationCause, []models…`
- `func runToolChecks(ca *ConfigArtifacts, includeBlackbox bool) (bool, string)`
- `func runPromtoolCheck(ca *ConfigArtifacts) error`
- `func runBlackboxCheck(blackboxYAML string) error`

### `platform/configcenter/register.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`

### `platform/dashboard/summary.go`

- `type DeploymentItem struct`
- `type Summary struct`
- `func Build(db *gorm.DB) (*Summary, error)`
- `func SummaryHandler(db *gorm.DB) gin.HandlerFunc`

### `platform/dashboard/summary_test.go`

- `func strPtr(s string) *string`
- `func newTestDB(t *testing.T) *gorm.DB`
- `func seed(t *testing.T, db *gorm.DB)`
- `func runSummaryRequest(t *testing.T, db *gorm.DB) (int, Summary)`
- `func TestSummaryHandler(t *testing.T)`
- `func TestSummaryHandlerEmpty(t *testing.T)`

### `platform/db/db.go`

- `func Init() error`
- `func AutoMigrate() error`
- `func Health() error`

### `platform/db/db_test.go`

- `func TestInitWithEnvDSN(t *testing.T)`
- `func TestAutoMigrate(t *testing.T)`
- `func TestInitDefaultPath(t *testing.T)`
- `func TestAuthTablesMigrated(t *testing.T)`
- `func TestHealthWithoutInit(t *testing.T)`
- `func TestSharedTablesCreatedAndHealthOK(t *testing.T)`

### `platform/db/seed/admin.go`

- `func runAdminUser(db *gorm.DB) error`

### `platform/db/seed/admin_test.go`

- `func TestRunSeedsAdminUser(t *testing.T)`
- `func TestRunAdminIsIdempotent(t *testing.T)`
- `func TestRunAdminKeepsModifiedPassword(t *testing.T)`
- `func TestRunAdminPasswordFromEnv(t *testing.T)`
- `func TestAdminUser_ProductionRequiresEnvPassword(t *testing.T)`

### `platform/db/seed/exporter.go`

- `func runExporters(db *gorm.DB) error`

### `platform/db/seed/label_template.go`

- `func runLabelTemplates(db *gorm.DB) error`
- `func ensureResourceIDMapping(db *gorm.DB, name string) error`

### `platform/db/seed/metric_library.go`

- `type builtinMetricSeed struct`
- `func BuiltinMetricLibrary() []builtinMetricSeed`
- `func runMetricLibrary(db *gorm.DB) error`

### `platform/db/seed/seed.go`

- `func Run(db *gorm.DB) error`
- `func firstOrCreate(db *gorm.DB, out interface{}, query string, args ...interface{}) error`

### `platform/db/seed/seed_test.go`

- `func newTestDB(t *testing.T) *gorm.DB`
- `func countRows(t *testing.T, db *gorm.DB, model interface{}, out *int64)`
- `func TestRunSeedsTenantAndDefaultDomain(t *testing.T)`
- `func TestRunSeedsZoneTypes(t *testing.T)`
- `func TestRunSeedsLabelTemplates(t *testing.T)`
- `func TestRunLabelTemplatesBackfillsResourceID(t *testing.T)`
- `func TestRunSeedsExportersAndMappings(t *testing.T)`
- `func TestRunExportersBackfillsBuiltinCanonicalFields(t *testing.T)`
- `func TestRunIsIdempotent(t *testing.T)`
- `func TestRunNilDBReturnsError(t *testing.T)`
- `func TestRunSeedsMetricLibrary(t *testing.T)`
- `func TestRunSeedsDomainIsMonitored(t *testing.T)`
- `func TestRunSeedsDefaultDomainAuthorized(t *testing.T)`
- `func TestRunBackfillsAuthorizedOnExistingDefault(t *testing.T)`

### `platform/db/seed/ten_domain.go`

- `func runTenantAndDomain(db *gorm.DB) error`

### `platform/db/seed/zone_type.go`

- `func runZoneTypes(db *gorm.DB) error`

### `platform/examples/simple-agent/main.go`

- `func init()`
- `func main()`
- `func simulateMetrics()`

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

### `platform/models/alertmanager_config.go`

- `type AlertmanagerConfigStatus = string`
- `type AlertmanagerConfigVersion struct`
- `method (AlertmanagerConfigVersion) TableName() string`
- `method (AlertmanagerConfigVersion) MarshalJSON() ([]byte, error)`
- `func AlertmanagerConfigChecksum(content string) string`
- `type SilenceMatcher struct`
- `type SilenceStatus = string`
- `func ValidSilenceStatus() []string`
- `type AuthorizedMatcherScope struct`
- `method (*AuthorizedMatcherScope) Violations(matchers []SilenceMatcher) []SilenceMatcher`
- `type ValidateErrorItem struct`

### `platform/models/alertmanager_config_test.go`

- `func TestAlertmanagerConfigStatusEnum(t *testing.T)`
- `func TestAlertmanagerConfigChecksum(t *testing.T)`
- `func TestAlertmanagerConfigVersionSerializationRoundTrip(t *testing.T)`
- `type AlertmanagerConfigVersionView struct`
- `func TestAlertmanagerConfigVersionAutoMigrate(t *testing.T)`
- `func TestSilenceMatcherJSONRoundTrip(t *testing.T)`
- `func TestSilenceStatusEnum(t *testing.T)`
- `func TestAuthorizedMatcherScopeAllDomainsAlwaysPasses(t *testing.T)`
- `func TestAuthorizedMatcherScopeRestrictsNetworkDomain(t *testing.T)`
- `func TestValidateErrorItemJSON(t *testing.T)`

### `platform/models/blackbox_probe.go`

- `type BlackboxProbeConfig struct`

### `platform/models/blackbox_target.go`

- `type BlackboxTargetProtocol = string`
- `func ValidBlackboxTargetProtocols() []BlackboxTargetProtocol`
- `func ValidBlackboxTargetProtocol(p string) bool`
- `type BlackboxTarget struct`

### `platform/models/business_metric.go`

- `type BusinessMetricSource = string`
- `type BusinessMetricStatus = string`
- `type BusinessMetric struct`
- `method (BusinessMetric) TableName() string`

### `platform/models/ci_exporter_mapping.go`

- `type CITypeExporterMapping struct`
- `method (CITypeExporterMapping) TableName() string`

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

### `platform/models/config_center_rules.go`

- `type ValidationStatus = string`
- `type ValidationCause = string`
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

### `platform/models/database.go`

- `type Database struct`
- `method (*Database) GetResourceType() ResourceType`
- `method (*Database) GetResourceCategory() ResourceCategory`

### `platform/models/edge_agent.go`

- `type EdgeAgent struct`
- `method (EdgeAgent) TableName() string`

### `platform/models/exporter_installation_confirmation.go`

- `type InstallationStatus = string`
- `type ExporterInstallationConfirmation struct`
- `method (ExporterInstallationConfirmation) TableName() string`

### `platform/models/exporter_metric_library.go`

- `type MetricType = string`
- `func ValidMetricTypes() []MetricType`
- `func ValidMetricType(mt string) bool`
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
- `method (*Host) GetAppName() string`
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

### `platform/models/label_rules.go`

- `func IsProtectedLabel(key string) bool`
- `func ValidateLabelKey(key string) error`

### `platform/models/label_template.go`

- `type LabelSourceType = string`
- `type LabelMapping struct`
- `type LabelTemplate struct`
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
- `func TestNetworkDomainDefaultLocal(t *testing.T)`
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
- `func TestMonitorTypeDerivationMapFull(t *testing.T)`
- `func TestValidMonitorTypes(t *testing.T)`
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

### `platform/models/monitor_type.go`

- `func ValidMonitorTypes() []string`
- `func ValidMonitorType(mt string) bool`
- `func monitorKey(category ResourceCategory, subtype string) string`
- `type MonitorTypeDerivation struct`
- `func DeriveMonitorType(category ResourceCategory, subtype string) (string, bool)`
- `func DeriveResourceFilter(monitorType string) (MonitorTypeDerivation, bool)`
- `method (MonitorTypeDerivation) hostOSMatches(image string) bool`

### `platform/models/monitoring_rule.go`

- `type RuleContentMode = string`
- `type ScopeType = string`
- `type MonitoringRule struct`

### `platform/models/network_domain.go`

- `type DomainType = string`
- `type DomainStatus = string`
- `type ChannelType = string`
- `type AgentType = string`
- `type NetworkDomain struct`
- `method (*NetworkDomain) IsManagement() bool`
- `method (*NetworkDomain) AfterFind(tx *gorm.DB) error`
- `method (NetworkDomain) TableName() string`

### `platform/models/os_dict.go`

- `type OSOption struct`
- `func ListOSOptions() []OSOption`
- `func ResolveOSFamily(name string) string`
- `func osKeywordsFor(family string) []string`
- `func OSKeywordsForLinux() []string`
- `func OSKeywordsForWindows() []string`
- `func NormalizeOSType(raw string) string`
- `func isWindowsLike(lower string) bool`
- `func isLinuxLike(lower string) bool`
- `func containsWord(lower, word string) bool`
- `func isWordChar(r rune) bool`

### `platform/models/os_dict_test.go`

- `func TestNormalizeOSType(t *testing.T)`
- `func TestResolveOSFamily(t *testing.T)`
- `func TestOSKeywordsFor(t *testing.T)`
- `func TestOSOptionsAllClassified(t *testing.T)`
- `func familyNames(family string) []string`
- `func contains(kws []string, kw string) bool`

### `platform/models/resource.go`

- `type ResourceType = string`
- `type BaseModel struct`
- `type Resource interface`
- `type Middleware struct`
- `type Application struct`
- `method (*Middleware) GetResourceID() string`
- `method (*Middleware) GetResourceType() ResourceType`
- `method (*Middleware) GetAppName() string`
- `method (*Middleware) GetEnv() string`
- `method (*Middleware) GetCluster() string`
- `method (*Middleware) GetStatus() string`
- `method (*Application) GetResourceID() string`
- `method (*Application) GetResourceType() ResourceType`
- `method (*Application) GetAppName() string`
- `method (*Application) GetEnv() string`
- `method (*Application) GetCluster() string`
- `method (*Application) GetStatus() string`
- `method (*Middleware) GetResourceCategory() ResourceCategory`
- `method (*Application) GetResourceCategory() ResourceCategory`

### `platform/models/resource_base.go`

- `type SourceType = string`
- `type ResourceBase struct`
- `method (*ResourceBase) GetResourceID() string`
- `method (*ResourceBase) GetAppName() string`
- `method (*ResourceBase) GetEnv() string`
- `method (*ResourceBase) GetCluster() string`
- `method (*ResourceBase) GetStatus() string`

### `platform/models/resource_category.go`

- `type ResourceCategory = string`
- `func ValidResourceCategories() []ResourceCategory`

### `platform/models/resource_fields.go`

- `func LegacyFieldMap(category ResourceCategory) map[string]string`
- `func GetResourceField(res any, field string) (string, bool)`
- `func getHostField(h *Host, field string) (string, bool)`
- `func getDatabaseField(d *Database, field string) (string, bool)`
- `func getMiddlewareField(m *Middleware, field string) (string, bool)`
- `func getApplicationField(a *Application, field string) (string, bool)`
- `func getGenericTargetField(g *GenericTarget, field string) (string, bool)`

### `platform/models/resource_label.go`

- `type LabelSource = string`
- `type ResourceLabel struct`

### `platform/models/scrape_job.go`

- `type JobType = string`
- `type AuthType = string`
- `type ChangeStatus = string`
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

### `platform/query/coverage.go`

- `type CoverageItem struct`
- `type CoverageSummary struct`
- `type coverageResource struct`
- `type upAggregation struct`
- `func CoverageHandler(db *gorm.DB, promURL *url.URL, client *http.Client) gin.HandlerFunc`
- `func loadResources(db *gorm.DB, netDomain, category string) ([]coverageResource, error)`
- `func queryCategoryResources(db *gorm.DB, cat models.ResourceCategory, netDomain string) ([]coverageResource, error)`
- `func loadSelectedInstances(db *gorm.DB) map[string]bool`
- `func fetchUpAgg(ctx context.Context, client *http.Client, promURL *url.URL) (*upAggregation, error)`
- `func fetchLastErrors(ctx context.Context, client *http.Client, promURL *url.URL) map[string]string`
- `func buildCoverageItems(resources []coverageResource, selected map[string]bool, upState *upAggregation, lastErrors map[strin…`
- `func summarize(items []CoverageItem) CoverageSummary`
- `func parseCoveragePage(c *gin.Context) (int, int)`
- `type promSeries struct`
- `func queryInstantVector(ctx context.Context, client *http.Client, promURL *url.URL, expr string) ([]promSeries, error)`
- `func parseIntQuery(raw string, def int) int`
- `func validCategories() []models.ResourceCategory`
- `func categoryList() []string`
- `func validCategory(c models.ResourceCategory) bool`
- `func instanceIPPort(ip string, port int) string`

### `platform/query/coverage_test.go`

- `func openCoverageTestDB(t *testing.T) *gorm.DB`
- `func seedCoverageHost(t *testing.T, db *gorm.DB, id, domain, name string)`
- `func seedCoverageJob(t *testing.T, db *gorm.DB, jobName string, selected []string)`
- `func coverageUpFixture() map[string]interface{}`
- `func coverageTargetsFixture() map[string]interface{}`
- `func newCoverageRouter(t *testing.T, db *gorm.DB, up, targets map[string]interface{}) (*gin.Engine, *httptest.Server)`
- `func doCoverage(t *testing.T, r *gin.Engine, query string) coverageResp`
- `type coverageResp struct`
- `type coverageItemJSON struct`
- `type coverageSummaryJSON struct`
- `func mustJSON(v interface{}) string`
- `func setupCoverageScenario(t *testing.T) (*gin.Engine, *httptest.Server)`
- `func TestCoverageTriState(t *testing.T)`
- `func TestCoverageFilterNetworkDomain(t *testing.T)`
- `func TestCoverageFilterResourceCategory(t *testing.T)`
- `func TestCoverageFilterState(t *testing.T)`
- `func TestCoveragePagination(t *testing.T)`
- `func TestCoveragePageSizeCap(t *testing.T)`
- `func TestCoverageEmptyResources(t *testing.T)`
- `func TestCoverageNoUpAggDependency(t *testing.T)`

### `platform/query/routes.go`

- `func RegisterRoutes(g *gin.RouterGroup, db *gorm.DB, promURL *url.URL)`

### `platform/query/targets.go`

- `type promTargetsData struct`
- `func TargetsHandler(promURL *url.URL, client *http.Client) gin.HandlerFunc`
- `func fetchTargets(ctx context.Context, client *http.Client, promURL *url.URL, state string) (*promTargetsData, error)`
- `func resolveJob(t map[string]interface{}) string`
- `func resolveLabel(t map[string]interface{}, key string) string`
- `func asString(v interface{}) string`

### `platform/query/targets_test.go`

- `func promTargetsFixture() map[string]interface{}`
- `func newTargetsRouter(t *testing.T) (*gin.Engine, fakeUpstream)`
- `func doTargets(t *testing.T, r *gin.Engine, query string) targetsResp`
- `type targetsResp struct`
- `func TestTargetsPassthroughAndEnrichment(t *testing.T)`
- `func TestTargetsNetworkDomainFallbackDefault(t *testing.T)`
- `func TestTargetsFilterJob(t *testing.T)`
- `func TestTargetsFilterNetworkDomain(t *testing.T)`
- `func TestTargetsFilterHealth(t *testing.T)`
- `func TestTargetsFilterCombination(t *testing.T)`
- `func TestTargetsInvalidHealthBadRequest(t *testing.T)`
- `func TestTargetsFilterNoMatchEmptyActive(t *testing.T)`
- `type fakeUpstream struct`
- `func newFakeUpstream(payload map[string]interface{}) fakeUpstream`

### `platform/strategy/ci-exporter/ci_exporter_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func newGin() *gin.Engine`
- `func mountRoutes(t *testing.T, db *gorm.DB) *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder`
- `func seedExporterWithID(t *testing.T, db *gorm.DB, name string) string`
- `func seedLabelTemplate(t *testing.T, db *gorm.DB, name, category string) uint`
- `func TestListCITypeExporterMappingsEmpty(t *testing.T)`
- `func TestListCITypeExporterMappingsFiltersAndFlags(t *testing.T)`
- `func TestCreateCITypeExporterMappingOK(t *testing.T)`
- `func TestCreateCITypeExporterMappingValidation(t *testing.T)`
- `func TestCreateDuplicateDefaultRejected(t *testing.T)`
- `func TestUpdateCITypeExporterMapping(t *testing.T)`
- `func TestDeleteCITypeExporterMapping(t *testing.T)`
- `func seedExporterWithTypes(t *testing.T, db *gorm.DB, name string, types ...string) string`
- `func TestMappingExporterSupportTypeGuard(t *testing.T)`

### `platform/strategy/ci-exporter/create.go`

- `type CreateCITypeExporterMappingRequest struct`
- `func CreateCITypeExporterMapping(db *gorm.DB) gin.HandlerFunc`
- `func validateMappingReq(req CreateCITypeExporterMappingRequest, db *gorm.DB) error`
- `func ensureSingleDefault(db *gorm.DB, monitorType string, wantDefault bool, excludeID uint) error`
- `func ensureExporterSupportsType(tmpl *models.ExporterTemplate, monitorType string) error`

### `platform/strategy/ci-exporter/delete.go`

- `func DeleteCITypeExporterMapping(db *gorm.DB) gin.HandlerFunc`

### `platform/strategy/ci-exporter/list.go`

- `type mappingListItem struct`
- `func ListCITypeExporterMappings(db *gorm.DB) gin.HandlerFunc`
- `func mappingReferenced(db *gorm.DB, m models.CITypeExporterMapping) bool`
- `func findExporterTemplate(db *gorm.DB, id string) (*models.ExporterTemplate, error)`

### `platform/strategy/ci-exporter/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`

### `platform/strategy/ci-exporter/update.go`

- `type UpdateCITypeExporterMappingRequest struct`
- `func UpdateCITypeExporterMapping(db *gorm.DB) gin.HandlerFunc`
- `func loadExporterByID(db *gorm.DB, id string) (*models.ExporterTemplate, error)`
- `func parseMappingID(c *gin.Context) (uint, bool)`

### `platform/strategy/common/paging.go`

- `type PageParams struct`
- `func ParsePageParams(values url.Values) PageParams`
- `func parseIntDefaultWithMax(raw string, def int) int`
- `func parseIntDefault(raw string, def, min int) int`

### `platform/strategy/exporter-template/create.go`

- `type CreateExporterTemplateRequest struct`
- `func CreateExporterTemplate(db *gorm.DB) gin.HandlerFunc`
- `func validateCreateExporterTemplate(req *CreateExporterTemplateRequest) error`

### `platform/strategy/exporter-template/delete.go`

- `func DeleteExporterTemplate(db *gorm.DB) gin.HandlerFunc`
- `func exporterTemplateReferenced(db *gorm.DB, id uint) (bool, error)`

### `platform/strategy/exporter-template/exporter_template_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func newGin() *gin.Engine`
- `func mountRoutes(t *testing.T, db *gorm.DB) *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder`
- `func seedExporter(t *testing.T, db *gorm.DB, e *models.ExporterTemplate) uint`
- `func seedMapping(t *testing.T, db *gorm.DB, m *models.CITypeExporterMapping)`
- `func TestListExporterTemplatesEmptyAndDefaults(t *testing.T)`
- `func TestListExporterTemplatesMonitoredTypeAndSourceFilter(t *testing.T)`
- `func TestCreateExporterTemplateInternal(t *testing.T)`
- `func TestCreateExporterTemplateNameMetricsPathSchemeRequired(t *testing.T)`
- `func TestCreateExporterTemplateRejectsBuiltinButAllowsOfficialThirdParty(t *testing.T)`
- `func TestCreateExporterTemplateDuplicateName(t *testing.T)`
- `func TestCreateExporterTemplateRecreateAfterSoftDelete(t *testing.T)`
- `func TestUpdateExporterTemplateInternal(t *testing.T)`
- `func TestUpdateExporterTemplateBuiltinForbiddenAndNotFound(t *testing.T)`
- `func TestCreateExporterTemplateDownloadURLValidation(t *testing.T)`
- `func TestCreateExporterTemplateWithDescription(t *testing.T)`
- `func TestUpdateExporterTemplateDownloadURLValidation(t *testing.T)`
- `func TestDeleteExporterTemplateInternalOK(t *testing.T)`
- `func TestDeleteExporterTemplateBuiltinAndReferencedForbidden(t *testing.T)`

### `platform/strategy/exporter-template/list.go`

- `func ListExporterTemplates(db *gorm.DB) gin.HandlerFunc`

### `platform/strategy/exporter-template/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`

### `platform/strategy/exporter-template/update.go`

- `type UpdateExporterTemplateRequest struct`
- `func UpdateExporterTemplate(db *gorm.DB) gin.HandlerFunc`
- `func parseTemplateID(c *gin.Context) (uint, bool)`

### `platform/strategy/exporter-template/validate.go`

- `func validateHTTPURL(field, raw string) error`

### `platform/strategy/metric-library/create.go`

- `type CreateMetricLibraryRequest struct`
- `func CreateMetricLibrary(db *gorm.DB) gin.HandlerFunc`
- `func validateCreate(req CreateMetricLibraryRequest, db *gorm.DB) error`
- `func UpdateMetricLibrary(db *gorm.DB) gin.HandlerFunc`

### `platform/strategy/metric-library/list.go`

- `func ListMetricLibrary(db *gorm.DB) gin.HandlerFunc`

### `platform/strategy/metric-library/metric_library_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func mountRoutes(t *testing.T, db *gorm.DB) *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder`
- `func seedBuiltinMetric(t *testing.T, db *gorm.DB, name, mtype, category, monitorType string, enabled bool)`
- `func TestListMetricLibraryFilters(t *testing.T)`
- `func TestCreateAndUpdateMetricLibrary(t *testing.T)`
- `func TestUpdateBuiltinForbidden(t *testing.T)`

### `platform/strategy/metric-library/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`

### `platform/strategy/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`

### `platform/strategy/rule/create.go`

- `type CreateMonitoringRuleRequest struct`
- `func CreateMonitoringRule(db *gorm.DB) gin.HandlerFunc`
- `func readRuleByID(c *gin.Context, db *gorm.DB, id uint) (*models.MonitoringRule, bool)`
- `func parseRuleID(c *gin.Context) (uint, bool)`

### `platform/strategy/rule/list.go`

- `func ListMonitoringRules(db *gorm.DB) gin.HandlerFunc`

### `platform/strategy/rule/monitoring_rule_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func mountRoutes(t *testing.T, db *gorm.DB) *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder`
- `func rulesFixture() string`
- `func rulesFixtureGroup(group string) string`
- `func TestValidateRuleYamlSyntax(t *testing.T)`
- `func TestCreateMonitoringRule(t *testing.T)`
- `func TestCreateMonitoringRuleDefaultEnabled(t *testing.T)`
- `func jsonString(s string) string`
- `func TestListUpdateDeleteMonitoringRule(t *testing.T)`
- `func TestValidateYAMLEndpoint(t *testing.T)`
- `func TestExtractGroupNames(t *testing.T)`
- `func TestCreateMonitoringRuleGroupNameConflict(t *testing.T)`
- `func TestCreateMonitoringRuleMonitorType(t *testing.T)`
- `func TestUpdateMonitoringRuleGroupNameConflict(t *testing.T)`

### `platform/strategy/rule/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`

### `platform/strategy/rule/update.go`

- `type UpdateMonitoringRuleRequest struct`
- `func UpdateMonitoringRule(db *gorm.DB) gin.HandlerFunc`
- `func DeleteMonitoringRule(db *gorm.DB) gin.HandlerFunc`
- `type ValidateRuleYAMLRequest struct`
- `func ValidateRuleYAML(db *gorm.DB) gin.HandlerFunc`

### `platform/strategy/rule/validate.go`

- `type ruleFile struct`
- `func validateRuleYAML(content string) error`
- `type groupNamesFile struct`
- `func extractGroupNames(content string) ([]string, error)`
- `func validateGroupNamesAvailable(db *gorm.DB, content string, excludeID uint) error`

### `platform/strategy/scrapejob/batch.go`

- `type BatchSubmitReadyRequest struct`
- `func BatchSubmitReady(db *gorm.DB, ids []uint) ([]models.ScrapeJob, error)`
- `func BatchUpdateDraftStatusHandler(db *gorm.DB) gin.HandlerFunc`
- `func BatchDeleteScrapeJobs(_ *gorm.DB, _ []uint) ([]uint, error)`

### `platform/strategy/scrapejob/batch_test.go`

- `func newBatchTestDB(t *testing.T) *gorm.DB`
- `func seedBatchDomain(t *testing.T, db *gorm.DB)`
- `func seedBatchJob(t *testing.T, db *gorm.DB, name, draftStatus string) *models.ScrapeJob`
- `func TestBatchSubmitReady(t *testing.T)`
- `func TestBatchSubmitReady_RejectReadyJob(t *testing.T)`
- `func TestBatchSubmitReady_ValidateBeforeReady(t *testing.T)`
- `func TestBatchSubmitReady_ResolvesEmptyScrapeParams(t *testing.T)`
- `func TestBatchSubmitReady_MissingID(t *testing.T)`

### `platform/strategy/scrapejob/create.go`

- `type CreateScrapeJobRequest struct`
- `func CreateScrapeJob(db *gorm.DB) gin.HandlerFunc`
- `func validateBasicJobRequest(job *models.ScrapeJob) error`

### `platform/strategy/scrapejob/delete.go`

- `func DeleteScrapeJob(db *gorm.DB) gin.HandlerFunc`

### `platform/strategy/scrapejob/installation.go`

- `type jobInstanceItem struct`
- `func ListJobInstances(db *gorm.DB) gin.HandlerFunc`
- `type confirmRequest struct`
- `func ConfirmInstallation(db *gorm.DB) gin.HandlerFunc`
- `func CancelInstallation(db *gorm.DB) gin.HandlerFunc`

### `platform/strategy/scrapejob/list.go`

- `func ListScrapeJobs(db *gorm.DB) gin.HandlerFunc`
- `func listJobsByLabelTemplate(c *gin.Context, db *gorm.DB, labelTemplateID string)`

### `platform/strategy/scrapejob/preview.go`

- `type previewTarget struct`
- `func PreviewTargets(db *gorm.DB) gin.HandlerFunc`
- `func resolveInstanceAddress(db *gorm.DB, resourceID string) string`

### `platform/strategy/scrapejob/routes.go`

- `func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB)`

### `platform/strategy/scrapejob/scrape_job_test.go`

- `func openTestDB(t *testing.T) *gorm.DB`
- `func newGin() *gin.Engine`
- `func mountRoutes(t *testing.T, db *gorm.DB) *gin.Engine`
- `func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder`
- `func seedEnabledDomain(t *testing.T, db *gorm.DB, id string)`
- `func seedFrozenDomain(t *testing.T, db *gorm.DB, id string)`
- `func seedExporter(t *testing.T, db *gorm.DB, name string) string`
- `func seedHost(t *testing.T, db *gorm.DB, resourceID, domainID, ip, status string)`
- `func seedDatabase(t *testing.T, db *gorm.DB, resourceID, domainID, ip, dbType, status string)`
- `func TestCreateScrapeJobStandardInheritsDefaults(t *testing.T)`
- `func TestCreateScrapeJobGlobalDefaultFallback(t *testing.T)`
- `func TestCreateScrapeJobTemplateFallback(t *testing.T)`
- `func TestUpdateScrapeJobClearFieldReInherits(t *testing.T)`
- `func TestCreateScrapeJobRejectsFrozenAndUnmonitoredDomain(t *testing.T)`
- `func TestCreateScrapeJobAuthValidation(t *testing.T)`
- `func TestCreateScrapeJobBlackbox(t *testing.T)`
- `func TestListScrapeJobsFiltersAndLabelTemplateReverseLookup(t *testing.T)`
- `func TestUpdateScrapeJobJobTypeSwitch(t *testing.T)`
- `func TestUpdateAndDeleteScrapeJob(t *testing.T)`
- `func TestCreateScrapeJobRecreateAfterSoftDelete(t *testing.T)`
- `func TestUpdateDeletePendingJobRejected(t *testing.T)`
- `func TestInstanceCandidatesHostOfflineGrey(t *testing.T)`
- `func TestInstanceCandidatesDatabaseSubtypeFilter(t *testing.T)`
- `func TestConfirmAndCancelInstallation(t *testing.T)`
- `func TestConfirmInstallationNotInSetRejected(t *testing.T)`
- `func TestListInstancesShowsUnconfirmedWithoutGate(t *testing.T)`
- `func TestPreviewTargetsStandardAndBlackbox(t *testing.T)`

### `platform/strategy/scrapejob/selection.go`

- `type InstanceCandidate struct`
- `func ListInstanceCandidates(db *gorm.DB) gin.HandlerFunc`
- `func queryInstanceCandidates(db *gorm.DB, deriv models.MonitorTypeDerivation, domainID, keyword string, p common.PageParams)…`
- `func queryHostCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams) (int64, []InstanceCandidate, erro…`
- `func queryDatabaseCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams) (int64, []InstanceCandidate, …`
- `func queryMiddlewareCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams) (int64, []InstanceCandidate…`
- `func queryApplicationCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams) (int64, []InstanceCandidat…`
- `func queryGenericTargetCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams) (int64, []InstanceCandid…`

### `platform/strategy/scrapejob/update.go`

- `type UpdateScrapeJobRequest struct`
- `func UpdateScrapeJob(db *gorm.DB) gin.HandlerFunc`
- `func applyJobUpdate(job *models.ScrapeJob, req UpdateScrapeJobRequest)`
- `func parseJobID(c *gin.Context) (uint, bool)`

### `platform/strategy/scrapejob/validate.go`

- `func validateJobRequest(db *gorm.DB, job *models.ScrapeJob) error`
- `func validateNetworkDomain(db *gorm.DB, domainID string) error`
- `func validateSelectedInstancesDomain(db *gorm.DB, job *models.ScrapeJob) error`
- `func resourceInDomain(db *gorm.DB, resourceID, domainID string) (bool, error)`
- `func resolveJobScrapeParams(db *gorm.DB, job *models.ScrapeJob)`
- `func exporterExists(db *gorm.DB, exporterTemplateID string) error`

## ui-custom/web/src/（React 前端）

### `ui-custom/web/src/App.tsx`

- `function RequireAuth`

### `ui-custom/web/src/api/admin.ts`

- `interface UsersListParams`
- `interface LoginLogsListParams`
- `const userApi`
- `const loginLogApi`
- `const tenantAdminApi`

### `ui-custom/web/src/api/alertmanager.ts`

- `function readValidateErrors`
- `interface AlertmanagerListParams`
- `interface SubmitAlertmanagerConfigInput`
- `interface RemountConfigInput`
- `const alertmanagerConfigApi`
- `const alertmanagerSilenceApi`

### `ui-custom/web/src/api/ciExporterMappings.ts`

- `interface CITypeExporterMappingListParams`
- `interface CITypeExporterMappingInput`
- `interface CITypeExporterMappingUpdateInput`
- `const ciExporterMappingApi`

### `ui-custom/web/src/api/client.ts`

- `function getToken`
- `function setToken`
- `function clearToken`
- `function setStoredUser`
- `function getStoredUser`
- `function setUnauthorizedNavigate`
- `class ApiError`
- `function isApiError`
- `function request`
- `const apiClient`

### `ui-custom/web/src/api/configCenter.ts`

- `interface ConfigListParams`
- `const networkDomainMonitorApi`
- `const configDraftApi`
- `const deploymentApi`

### `ui-custom/web/src/api/coverage.ts`

- `interface CoverageListParams`
- `const coverageApi`

### `ui-custom/web/src/api/dashboard.ts`

- `interface RecentDeployment`
- `interface DashboardSummary`
- `const dashboardApi`

### `ui-custom/web/src/api/domain.ts`

- `interface ListParams`
- `interface NetworkDomainCreateInput`
- `interface NetworkDomainUpdateInput`
- `const zoneTypeApi`
- `const networkDomainApi`
- `function resolveNetworkDomainImpact`
- `const tenantApi`

### `ui-custom/web/src/api/exporterTemplates.ts`

- `interface ExporterTemplateListParams`
- `interface ExporterTemplateInput`
- `interface ExporterTemplateUpdateInput`
- `const exporterTemplateApi`

### `ui-custom/web/src/api/health.ts`

- `interface HealthResponse`
- `interface StatusResponse`
- `function getHealth`
- `function getHealthDb`
- `function getStatus`

### `ui-custom/web/src/api/labelTemplates.ts`

- `interface LabelTemplateListParams`
- `interface TemplateInstanceListParams`
- `interface TemplateInstancePage`
- `interface MappingRemoveResult`
- `const labelTemplateApi`

### `ui-custom/web/src/api/metricLibrary.ts`

- `interface MetricLibraryListParams`
- `interface MetricLibraryInput`
- `interface MetricLibraryUpdateInput`
- `const metricLibraryApi`

### `ui-custom/web/src/api/monitoringRules.ts`

- `interface MonitoringRuleListParams`
- `interface MonitoringRuleInput`
- `interface YamlValidationResult`
- `const monitoringRuleApi`

### `ui-custom/web/src/api/resources.ts`

- `interface ResourceListParams`
- `interface ResourceLabelsResponse`
- `interface ResourceLabelCreateInput`
- `interface ResourceLabelUpdateInput`
- `interface BusinessDomainsResponse`
- `interface ImportListParams`
- `const resourceApi`
- `const businessDomainApi`
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

### `ui-custom/web/src/api/targets.ts`

- `interface TargetsListParams`
- `const targetsApi`

### `ui-custom/web/src/components/EllipsisText.tsx`

- `function EllipsisText`

### `ui-custom/web/src/components/FilterBar.tsx`

- `function FilterBar`
- `function FilterItem`

### `ui-custom/web/src/components/LoadingPlaceholder.tsx`

- `function LoadingPlaceholder`

### `ui-custom/web/src/components/MonitorStatusBadge.tsx`

- `function MonitorStatusBadge`

### `ui-custom/web/src/components/tablePresets.ts`

- `const TABLE_SCROLL_X`
- `const TABLE_PAGINATION`

### `ui-custom/web/src/layouts/MainLayout.tsx`

- `function MainLayout`

### `ui-custom/web/src/pages/admin/domains/DeleteDomainModal.tsx`

- `function DeleteDomainModal`

### `ui-custom/web/src/pages/admin/domains/DisableDomainModal.tsx`

- `function DisableDomainModal`

### `ui-custom/web/src/pages/admin/domains/DomainForm.tsx`

- `function DomainFormModal`

### `ui-custom/web/src/pages/admin/domains/DomainsPage.tsx`

- `function DomainsPage`

### `ui-custom/web/src/pages/admin/domains/domainRules.ts`

- `function isVacantDomain`

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

### `ui-custom/web/src/pages/alerts/AlertConfigDrawer.tsx`

- `function AlertConfigDrawer`

### `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`

- `function AlertConfigPage`

### `ui-custom/web/src/pages/alerts/AlertsPage.tsx`

- `function AlertsPage`

### `ui-custom/web/src/pages/alerts/CreateSilenceDrawer.tsx`

- `interface CreateSilenceDrawerProps`
- `function CreateSilenceDrawer`

### `ui-custom/web/src/pages/alerts/SilencesPage.tsx`

- `function SilencesPage`

### `ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`

- `const CURRENT_USER`
- `const CONFIG_PREVIEW_PATH`
- `const configStatusLabel`
- `const configStatusColor`
- `const silenceStatusLabel`
- `const silenceStatusColor`
- `function shortChecksum`
- `type ValidateSection`
- `const validateSectionLabel`
- `const validateSectionColor`
- `function partitionValidateErrors`
- `function formatMatchers`

### `ui-custom/web/src/pages/alerts/useAlertConfig.ts`

- `interface UseAlertConfigResult`
- `function useAlertConfig`

### `ui-custom/web/src/pages/alerts/useSilences.ts`

- `interface UseSilencesResult`
- `function useSilences`

### `ui-custom/web/src/pages/collection/CollectionPage.tsx`

- `function CollectionPage`

### `ui-custom/web/src/pages/config-center/configCenterConstants.ts`

- `const CURRENT_USER`
- `const TOKEN_MASK`
- `const channelLabel`
- `const channelTip`
- `const channelColor`
- `const agentTypeLabel`
- `const domainTypeLabel`
- `const domainTypeColor`
- `function deriveRegistrationStatus`
- `const registrationStatusLabel`
- `const registrationStatusColor`
- `const zoneTypeColor`
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
- `function deriveRemoteWriteUrl`
- `function highestRisk`
- `function formatRelativeTime`

### `ui-custom/web/src/pages/config-center/deployments/DeploymentsPage.tsx`

- `function DeploymentsPage`

### `ui-custom/web/src/pages/config-center/deployments/useDeployments.ts`

- `interface UseDeploymentsResult`
- `function useDeployments`
- `function fetchAllDomains`

### `ui-custom/web/src/pages/config-center/domains/NetworkDomainDetailDrawer.tsx`

- `function NetworkDomainDetailDrawer`

### `ui-custom/web/src/pages/config-center/domains/NetworkDomainsPage.tsx`

- `function NetworkDomainsPage`

### `ui-custom/web/src/pages/config-center/domains/OnboardDomainDrawer.tsx`

- `interface OnboardInput`
- `function OnboardDomainDrawer`

### `ui-custom/web/src/pages/config-center/domains/PlainTokenModal.tsx`

- `function PlainTokenModal`

### `ui-custom/web/src/pages/config-center/domains/useNetworkDomains.ts`

- `interface UseNetworkDomainsResult`
- `function useNetworkDomains`

### `ui-custom/web/src/pages/config-center/nodes/EdgeAgentsPage.tsx`

- `function EdgeAgentsPage`

### `ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx`

- `function ConfigPreviewPage`

### `ui-custom/web/src/pages/config-center/preview/configPreviewYaml.ts`

- `const PREVIEW_TABS`
- `function previewTabsFor`
- `function affectedFileSet`
- `function previewFileText`
- `interface ArtifactSource`
- `function fileTextByKey`
- `function targetsText`
- `function shortChecksum`
- `type DiffRowType`
- `interface DiffRow`
- `function computeDiff`

### `ui-custom/web/src/pages/config-center/preview/useConfigDrafts.ts`

- `type DraftStatusFilter`
- `const ALL_DOMAINS_ID`
- `const POLL_INTERVAL_MS`
- `interface UseConfigDraftsResult`
- `function useConfigDrafts`
- `function fetchMonitoredDomains`

### `ui-custom/web/src/pages/config/ConfigPage.tsx`

- `function ConfigPage`

### `ui-custom/web/src/pages/home/HomePage.tsx`

- `function HomePage`

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
- `const INSTANCE_LEVEL_CUSTOM_CATEGORIES`
- `const INSTANCE_STATUS_MAP`
- `const INSTANCE_STATUS_OPTIONS`
- `const SOURCE_TYPE_LABEL`
- `const SOURCE_TYPE_COLOR`
- `const MAPPING_SOURCE_TYPE_OPTIONS`
- `const TRANSFORM_OPTIONS`
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

### `ui-custom/web/src/pages/resources/ImportModal.tsx`

- `function ImportModal`

### `ui-custom/web/src/pages/resources/ImportRecordsPanel.tsx`

- `function ImportRecordsPanel`

### `ui-custom/web/src/pages/resources/ResourceDetailDrawer.tsx`

- `function ResourceDetailDrawer`

### `ui-custom/web/src/pages/resources/ResourceFormDrawer.tsx`

- `function ResourceFormDrawer`

### `ui-custom/web/src/pages/resources/ResourcePage.tsx`

- `function ResourcePage`

### `ui-custom/web/src/pages/resources/ResourcesPage.tsx`

- `function ResourcesPage`

### `ui-custom/web/src/pages/resources/useResourceCoverage.ts`

- `interface UseResourceCoverageResult`
- `function useResourceCoverage`

### `ui-custom/web/src/pages/resources/useResources.ts`

- `interface ResourceListItem`
- `interface ResourceFilters`
- `interface UseResourcesResult`
- `function useResources`

### `ui-custom/web/src/pages/strategy/CollectorListPage.tsx`

- `function CollectorListPage`

### `ui-custom/web/src/pages/strategy/CollectorTemplatesTab.tsx`

- `function CollectorTemplatesTab`

### `ui-custom/web/src/pages/strategy/ExporterInstallationPanel.tsx`

- `const DOWN_TOOLTIP`
- `function ExporterInstallationPanel`

### `ui-custom/web/src/pages/strategy/ExporterTemplateDrawer.tsx`

- `function ExporterTemplateDrawer`

### `ui-custom/web/src/pages/strategy/InstanceSelector.tsx`

- `function InstanceSelector`

### `ui-custom/web/src/pages/strategy/LabelTemplatePreview.tsx`

- `function LabelTemplatePreview`

### `ui-custom/web/src/pages/strategy/LabelTemplateSelectDrawer.tsx`

- `function LabelTemplateSelectDrawer`

### `ui-custom/web/src/pages/strategy/MappingDrawer.tsx`

- `function MappingDrawer`

### `ui-custom/web/src/pages/strategy/MetricLibraryPage.tsx`

- `function MetricLibraryPage`

### `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx`

- `function RuleMountDrawer`

### `ui-custom/web/src/pages/strategy/RulesPage.tsx`

- `function RulesPage`

### `ui-custom/web/src/pages/strategy/ScrapeJobFormDrawer.tsx`

- `function ScrapeJobFormDrawer`

### `ui-custom/web/src/pages/strategy/ScrapeJobListPage.tsx`

- `function ScrapeJobListPage`

### `ui-custom/web/src/pages/strategy/jobStatus.ts`

- `interface JobStatusView`
- `function aggregateJobStatus`

### `ui-custom/web/src/pages/strategy/rulesYaml.ts`

- `function validateYamlClient`

### `ui-custom/web/src/pages/strategy/strategyConstants.ts`

- `const MONITOR_TYPE_MAP`
- `const CATEGORY_MAP`
- `const MONITOR_TYPE_CASCADE`
- `const SCRAPE_PARAM_FIELDS`
- `const JOB_TYPE_MAP`
- `const CHANGE_STATUS_MAP`
- `const DRAFT_STATUS_MAP`
- `const CONTENT_MODE_MAP`
- `const SCOPE_MAP`
- `const METRIC_TYPE_MAP`
- `const AUTH_TYPE_MAP`

### `ui-custom/web/src/pages/strategy/useScrapeJobStatus.ts`

- `type JobInstanceScrapeStatus`
- `interface JobScrapeStatusSummary`
- `function useScrapeJobStatus`

### `ui-custom/web/src/pages/strategy/useScrapeJobs.ts`

- `interface ScrapeJobFilters`
- `interface UseScrapeJobsResult`
- `function useScrapeJobs`

### `ui-custom/web/src/test/antdTestUtils.tsx`

- `function setupAntdTest`
- `interface MockedModal`
- `function mockAntdModal`
- `function selectAntdOption`

### `ui-custom/web/src/theme.ts`

- `const volcengineTokens`
- `const volcengineTheme`

### `ui-custom/web/src/types/admin.ts`

- `type UserStatus`
- `interface UserItem`
- `interface LoginLogItem`
- `interface UserCreateInput`
- `interface UserUpdateInput`
- `interface ResetPasswordInput`
- `interface TenantEditInput`
- `interface ItemsResult`

### `ui-custom/web/src/types/alertmanager.ts`

- `interface PaginatedItems`
- `type AlertmanagerConfigStatus`
- `type SilenceStatus`
- `interface AlertmanagerConfigVersion`
- `interface AlertmanagerConfigVersionListItem`
- `interface ValidateErrorItem`
- `interface ValidateErrorData`
- `interface SilenceMatcher`
- `interface Silence`
- `interface CreateSilencePayload`

### `ui-custom/web/src/types/api.ts`

- `type ApiStatus`
- `interface ApiResponse`
- `interface ApiErrorResponse`
- `type ApiError`
- `interface Paginated`

### `ui-custom/web/src/types/auth.ts`

- `interface AuthUser`
- `interface LoginResult`

### `ui-custom/web/src/types/config-center.ts`

- `interface PaginatedItems`
- `type Channel`
- `type AgentType`
- `type DomainType`
- `type MonitoredStatus`
- `type DomainEnabledStatus`
- `interface NetworkDomain`
- `type RegistrationStatus`
- `interface MonitorDomainInput`
- `interface ResetTokenResult`
- `type DraftStatus`
- `type DraftValidationStatus`
- `type DraftValidationCause`
- `interface ValidationDetail`
- `type Risk`
- `type ChangeTarget`
- `type ChangeType`
- `type AffectedFile`
- `interface ConfigChangeItem`
- `interface ConfigDraftMetadata`
- `interface ConfigDraft`
- `interface ConfigVersion`
- `type DeploymentStatus`
- `interface DiscardImpact`
- `interface ConfigDeployment`

### `ui-custom/web/src/types/config.ts`

- `type DraftStatus`
- `type DeploymentStatus`
- `interface ConfigDraft`
- `interface ConfigVersion`
- `interface ConfigDeployment`

### `ui-custom/web/src/types/domain.ts`

- `type DomainType`
- `type DomainStatus`
- `type ChannelType`
- `type AgentType`
- `interface ZoneType`
- `interface NetworkDomain`
- `interface NetworkDomainImpact`
- `interface NetworkDomainStatusResult`
- `type TenantStatus`
- `interface Tenant`

### `ui-custom/web/src/types/label.ts`

- `type LabelSourceType`
- `interface Mapping`
- `interface LabelTemplate`
- `type LabelSource`
- `interface ResourceLabel`
- `interface MappingInput`
- `interface LabelTemplateCreateInput`
- `interface LabelTemplateUpdateInput`
- `interface TemplateInstanceItem`
- `interface LabelTemplateListItem`

### `ui-custom/web/src/types/query.ts`

- `type TargetHealth`
- `interface TargetItem`
- `interface TargetsResponse`
- `type CoverageState`
- `interface CoverageItem`
- `interface CoverageSummary`
- `interface CoverageListResponse`

### `ui-custom/web/src/types/resource.ts`

- `type ResourceCategory`
- `type ResourceType`
- `interface ResourceBaseShape`
- `interface Host`
- `interface Database`
- `interface Middleware`
- `interface Application`
- `interface GenericTarget`
- `type Resource`
- `type ResourceStatus`
- `interface ResourceCreateBaseShape`
- `interface HostResourceFields`
- `interface DatabaseResourceFields`
- `interface MiddlewareResourceFields`
- `interface ApplicationResourceFields`
- `interface GenericTargetResourceFields`
- `type ResourceCreateInput`
- `interface ResourceUpdateBaseShape`
- `type ResourceUpdateInput`
- `interface BusinessDomain`
- `interface OSOption`
- `type ResourceLabelSource`
- `interface ResourceLabelItem`
- `interface ImportError`
- `interface ImportResult`
- `type ImportMode`
- `interface ImportRecord`

### `ui-custom/web/src/types/strategy.ts`

- `type JobType`
- `type AuthType`
- `type ChangeStatus`
- `type InstanceSelectionMode`
- `interface ScrapeJob`
- `interface CITypeExporterMapping`
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

