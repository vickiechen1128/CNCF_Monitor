# Golang 编码规范

## 通用规范

- 使用 Go 1.25+
- 遵循 Effective Go 和 Google Go Style Guide
- 所有导出的标识符必须有注释
- 错误处理显式，不吞异常
- 优先使用组合而非继承

## 代码组织

```go
package xxx

import (
    // 标准库
    "context"
    "fmt"
    
    // 第三方库
    "github.com/gin-gonic/gin"
    
    // 本项目
    "github.com/your-org/metriccenter/platform/models"
)
```

## 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 包名 | 小写，简短 | `config`、`gateway` |
| 结构体 | PascalCase | `AssetResource` |
| 接口 | PascalCase，动词优先 | `Provider`、`Store` |
| 函数 | CamelCase | `loadConfig` |
| 常量 | CamelCase 或 UPPER_SNAKE | `defaultTimeout` |
| 错误变量 | Err 前缀 | `ErrNotFound` |

## 错误处理

```go
if err != nil {
    return fmt.Errorf("failed to load config: %w", err)
}
```

## 测试

- 测试文件：`xxx_test.go`
- 使用 `testing` + `testify/assert`
- 表驱动测试优先

## 禁止

- 不要使用 `panic` 处理业务错误
- 不要忽略错误返回值
- 不要直接修改 `upstream/prometheus/` 源码
