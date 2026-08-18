#!/usr/bin/env python3
# 原型规范检查：① 用户可见文案泄漏决策/PRD/版本标记（多行 JSX 属性感知）
#              ② 结构反模式（Alert 泛滥 / 表格列过多且无横向滚动 / 筛选组过多 / 灰色长文本）
# 用法: check-prototype.py [module-XX] [--markers-only|--structure-only] [--strict]
# 退出码: 有泄漏 → 1；仅结构警告 → 0（--strict 时警告也 → 1）
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTOTYPES_DIR = os.path.join(ROOT, 'docs', 'prototypes')

USER_VISIBLE_PROPS = ('message', 'description', 'title', 'extra', 'label', 'placeholder')
MARKER_RE = re.compile(r'决策\s*\d|PRD\s+\d|PRD\s+X|PRD\s*\d\.\d|\{v\d+\.[^}]*\}')

MAX_ALERTS_PER_PAGE = 2
MAX_TABLE_COLUMNS = 8
MAX_FILTER_GROUPS = 4
MAX_SECONDARY_TEXT_LEN = 100


def iter_modules(module_filter):
    for name in sorted(os.listdir(PROTOTYPES_DIR)):
        path = os.path.join(PROTOTYPES_DIR, name)
        if not os.path.isdir(path) or not name.startswith('module-'):
            continue
        if module_filter and name != module_filter:
            continue
        src = os.path.join(path, 'src')
        if os.path.isdir(src):
            yield name, src


def iter_source_files(src_dir):
    for dirpath, _, filenames in os.walk(src_dir):
        for fn in sorted(filenames):
            if fn.endswith(('.tsx', '.ts', '.jsx', '.js')):
                yield os.path.join(dirpath, fn)


def line_of(text, idx):
    return text.count('\n', 0, idx) + 1


def scan_string(text, start, quote):
    """从 start（引号位置）扫描字符串字面量，返回 (内容, 结束位置)。"""
    i = start + 1
    n = len(text)
    while i < n:
        if text[i] == '\\':
            i += 2
            continue
        if text[i] == quote:
            return text[start + 1:i], i + 1
        i += 1
    return text[start + 1:], n


def scan_template(text, start):
    """从 start（反引号位置）扫描模板字符串，支持 ${...} 嵌套，返回结束位置。"""
    i = start + 1
    n = len(text)
    while i < n:
        c = text[i]
        if c == '\\':
            i += 2
            continue
        if c == '`':
            return i + 1
        if c == '$' and i + 1 < n and text[i + 1] == '{':
            _, i = scan_braces(text, i + 1)
            continue
        i += 1
    return n


def scan_braces(text, start):
    """从 start（'{' 位置）做括号配平扫描，跳过字符串/模板/行注释，返回 (内容, 结束位置)。"""
    depth = 0
    i = start
    n = len(text)
    while i < n:
        c = text[i]
        if c in '"\'':
            _, i = scan_string(text, i, c)
            continue
        if c == '`':
            i = scan_template(text, i)
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            j = text.find('\n', i)
            i = n if j == -1 else j + 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            j = text.find('*/', i + 2)
            i = n if j == -1 else j + 2
            continue
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return text[start:i + 1], i + 1
        i += 1
    return text[start:], n


PROP_START_RE = re.compile(r'\b(' + '|'.join(USER_VISIBLE_PROPS) + r')\s*=\s*')

JSX_COMMENT_RE = re.compile(r'\{/\*.*?\*/\}', re.DOTALL)


def strip_jsx_comments(content):
    """表达式容器内的 {/* */} 是代码注释，不是用户可见文案，匹配标记前先剥离。"""
    return JSX_COMMENT_RE.sub('', content)


def find_prop_contents(text):
    """产出 (prop 名, 起始 index, 属性内容文本)。"""
    for m in PROP_START_RE.finditer(text):
        prop = m.group(1)
        i = m.end()
        if i >= len(text):
            continue
        c = text[i]
        if c in '"\'':
            content, _ = scan_string(text, i, c)
            yield prop, m.start(), content
        elif c == '{':
            content, _ = scan_braces(text, i)
            yield prop, m.start(), content


def check_markers(module_name, src_dir):
    errors = []
    for path in iter_source_files(src_dir):
        with open(path, encoding='utf-8') as f:
            text = f.read()
        for prop, idx, content in find_prop_contents(text):
            hit = MARKER_RE.search(strip_jsx_comments(content))
            if hit:
                errors.append((path, line_of(text, idx), prop, hit.group(0)))
    return errors


def find_review_note_spans(text):
    """返回 [(start, end), ...] 的 ReviewNote 组件区间（开区间），用于跳过内部 type="secondary" 灰字统计。"""
    spans = []
    i = 0
    n = len(text)
    while i < n:
        m = re.search(r'<ReviewNote\b', text[i:])
        if not m:
            break
        start = i + m.start()
        # 从组件名后找配对的闭合标签，scan_braces 只扫描 {}，这里用简单栈找 </ReviewNote>
        end = text.find('</ReviewNote>', start)
        if end == -1:
            break
        end += len('</ReviewNote>')
        spans.append((start, end))
        i = end
    return spans


def remove_jsx_expressions(inner):
    """移除 JSX 表达式 { ... } 后再统计字符长度（表达式不是用户可见文案）。支持嵌套花括号。"""
    while True:
        start = inner.find('{')
        if start == -1:
            break
        _, end = scan_braces(inner, start)
        if end <= start:
            break
        inner = inner[:start] + inner[end:]
    return inner


def check_structure(module_name, src_dir):
    warnings = []
    pages_dir = os.path.join(src_dir, 'pages')
    if not os.path.isdir(pages_dir):
        return warnings
    for path in iter_source_files(pages_dir):
        if not path.endswith(('.tsx', '.jsx')):
            continue
        with open(path, encoding='utf-8') as f:
            text = f.read()

        # 1. Alert 数量
        alert_count = len(re.findall(r'<Alert\b', text))
        if alert_count > MAX_ALERTS_PER_PAGE:
            warnings.append((path, None, f'Alert 组件 {alert_count} 个（>{MAX_ALERTS_PER_PAGE}）——用户主区最多保留 1 个用户级 Alert，其余进 ReviewNote / Empty / Tooltip'))

        # 2. 表格列数与横向滚动
        for m in re.finditer(r'columns\s*=\s*{', text):
            block, _ = scan_braces(text, m.end() - 1)
            col_count = len(re.findall(r'\btitle\s*:', block))
            if col_count > MAX_TABLE_COLUMNS:
                has_scroll = re.search(r'scroll\s*=\s*\{\{[^}]*\bx\s*:', text)
                msg = f'表格列数约 {col_count} 列（>{MAX_TABLE_COLUMNS}）——按前端标准第 9 章做列数治理（≤8 列，其余下沉详情 Drawer）'
                if not has_scroll:
                    msg += '，且缺少 scroll={{ x: ... }} 横向滚动'
                warnings.append((path, line_of(text, m.start()), msg))

        # 3. 筛选组数量（仅对未使用 FilterBar 栅格的页面报警）
        filter_groups = text.count('placeholder="全部')
        if filter_groups > MAX_FILTER_GROUPS and '<FilterBar' not in text:
            warnings.append((path, None, f'筛选条件下拉约 {filter_groups} 组（>{MAX_FILTER_GROUPS}）——筛选区应使用栅格两行布局或折叠，禁止 <Space wrap> 简单堆叠'))

        # 4. 超长灰色说明文本（疑似评审说明混入用户区；ReviewNote 内部及 JSX 表达式不计入）
        review_spans = find_review_note_spans(text)
        for m in re.finditer(r'<Text\s+type="secondary"[^>]*>(.*?)</Text>', text, re.DOTALL):
            # 跳过 ReviewNote 内部
            if any(start <= m.start() < end for start, end in review_spans):
                continue
            inner = re.sub(r'<[^>]+>', '', m.group(1))
            inner = remove_jsx_expressions(inner)
            inner = re.sub(r'\s+', ' ', inner).strip()
            if len(inner) > MAX_SECONDARY_TEXT_LEN:
                warnings.append((path, line_of(text, m.start()), f'灰色说明文本 {len(inner)} 字（>{MAX_SECONDARY_TEXT_LEN}）——长说明应移入 ReviewNote 或精简'))
    return warnings


def main():
    args = sys.argv[1:]
    module_filter = None
    markers_only = '--markers-only' in args
    structure_only = '--structure-only' in args
    strict = '--strict' in args
    for a in args:
        if a.startswith('module-'):
            module_filter = a

    total_errors = 0
    total_warnings = 0

    for name, src_dir in iter_modules(module_filter):
        print(f'== {name} ==')
        module_issues = 0
        if not structure_only:
            errors = check_markers(name, src_dir)
            total_errors += len(errors)
            module_issues += len(errors)
            if errors:
                print('  [泄漏] 用户可见文案含决策编号 / PRD 引用 / 版本标记：')
                for path, line, prop, marker in errors:
                    print(f'    {path}:{line}  [{prop}=] 命中 "{marker}"')
        if not markers_only:
            warnings = check_structure(name, src_dir)
            total_warnings += len(warnings)
            module_issues += len(warnings)
            if warnings:
                print('  [结构] 命中结构反模式：')
                for path, line, msg in warnings:
                    loc = f'{path}:{line}' if line else path
                    print(f'    {loc}  {msg}')
        if module_issues == 0:
            print('  OK')
        print('')

    if total_errors:
        print(f'发现 {total_errors} 处文案泄漏：评审说明请使用 <ReviewNote> 组件承载（见 prototype-designer.md 提示分区规范）。')
    if total_warnings:
        print(f'发现 {total_warnings} 处结构反模式：请对照 02_Frontend_Standard.md 第 8-10 章整改。')

    if total_errors:
        sys.exit(1)
    if strict and total_warnings:
        sys.exit(1)
    sys.exit(0)


if __name__ == '__main__':
    main()
