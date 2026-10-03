import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  theme: {
    extend: {
      colors: {
        paper: '#FFFFFF',
        ink: '#292B3C',
        muted: '#5B6070',
        line: '#E3E0EC',
        lilac: '#EDE7F7',
        'lilac-soft': '#F4F0FA',
        violet: '#6D28D9',
        'violet-deep': '#5B21B6',
        coral: '#F67875',
        refusal: '#B42318',
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      maxWidth: { page: '1200px' },
      borderRadius: { card: '16px', control: '12px' },
    },
  },
}
