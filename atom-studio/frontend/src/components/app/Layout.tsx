import { Link, useRouterState } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Badge from '@mui/material/Badge'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import GlobeIcon from '@mui/icons-material/Language'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import BuildIcon from '@mui/icons-material/Build'
import HowToRegIcon from '@mui/icons-material/HowToReg'
import AssignmentIcon from '@mui/icons-material/Assignment'
import LogoutIcon from '@mui/icons-material/Logout'
import { useAuthStore } from '@/lib/auth'
import { usePendingCount } from '@/lib/hitlStore'

const DRAWER_WIDTH = 224

const navItems = [
  { label: 'Domains', href: '/domains', Icon: GlobeIcon },
  { label: 'Agents', href: '/agents', Icon: SmartToyIcon },
  { label: 'Tools & Skills', href: '/tools-skills', Icon: BuildIcon },
  { label: 'HITL Queue', href: '/hitl', Icon: HowToRegIcon },
  { label: 'Audit Log', href: '/audit', Icon: AssignmentIcon },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore()
  const router = useRouterState()
  const currentPath = router.location.pathname
  const pendingCount = usePendingCount()

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      {/* Sidebar Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
          },
        }}
      >
        <Toolbar sx={{ minHeight: '56px !important' }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>
            ATOM Studio
          </Typography>
        </Toolbar>
        <Divider />
        <List dense sx={{ pt: 1 }}>
          {navItems.map(({ label, href, Icon }) => {
            const active = currentPath.startsWith(href)
            const isHitl = href === '/hitl'
            return (
              <ListItem key={href} disablePadding sx={{ px: 1, mb: 0.5 }}>
                <ListItemButton
                  component={Link}
                  to={href}
                  selected={active}
                  sx={{
                    borderRadius: 2,
                    '&.Mui-selected': {
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      '& .MuiListItemIcon-root': { color: 'inherit' },
                      '&:hover': { bgcolor: 'primary.dark' },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Icon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={label} slotProps={{ primary: { style: { fontSize: 14 } } }} />
                  {isHitl && pendingCount > 0 && (
                    <Badge badgeContent={pendingCount} color="error" sx={{ ml: 1 }} />
                  )}
                </ListItemButton>
              </ListItem>
            )
          })}
        </List>
      </Drawer>

      {/* Main area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top AppBar */}
        <AppBar
          position="static"
          color="inherit"
          elevation={0}
          sx={{ borderBottom: 1, borderColor: 'divider', zIndex: 1 }}
        >
          <Toolbar sx={{ minHeight: '56px !important', justifyContent: 'flex-end', gap: 1.5 }}>
            {user && (
              <>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {user.full_name ?? user.email}
                </Typography>
                <Chip
                  label={user.role}
                  size="small"
                  color={user.role === 'admin' ? 'primary' : 'default'}
                />
              </>
            )}
            <IconButton size="small" onClick={logout} title="Logout">
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Toolbar>
        </AppBar>

        {/* Page content */}
        <Box component="main" sx={{ flex: 1, overflow: 'auto', p: 3 }}>
          {children}
        </Box>
      </Box>
    </Box>
  )
}
