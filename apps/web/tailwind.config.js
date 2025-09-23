/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        steel: {
          DEFAULT: "#1f2937",
          light: "#374151",
          dark: "#111827"
        },
        brand: {
          green: "#00B386",
          yellow: "#F2C94C",
          red: "#EF4444"
        }
      }
    },
  },
  plugins: [],
}
