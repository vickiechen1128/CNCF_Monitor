// Command repo-map 生成 MetricCenter 业务代码的符号地图（repo map）。
//
// 扫描 platform/（Go，go/ast 精确解析）与 ui-custom/web/src/（TS/TSX，
// 正则提取 export 符号），输出 Markdown 到
// docs/04-source-architecture/repo-map.md，供 Agent 排障时按
// 「符号 → 文件」快速定位，避免大面积全文搜索。
// 上游子模块 upstream/ 刻意不纳入索引（只读、体量巨大）。
//
// 用法：
//
//	go run ./scripts/repo-map [-o 输出路径] [扫描根目录...]
//
// 默认扫描根：platform ui-custom/web/src
package main

import (
	"bytes"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	maxSigLen = 120 // 签名截断长度，控制单行体积
)

// symbol 表示一个顶层符号条目。
type symbol struct {
	Kind string // type / func / method / interface / class / const 等
	Sig  string // 签名或声明摘要
}

// fileEntry 表示一个源文件及其符号列表。
type fileEntry struct {
	Path    string
	Symbols []symbol
}

// exportRe 匹配 TS/TSX 顶层导出符号。
var exportRe = regexp.MustCompile(
	`^export\s+(?:default\s+)?(?:async\s+)?` +
		`(function\*?|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)`)

func main() {
	out := flag.String("o", "docs/04-source-architecture/repo-map.md", "输出 Markdown 路径")
	flag.Parse()
	roots := flag.Args()
	if len(roots) == 0 {
		roots = []string{"platform", "ui-custom/web/src"}
	}

	var goFiles, tsFiles []fileEntry
	for _, root := range roots {
		err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() {
				switch d.Name() {
				case "node_modules", "dist", "vendor", "__pycache__":
					return filepath.SkipDir
				}
				return nil
			}
			switch {
			case strings.HasSuffix(path, ".go"):
				if e := extractGo(path); len(e.Symbols) > 0 {
					goFiles = append(goFiles, e)
				}
			case strings.HasSuffix(path, ".ts"), strings.HasSuffix(path, ".tsx"):
				if e := extractTS(path); len(e.Symbols) > 0 {
					tsFiles = append(tsFiles, e)
				}
			}
			return nil
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "repo-map: 扫描 %s 失败: %v\n", root, err)
			os.Exit(1)
		}
	}

	sort.Slice(goFiles, func(i, j int) bool { return goFiles[i].Path < goFiles[j].Path })
	sort.Slice(tsFiles, func(i, j int) bool { return tsFiles[i].Path < tsFiles[j].Path })

	doc := render(goFiles, tsFiles)
	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "repo-map: 创建输出目录失败: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*out, []byte(doc), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "repo-map: 写入 %s 失败: %v\n", *out, err)
		os.Exit(1)
	}
	fmt.Printf("repo-map: %s（Go 文件 %d，TS/TSX 文件 %d）\n", *out, len(goFiles), len(tsFiles))
}

// extractGo 用 go/parser 提取 Go 文件的顶层类型、函数与方法。
func extractGo(path string) fileEntry {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
	if err != nil {
		fmt.Fprintf(os.Stderr, "repo-map: 解析 %s 失败（已跳过）: %v\n", path, err)
		return fileEntry{Path: path}
	}
	e := fileEntry{Path: path}
	for _, decl := range f.Decls {
		switch d := decl.(type) {
		case *ast.GenDecl:
			if d.Tok != token.TYPE {
				continue // 跳过 const/var/import，控制地图体积
			}
			for _, spec := range d.Specs {
				ts, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				e.Symbols = append(e.Symbols, symbol{
					Kind: "type",
					Sig:  truncate(fmt.Sprintf("%s %s", ts.Name.Name, typeKind(ts.Type))),
				})
			}
		case *ast.FuncDecl:
			kind := "func"
			recv := ""
			if d.Recv != nil && len(d.Recv.List) > 0 {
				kind = "method"
				recv = "(" + renderNode(fset, d.Recv.List[0].Type) + ") "
			}
			// printer 渲染的 FuncType 自带 "func" 前缀，去掉避免与 Kind 重复
			sig := strings.TrimPrefix(renderNode(fset, d.Type), "func")
			e.Symbols = append(e.Symbols, symbol{
				Kind: kind,
				Sig:  truncate(recv + d.Name.Name + sig),
			})
		}
	}
	return e
}

// extractTS 用正则提取 TS/TSX 文件的顶层 export 符号。
func extractTS(path string) fileEntry {
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "repo-map: 读取 %s 失败（已跳过）: %v\n", path, err)
		return fileEntry{Path: path}
	}
	e := fileEntry{Path: path}
	for _, line := range strings.Split(string(data), "\n") {
		m := exportRe.FindStringSubmatch(strings.TrimRight(line, "\r"))
		if m == nil {
			continue
		}
		e.Symbols = append(e.Symbols, symbol{Kind: m[1], Sig: m[2]})
	}
	return e
}

// renderNode 将 AST 节点渲染为紧凑源码串。
func renderNode(fset *token.FileSet, n ast.Node) string {
	var buf bytes.Buffer
	if err := printer.Fprint(&buf, fset, n); err != nil {
		return "?"
	}
	return buf.String()
}

// typeKind 返回类型声明的底层种类（struct / interface / alias 等）。
func typeKind(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.StructType:
		return "struct"
	case *ast.InterfaceType:
		return "interface"
	case *ast.Ident:
		return "= " + t.Name
	default:
		return ""
	}
}

// truncate 将签名压缩为单行并截断到 maxSigLen。
func truncate(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > maxSigLen {
		s = s[:maxSigLen-1] + "…"
	}
	return s
}

// gitHead 返回当前短 commit；失败时返回 unknown。
func gitHead() string {
	out, err := exec.Command("git", "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}

// render 渲染最终 Markdown 文档。
func render(goFiles, tsFiles []fileEntry) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# MetricCenter Repo Map（业务代码符号地图）\n\n")
	fmt.Fprintf(&b, "> 由 `make repo-map`（`scripts/repo-map`）自动生成，**请勿手改**。\n")
	fmt.Fprintf(&b, "> 生成时间: %s · commit: `%s`\n", time.Now().Format("2006-01-02 15:04"), gitHead())
	fmt.Fprintf(&b, "> 覆盖范围: `platform/`（Go）与 `ui-custom/web/src/`（TS/TSX）；")
	fmt.Fprintf(&b, "`upstream/` 上游子模块刻意不索引（只读且体量巨大），其架构结论见本目录其他文档。\n")
	fmt.Fprintf(&b, "> 用法: 先用本文件按「符号名 → 文件路径」定位，再 `Read` 目标文件；查不到再降级为 Grep 全文搜索。\n\n")

	writeSection := func(title string, files []fileEntry) {
		fmt.Fprintf(&b, "## %s\n\n", title)
		for _, f := range files {
			fmt.Fprintf(&b, "### `%s`\n\n", f.Path)
			for _, s := range f.Symbols {
				fmt.Fprintf(&b, "- `%s %s`\n", s.Kind, s.Sig)
			}
			b.WriteString("\n")
		}
	}
	writeSection("platform/（Go 后端）", goFiles)
	writeSection("ui-custom/web/src/（React 前端）", tsFiles)
	return b.String()
}
