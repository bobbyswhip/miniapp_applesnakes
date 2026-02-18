import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    screens: {
      'xs': '375px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      fontFamily: {
        'hybrid': ['HybridMedium', 'system-ui', 'sans-serif'],
        'fords': ['FordsFolly', 'serif'],
        'columna': ['ColumnaCom', 'serif'],
        'din': ['DINNextArabic', 'system-ui', 'sans-serif'],
      },
      colors: {
        // OpenHL-inspired dark luxury palette
        dark: {
          DEFAULT: '#171e1d',
          deeper: '#0f1413',
          deepest: '#0a0d0c',
          card: '#1a2221',
          'card-hover': '#1f2827',
        },
        gold: {
          DEFAULT: '#ffd075',
          primary: '#ffd075',
          secondary: '#c5a97b',
          muted: '#a68b5b',
          dark: '#8b7245',
        },
        text: {
          primary: '#ffffff',
          secondary: '#cecece',
          muted: '#8a9090',
        },
        // Legacy compatibility colors
        custom: {
          dark: '#171e1d',
          text: '#cecece',
          textSecondary: '#8a9090',
          orange: '#f9690e',
          red: '#FF3B5C',
          green: '#22c55e',
          yellow: '#ffd075',
        },
      },
      borderColor: {
        gold: 'rgba(255, 208, 117, 0.3)',
        light: 'rgba(255, 255, 255, 0.1)',
      },
      boxShadow: {
        'gold': '0 0 20px rgba(255, 208, 117, 0.15)',
        'gold-lg': '0 0 40px rgba(255, 208, 117, 0.25)',
        'gold-glow': '0 0 30px rgba(255, 208, 117, 0.3)',
        'dark-md': '0 4px 12px rgba(0, 0, 0, 0.4)',
        'dark-lg': '0 8px 24px rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'shimmer': 'shimmer 1.5s infinite',
        'pulse-gold': 'pulse-gold 2s ease-in-out infinite',
        'gold-glisten': 'gold-element-glisten 8s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'fade-in': 'fadeIn 0.5s ease-out',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'pulse-gold': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(255, 208, 117, 0.2)' },
          '50%': { boxShadow: '0 0 30px rgba(255, 208, 117, 0.4)' },
        },
        'gold-element-glisten': {
          '0%': { backgroundPosition: '200% center, center center' },
          '100%': { backgroundPosition: '-200% center, center center' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(.2, 1, .8, 1)',
      },
    },
  },
  plugins: [],
};
export default config;
