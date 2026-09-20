/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#141414',
        paper: '#FFF9EC',
        neo: {
          yellow: '#FFC800',
          pink: '#FF5D8F',
          blue: '#4D96FF',
          green: '#3ECF8E',
          purple: '#9B5DE5',
          orange: '#FF7A1A',
          red: '#FF3B3B',
        },
      },
      fontFamily: {
        display: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'neo-sm': '3px 3px 0 0 #141414',
        neo: '6px 6px 0 0 #141414',
        'neo-lg': '10px 10px 0 0 #141414',
        'neo-none': '0 0 0 0 #141414',
      },
      borderRadius: {
        neo: '6px',
      },
    },
  },
  plugins: [],
};
