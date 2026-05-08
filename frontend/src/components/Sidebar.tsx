import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  List, ListItemButton, ListItemIcon, ListItemText,
  Typography, Divider, Box,
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

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  exact?: boolean
}

interface NavGroup {
  heading: string
  items: NavItem[]
}

const groups: NavGroup[] = [
  {
    heading: 'AGENTS',
    items: [
      { to: '/agents/build', label: 'Build Agent', icon: <AutoFixHighIcon fontSize="small" /> },
      { to: '/agents', label: 'Registry', icon: <SmartToyIcon fontSize="small" />, exact: true },
    ],
  },
  {
    heading: 'WORKFLOWS',
    items: [
      { to: '/workflows/compose', label: 'Composer', icon: <AccountTreeIcon fontSize="small" /> },
      { to: '/workflows/runs', label: 'Runs', icon: <PlaylistPlayIcon fontSize="small" /> },
      { to: '/workflows', label: 'Registry', icon: <ListIcon fontSize="small" />, exact: true },
    ],
  },
  {
    heading: 'OPERATIONS',
    items: [
      { to: '/chat', label: 'Chat', icon: <ChatIcon fontSize="small" /> },
      { to: '/tasks', label: 'Tasks', icon: <AssignmentIcon fontSize="small" /> },
    ],
  },
  {
    heading: 'AUDIT',
    items: [
      { to: '/audit', label: 'Events', icon: <HistoryIcon fontSize="small" />, exact: true },
      { to: '/audit/identities', label: 'Identities', icon: <BadgeIcon fontSize="small" /> },
    ],
  },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()

  const isActive = (item: NavItem) => {
    if (item.exact) return location.pathname === item.to
    return location.pathname.startsWith(item.to)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      {groups.map((group, gi) => (
        <React.Fragment key={group.heading}>
          {gi > 0 && <Divider sx={{ my: 0.5 }} />}
          <Box sx={{ px: 1.5, pt: gi === 0 ? 1.5 : 1, pb: 0.5 }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'text.secondary',
                px: 1,
              }}
            >
              {group.heading}
            </Typography>
          </Box>
          <List dense disablePadding sx={{ px: 1 }}>
            {group.items.map((item) => {
              const active = isActive(item)
              return (
                <ListItemButton
                  key={item.to}
                  selected={active}
                  onClick={() => navigate(item.to)}
                  sx={{
                    borderRadius: 1.5,
                    mb: 0.25,
                    '&.Mui-selected': {
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                      '&:hover': { bgcolor: 'primary.dark' },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 32, color: 'text.secondary' }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ fontSize: '0.8125rem' }}
                  />
                </ListItemButton>
              )
            })}
          </List>
        </React.Fragment>
      ))}

      <Box sx={{ flexGrow: 1 }} />
      <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" fontFamily="monospace">
          v1.0.0
        </Typography>
      </Box>
    </Box>
  )
}
