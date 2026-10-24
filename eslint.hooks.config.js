// Быстрая проверка только правил хуков (сторож guard_ux_top5_2026_10):
// хук после раннего return роняет экран («Rendered fewer hooks»), а tsc/vite это пропускают.
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
]
