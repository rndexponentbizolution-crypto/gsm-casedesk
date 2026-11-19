// Tailwind v4 via PostCSS works for both `next build --webpack` and Turbopack.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
