import '@testing-library/jest-dom'

// jsdom не реализует matchMedia — нужен Mantine (тема, use-media-query и т.п.)
// в компонентных тестах, рендерящих MantineProvider.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
