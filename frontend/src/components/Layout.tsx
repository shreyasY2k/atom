import React, { useContext } from 'react'
import { Outlet } from 'react-router-dom'
import {
  AppBar, Box, Drawer, IconButton, Toolbar, Typography, useTheme,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import Brightness4Icon from '@mui/icons-material/Brightness4'
import Brightness7Icon from '@mui/icons-material/Brightness7'
import { ColorModeContext } from '../App'
import Sidebar from './Sidebar'

const DRAWER_WIDTH = 240
const APPBAR_HEIGHT = 64

export default function Layout() {
  const theme = useTheme()
  const colorMode = useContext(ColorModeContext)

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* AppBar */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          height: APPBAR_HEIGHT,
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
          color: 'text.primary',
        }}
      >
        <Toolbar sx={{ height: APPBAR_HEIGHT, minHeight: `${APPBAR_HEIGHT}px !important` }}>
          <IconButton edge="start" color="inherit" sx={{ mr: 1.5 }}>
            <MenuIcon />
          </IconButton>
          <Typography variant="subtitle1" fontWeight={600} noWrap>
            Atom Agent Platform
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <IconButton color="inherit" onClick={colorMode.toggle} title="Toggle light/dark">
            {theme.palette.mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Permanent Sidebar Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            top: `${APPBAR_HEIGHT}px`,
            height: `calc(100vh - ${APPBAR_HEIGHT}px)`,
            borderRight: `1px solid ${theme.palette.divider}`,
            bgcolor: 'background.paper',
          },
        }}
      >
        <Sidebar />
      </Drawer>

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          marginTop: `${APPBAR_HEIGHT}px`,
          height: `calc(100vh - ${APPBAR_HEIGHT}px)`,
          overflow: 'auto',
          bgcolor: 'background.default',
          minWidth: 0,
        }}
      >
        <Outlet />
      </Box>
    </Box>
  )
}
