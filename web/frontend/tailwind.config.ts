import type { Config } from 'tailwindcss'

export default <Partial<Config>>{
  theme: {
    extend: {
      colors: {
        paper: '#FFFFFF',
        ink: '#1F1F1F',
        muted: '#5F5F5C',
        rule: '#D6D6D2',
        seal: '#6D28D9',
        'seal-tint': '#F1EBFC',
        refusal: '#B42318',
      },
      fontFamily: {
        serif: ['"STIX Two Text"', '"Times New Roman"', 'serif'],
        mono: ['"Courier Prime"', '"Courier New"', 'monospace'],
      },
      maxWidth: { page: '1040px' },
    },
  },
}
