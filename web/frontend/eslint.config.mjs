// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

// Клиент облигации генерирует Codama в mor-kase, здесь только копия
export default withNuxt({ ignores: ['app/utils/bond/generated/**'] })
