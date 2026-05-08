import { createTheme } from '@mui/material/styles'
import type { PaletteMode } from '@mui/material'

export const getTheme = (mode: PaletteMode) =>
  createTheme({
    palette: {
      mode,
      ...(mode === 'light'
        ? {
            primary: { main: '#1a73e8', contrastText: '#fff' },
            secondary: { main: '#34a853' },
            background: { default: '#f8f9fa', paper: '#ffffff' },
            text: { primary: '#202124', secondary: '#5f6368' },
            divider: '#dadce0',
          }
        : {
            primary: { main: '#8ab4f8', contrastText: '#202124' },
            secondary: { main: '#81c995' },
            background: { default: '#202124', paper: '#292a2d' },
            text: { primary: '#e8eaed', secondary: '#9aa0a6' },
            divider: '#3c4043',
          }),
    },
    typography: {
      fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif',
    },
    components: {
      MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500 } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none' } } },
      MuiChip: { styleOverrides: { root: { fontFamily: '"Roboto Mono", monospace' } } },
    },
  })
