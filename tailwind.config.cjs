module.exports = {
  content: [
    './**/*.html',
    './js/**/*.js',
    './public/js/**/*.js',
    './*.js'
  ],
  theme: {
    extend: {
      colors: {
        primary: '#c2410c',
        'bg-dark': '#0d1b2a',
        surface: '#132639'
      },
      fontFamily: {
        display: ['Work Sans', 'sans-serif']
      }
    },
  },
  plugins: [
    require('@tailwindcss/forms')
  ],
}
