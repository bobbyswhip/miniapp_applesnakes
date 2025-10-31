import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        quicksand: ['Quicksand', 'sans-serif'],
      },
      colors: {
        primary: {
          blue: '#3277FF',
          DEFAULT: '#3277FF',
        },
        secondary: {
          blue: '#508bff',
          DEFAULT: '#508bff',
        },
        accent: {
          blue: '#3c538f',
          DEFAULT: '#3c538f',
        },
        light: {
          blue: '#7ca8ff',
          DEFAULT: '#7ca8ff',
        },
        custom: {
          dark: '#121212',
          text: '#FFFDFA',
          textSecondary: '#949FBB',
          orange: '#f9690e',
          red: '#bd0240',
          green: '#19b405',
        },
      },
    },
  },
  plugins: [],
};
export default config;
