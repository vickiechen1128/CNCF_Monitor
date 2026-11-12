package service

import (
	"fmt"
	"strings"
)

// DomainLabel is the data-plane label carrying the network domain. The center
// generator injects `network_domain_id` into external_labels (decision 19), so
// this is the authoritative label to constrain (D33).
const DomainLabel = "network_domain_id"

var promqlKeywords = map[string]bool{
	// vector matching / aggregation modifiers
	"by": true, "without": true, "on": true, "ignoring": true,
	"group_left": true, "group_right": true,
	// value modifiers
	"bool": true, "offset": true,
	// binary operators
	"and": true, "or": true, "unless": true,
	// aggregation operators (usable with by/without)
	"sum": true, "avg": true, "min": true, "max": true, "count": true,
	"stddev": true, "stdvar": true, "topk": true, "bottomk": true,
	"quantile": true, "count_values": true, "group": true,
	// literals
	"inf": true, "nan": true,
}

// DomainMatcher renders the label matcher clause, e.g.
// `network_domain_id=~"mc-a|mc-b"`. An empty or nil set renders an impossible
// matcher so no series match (authorized-to-nothing).
func DomainMatcher(domains []string) string {
	if len(domains) == 0 {
		return DomainLabel + `=~""`
	}
	escaped := make([]string, 0, len(domains))
	for _, domain := range domains {
		domain = strings.TrimSpace(domain)
		if domain == "" {
			continue
		}
		domain = strings.ReplaceAll(domain, `\`, `\\`)
		domain = strings.ReplaceAll(domain, `"`, `\"`)
		escaped = append(escaped, domain)
	}
	if len(escaped) == 0 {
		return DomainLabel + `=~""`
	}
	return fmt.Sprintf(`%s=~"%s"`, DomainLabel, strings.Join(escaped, "|"))
}

// InjectDomain injects the matcher into every metric selector of a PromQL
// expression. It is deliberately conservative: function names, aggregation
// operators, label lists (by/without/on/ignoring/group_*), string literals,
// ranges ([5m]) and duration/number tokens are left untouched. Expressions
// without selectors (e.g. `1+2`) are returned unchanged (they cannot leak
// series).
func InjectDomain(expr, matcher string) string {
	if strings.TrimSpace(expr) == "" || matcher == "" {
		return expr
	}
	var out strings.Builder
	out.Grow(len(expr) + 64)

	i := 0
	braceDepth := 0
	bracketDepth := 0
	parenDepth := 0
	labelListDepth := -1
	pendingLabelList := false

	for i < len(expr) {
		ch := expr[i]

		// String literals (double, single, backtick) are copied verbatim.
		if ch == '"' || ch == '\'' || ch == '`' {
			j := i + 1
			for j < len(expr) {
				if expr[j] == '\\' && ch != '`' {
					j += 2
					continue
				}
				if expr[j] == ch {
					j++
					break
				}
				j++
			}
			out.WriteString(expr[i:j])
			i = j
			continue
		}

		// A top-level brace starts a selector with no metric name, e.g.
		// `{__name__="up"}`; inject the matcher inside it.
		if ch == '{' && braceDepth == 0 {
			end := strings.IndexByte(expr[i:], '}')
			if end < 0 {
				out.WriteString(expr[i:])
				return out.String()
			}
			body := strings.TrimSpace(expr[i+1 : i+end])
			out.WriteByte('{')
			if body != "" {
				out.WriteString(body)
				out.WriteByte(',')
			}
			out.WriteString(matcher)
			out.WriteByte('}')
			i = i + end + 1
			continue
		}

		switch ch {
		case '{':
			braceDepth++
		case '}':
			if braceDepth > 0 {
				braceDepth--
			}
		case '[':
			bracketDepth++
		case ']':
			if bracketDepth > 0 {
				bracketDepth--
			}
		case '(':
			parenDepth++
			if pendingLabelList {
				labelListDepth = parenDepth
				pendingLabelList = false
			}
		case ')':
			if labelListDepth >= 0 && parenDepth <= labelListDepth {
				labelListDepth = -1
			}
			if parenDepth > 0 {
				parenDepth--
			}
		}

		if braceDepth == 0 && bracketDepth == 0 && isIdentStart(ch) {
			// Skip the trailing unit of a duration such as `5m`.
			if i > 0 && expr[i-1] >= '0' && expr[i-1] <= '9' {
				j := i
				for j < len(expr) && isIdentPart(expr[j]) {
					j++
				}
				out.WriteString(expr[i:j])
				i = j
				continue
			}
			j := i
			for j < len(expr) && isIdentPart(expr[j]) {
				j++
			}
			token := expr[i:j]
			lower := strings.ToLower(token)

			if promqlKeywords[lower] {
				out.WriteString(token)
				switch lower {
				case "by", "without", "on", "ignoring", "group_left", "group_right":
					pendingLabelList = true
				}
				i = j
				continue
			}
			if labelListDepth >= 0 && parenDepth >= labelListDepth {
				out.WriteString(token)
				i = j
				continue
			}

			k := j
			for k < len(expr) && (expr[k] == ' ' || expr[k] == '\t' || expr[k] == '\n' || expr[k] == '\r') {
				k++
			}
			if k < len(expr) && expr[k] == '(' {
				// Function call, not a selector.
				out.WriteString(token)
				i = j
				continue
			}
			if k < len(expr) && expr[k] == '{' {
				end := strings.IndexByte(expr[k:], '}')
				if end < 0 {
					out.WriteString(expr[i:])
					return out.String()
				}
				body := strings.TrimSpace(expr[k+1 : k+end])
				out.WriteString(token)
				out.WriteByte('{')
				if body != "" {
					out.WriteString(body)
					out.WriteByte(',')
				}
				out.WriteString(matcher)
				out.WriteByte('}')
				i = k + end + 1
				continue
			}
			out.WriteString(token)
			out.WriteByte('{')
			out.WriteString(matcher)
			out.WriteByte('}')
			i = j
			continue
		}

		out.WriteByte(ch)
		i++
	}
	return out.String()
}

// InjectMatcher appends the matcher to each match[] selector.
func InjectMatcher(matchers []string, matcher string) []string {
	if matcher == "" {
		return matchers
	}
	clause := "{" + matcher + "}"
	if len(matchers) == 0 {
		return []string{clause}
	}
	out := make([]string, 0, len(matchers))
	for _, m := range matchers {
		m = strings.TrimSpace(m)
		if m == "" {
			out = append(out, clause)
			continue
		}
		if strings.HasPrefix(m, "{") && strings.HasSuffix(m, "}") {
			body := strings.TrimSpace(m[1 : len(m)-1])
			if body == "" {
				out = append(out, clause)
			} else {
				out = append(out, "{"+body+","+matcher+"}")
			}
			continue
		}
		out = append(out, InjectDomain(m, matcher))
	}
	return out
}

func isIdentStart(ch byte) bool {
	return ch == '_' || ch == ':' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
}

func isIdentPart(ch byte) bool {
	return isIdentStart(ch) || (ch >= '0' && ch <= '9')
}
