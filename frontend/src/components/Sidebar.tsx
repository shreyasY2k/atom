import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  List, ListItemButton, ListItemIcon, ListItemText,
  Tooltip, Typography, Divider, Box,
} from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import ListIcon from '@mui/icons-material/List'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import ChatIcon from '@mui/icons-material/Chat'
import AssignmentIcon from '@mui/icons-material/Assignment'
import HistoryIcon from '@mui/icons-material/History'
import BadgeIcon from '@mui/icons-material/Badge'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import SettingsIcon from '@mui/icons-material/Settings'
import ExtensionIcon from '@mui/icons-material/Extension'
import SecurityIcon from '@mui/icons-material/Security'
import { useAuth } from '../context/AuthContext'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  exact?: boolean
}

interface NavGroup {
  heading: string
  items: NavItem[]
  roles?: string[]  // undefined = visible to all
}

const ALL_GROUPS: NavGroup[] = [
  {
    heading: 'AGENTS',
    items: [
      { to: '/agents/build',  label: 'Build Agent', icon: <AutoFixHighIcon fontSize="small" /> },
      { to: '/agents',        label: 'Registry',    icon: <SmartToyIcon fontSize="small" />, exact: true },
      { to: '/tools',         label: 'Tool Registry', icon: <ExtensionIcon fontSize="small" />, exact: true },
    ],
  },
  {
    heading: 'WORKFLOWS',
    items: [
      { to: '/workflows/compose', label: 'Composer',  icon: <AccountTreeIcon fontSize="small" /> },
      { to: '/workflows/runs',    label: 'Runs',      icon: <PlaylistPlayIcon fontSize="small" /> },
      { to: '/workflows',         label: 'Registry',  icon: <ListIcon fontSize="small" />, exact: true },
    ],
  },
  {
    heading: 'GOVERNANCE',
    roles: ['approver', 'platform_admin'],
    items: [
      { to: '/approvals', label: 'Approvals', icon: <FactCheckIcon fontSize="small" /> },
    ],
  },
  {
    heading: 'OPERATIONS',
    items: [
      { to: '/chat',   label: 'Chat',  icon: <ChatIcon fontSize="small" /> },
      { to: '/tasks',  label: 'Tasks', icon: <AssignmentIcon fontSize="small" /> },
    ],
  },
  {
    heading: 'SECURITY',
    items: [
      { to: '/command-center', label: 'Command Center', icon: <SecurityIcon fontSize="small" />, exact: true },
    ],
  },
  {
    heading: 'AUDIT',
    items: [
      { to: '/audit',             label: 'Events',     icon: <HistoryIcon fontSize="small" />, exact: true },
      { to: '/audit/identities',  label: 'Identities', icon: <BadgeIcon fontSize="small" /> },
    ],
  },
  {
    heading: 'ADMIN',
    roles: ['platform_admin'],
    items: [
      { to: '/settings', label: 'Settings', icon: <SettingsIcon fontSize="small" /> },
    ],
  },
]

interface Props {
  collapsed: boolean
}

export default function Sidebar({ collapsed }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const { role } = useAuth()

  const isActive = (item: NavItem) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to)

  const visibleGroups = ALL_GROUPS.filter(g =>
    !g.roles || (role && g.roles.includes(role))
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
      {visibleGroups.map((group, gi) => (
        <React.Fragment key={group.heading}>
          {gi > 0 && <Divider sx={{ my: 0.5 }} />}

          {!collapsed && (
            <Box sx={{ px: 1.5, pt: gi === 0 ? 1.5 : 1, pb: 0.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.08em', color: 'text.secondary', px: 1 }}>
                {group.heading}
              </Typography>
            </Box>
          )}
          {collapsed && gi === 0 && <Box sx={{ pt: 1 }} />}

          <List dense disablePadding sx={{ px: collapsed ? 0.5 : 1 }}>
            {group.items.map((item) => {
              const active = isActive(item)
              const btn = (
                <ListItemButton
                  key={item.to}
                  selected={active}
                  onClick={() => navigate(item.to)}
                  sx={{
                    borderRadius: 1.5,
                    mb: 0.25,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    px: collapsed ? 1 : 1.5,
                    minWidth: 0,
                    '&.Mui-selected': {
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                      '&:hover': { bgcolor: 'primary.dark' },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: collapsed ? 0 : 32, color: 'text.secondary', justifyContent: 'center' }}>
                    {item.icon}
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: '0.8125rem' }} />
                  )}
                </ListItemButton>
              )
              return collapsed ? (
                <Tooltip key={item.to} title={item.label} placement="right">
                  {btn}
                </Tooltip>
              ) : btn
            })}
          </List>
        </React.Fragment>
      ))}

      <Box sx={{ flexGrow: 1 }} />
      {!collapsed && (
        <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
            v1.0.0
          </Typography>
        </Box>
      )}
    </Box>
  )
}
