module.exports = {
  content: [
    './**/*.html',
    './js/**/*.js',
    './public/js/**/*.js',
    './*.js'
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ],
}
