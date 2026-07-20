# TDD 测试规范

## TDD 循环

```
RED -> GREEN -> IMPROVE -> VERIFY
```

## Go 后端测试

### 单元测试

```go
func TestLoadConfig(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    *Config
        wantErr bool
    }{
        {
            name:  "valid config",
            input: "testdata/valid.yml",
            want:  &Config{...},
        },
        {
            name:    "missing file",
            input:   "testdata/missing.yml",
            wantErr: true,
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := LoadConfig(tt.input)
            if tt.wantErr {
                assert.Error(t, err)
                return
            }
            assert.NoError(t, err)
            assert.Equal(t, tt.want, got)
        })
    }
}
```

### 集成测试

- 使用 `testcontainers-go` 启动依赖服务
- 或使用 SQLite 内存数据库

## 前端测试

- 单元测试：Vitest + React Testing Library
- E2E 测试：Playwright

## 覆盖率要求

| 模块 | 目标覆盖率 |
|------|-----------|
| platform/gateway | ≥ 70% |
| platform/discovery | ≥ 70% |
| platform/config | ≥ 70% |
| ui-custom/web | ≥ 50% |

## 测试命令

后端：
```bash
go test ./platform/...
```

前端：
```bash
cd ui-custom/web && pnpm test
```
