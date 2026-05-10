import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Card, CardActionArea, CardContent, CircularProgress, Typography,
} from '@mui/material'
import BuildIcon from '@mui/icons-material/Build'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import { useAuth } from '../../context/AuthContext'

const ROLES = [
  {
    key: 'builder',
    label: 'Builder',
    icon: <BuildIcon sx={{ fontSize: 32, color: 'text.secondary' }} />,
    desc: 'Build agents and workflows; submit for approval',
  },
  {
    key: 'approver',
    label: 'Approver',
    icon: <FactCheckIcon sx={{ fontSize: 32, color: 'info.main' }} />,
    desc: 'Review deployment requests; approve or reject',
  },
  {
    key: 'platform_admin',
    label: 'Platform Admin',
    icon: <AdminPanelSettingsIcon sx={{ fontSize: 32, color: 'secondary.main' }} />,
    desc: 'Full access; bypass approval',
  },
]

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState<string | null>(null)

  const handleSelect = async (role: string) => {
    setLoading(role)
    try {
      await login(role)
      navigate('/', { replace: true })
    } catch {
      setLoading(null)
    }
  }

  return (
    <Box
      sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100vh', bgcolor: 'background.default', gap: 2,
      }}
    >
      <Typography variant="h4" fontWeight={700} gutterBottom letterSpacing="-0.5px">
        atom platform
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Choose a role to log in as:
      </Typography>

      {ROLES.map(r => (
        <Card
          key={r.key}
          variant="outlined"
          sx={{ width: 340, transition: 'border-color 0.15s', '&:hover': { borderColor: 'primary.main' } }}
        >
          <CardActionArea onClick={() => handleSelect(r.key)} disabled={loading !== null}>
            <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
              <Box sx={{ width: 40, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                {loading === r.key ? <CircularProgress size={28} /> : r.icon}
              </Box>
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>{r.label}</Typography>
                <Typography variant="body2" color="text.secondary">{r.desc}</Typography>
              </Box>
            </CardContent>
          </CardActionArea>
        </Card>
      ))}

      <Typography
        variant="caption"
        color="text.disabled"
        sx={{ mt: 3, maxWidth: 340, textAlign: 'center', lineHeight: 1.5 }}
      >
        V1: demo role simulation. Production uses your IDP — Okta, Azure AD, or equivalent.
      </Typography>
    </Box>
  )
}
