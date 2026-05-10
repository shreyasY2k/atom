import React, { useContext, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import {
  AppBar, Box, Chip, Drawer, IconButton, Menu, MenuItem,
  Toolbar, Tooltip, Typography, useTheme,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import MenuOpenIcon from '@mui/icons-material/MenuOpen'
import Brightness4Icon from '@mui/icons-material/Brightness4'
import Brightness7Icon from '@mui/icons-material/Brightness7'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import { ColorModeContext } from '../App'
import { useAuth } from '../context/AuthContext'
import Sidebar from './Sidebar'

const APPBAR_H     = 64
const DRAWER_FULL  = 220
const DRAWER_MINI  = 52

const ROLE_COLORS: Record<string, 'default' | 'info' | 'secondary'> = {
  builder:        'default',
  approver:       'info',
  platform_admin: 'secondary',
}

export default function Layout() {
  const theme = useTheme()
  const colorMode = useContext(ColorModeContext)
  const { displayName, role, identity, logout } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const drawerW = collapsed ? DRAWER_MINI : DRAWER_FULL

  const handleLogout = async () => {
    setAnchorEl(null)
    await logout()
    navigate('/login', { replace: true })
  }

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

          <IconButton color="inherit" onClick={colorMode.toggle} title="Toggle light/dark" sx={{ mr: 1 }}>
            {theme.palette.mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>

          {/* User badge */}
          {role && (
            <>
              <Chip
                size="small"
                label={displayName}
                color={ROLE_COLORS[role] ?? 'default'}
                variant="outlined"
                sx={{ mr: 1, fontWeight: 600, fontSize: '0.75rem' }}
              />
              <Tooltip title={identity}>
                <IconButton
                  size="small"
                  color="inherit"
                  onClick={e => setAnchorEl(e.currentTarget)}
                >
                  <AccountCircleIcon />
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={() => setAnchorEl(null)}
                transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
              >
                <MenuItem disabled sx={{ fontSize: '0.8rem', opacity: 0.7 }}>
                  {identity}
                </MenuItem>
                <MenuItem onClick={handleLogout}>Log out</MenuItem>
              </Menu>
            </>
          )}
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
