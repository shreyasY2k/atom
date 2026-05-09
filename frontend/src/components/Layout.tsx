import React, { useContext, useState } from 'react'
import { Outlet } from 'react-router-dom'
import {
  AppBar, Box, Drawer, IconButton, Toolbar, Tooltip, Typography, useTheme,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import MenuOpenIcon from '@mui/icons-material/MenuOpen'
import Brightness4Icon from '@mui/icons-material/Brightness4'
import Brightness7Icon from '@mui/icons-material/Brightness7'
import { ColorModeContext } from '../App'
import Sidebar from './Sidebar'

const APPBAR_H     = 64
const DRAWER_FULL  = 220
const DRAWER_MINI  = 52

export default function Layout() {
  const theme = useTheme()
  const colorMode = useContext(ColorModeContext)
  const [collapsed, setCollapsed] = useState(false)
  const drawerW = collapsed ? DRAWER_MINI : DRAWER_FULL

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* AppBar */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          height: APPBAR_H,
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
          color: 'text.primary',
        }}
      >
        <Toolbar sx={{ height: APPBAR_H, minHeight: `${APPBAR_H}px !important` }}>
          {/* Collapse/expand toggle */}
          <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <IconButton
              edge="start"
              color="inherit"
              onClick={() => setCollapsed(v => !v)}
              sx={{ mr: 1.5 }}
            >
              {collapsed ? <MenuIcon /> : <MenuOpenIcon />}
            </IconButton>
          </Tooltip>

          <Typography variant="subtitle1" fontWeight={600} noWrap>
            Atom Agent Platform
          </Typography>

          <Box sx={{ flexGrow: 1 }} />

          <IconButton color="inherit" onClick={colorMode.toggle} title="Toggle light/dark">
            {theme.palette.mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Sidebar Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          width: drawerW,
          flexShrink: 0,
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
          '& .MuiDrawer-paper': {
            width: drawerW,
            boxSizing: 'border-box',
            top: `${APPBAR_H}px`,
            height: `calc(100vh - ${APPBAR_H}px)`,
            borderRight: `1px solid ${theme.palette.divider}`,
            bgcolor: 'background.paper',
            overflow: 'hidden',
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
          },
        }}
      >
        <Sidebar collapsed={collapsed} />
      </Drawer>

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          marginTop: `${APPBAR_H}px`,
          height: `calc(100vh - ${APPBAR_H}px)`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          bgcolor: 'background.default',
          minWidth: 0,
          transition: theme.transitions.create('margin', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
        }}
      >
        <Outlet />
      </Box>
    </Box>
  )
}
