import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

const sharedRules = {
  ...js.configs.recommended.rules,
  ...tseslint.configs.recommended.rules,
  ...reactHooks.configs.recommended.rules,
  'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-unused-vars': 'off',
  // TypeScript 项目关闭核心 no-undef：TS 已做类型检查，避免误报 TS/DOM 全局类型
  // （如 ResponseInit）未定义（见 02_Frontend_Standard.md §11）。
  'no-undef': 'off',
}

const sharedPlugins = {
  '@typescript-eslint': tseslint.plugin,
  'react-hooks': reactHooks,
  'react-refresh': reactRefresh,
}

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: sharedPlugins,
    rules: sharedRules,
  },
  {
    // 测试文件：tsconfig.json 已 exclude（生产构建类型隔离，见 02_Frontend_Standard.md §11），
    // 这里将 project 置 null 禁用类型感知解析，避免 "file not found in project" 报错。
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/setupTests.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: null,
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: sharedPlugins,
    rules: sharedRules,
  },
]
